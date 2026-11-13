import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useProductStore, useVariantStore } from '../../store/store'
import { buildStructuredOrderItem, calculateLineTotal, formatCurrency, normalizeStructuredOrderItem, type StructuredOrderItem } from '../../lib/retail'
import { normalizePhone } from '../../lib/phone'
import { lockScroll, unlockScroll } from '../../lib/scrollLock'
import { PAYMENT_MODES, SPLIT_PARTS, splitDifference, type PaymentMode, type SplitAmounts } from '../../lib/paymentModes'
import { updateOrderWithStock } from '../../services/orderEditService'

export interface EditableOrder {
  id: string
  invoice_no: string
  customer_name: string
  phone: string
  address: string
  items: Record<string, unknown>[]
  discount_amount: number
  manual_discount_amount: number
  delivery_charge: number
  total_gst: number
  payment_mode: string
  remarks?: string
  reference_number?: string
}

export interface SavedOrderEdit {
  customer_name: string
  phone: string
  address: string
  items: StructuredOrderItem[]
  total: number
  delivery_charge: number
  manual_discount_amount: number
  payment_mode: string
  remarks: string
  reference_number: string
}

type Row = StructuredOrderItem & { key: string }

const fieldCls =
  'w-full h-10 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-semibold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white'
const labelCls = 'block text-[10px] font-black tracking-wider text-gray-500 uppercase mb-1'

const toMode = (raw: string): PaymentMode | 'keep' => {
  const v = raw.toLowerCase()
  if (v.includes('split')) return 'split'
  if (v === 'qr' || v.includes('gpay') || v.includes('upi')) return 'qr'
  if (v.includes('card')) return 'card'
  if (v.includes('cash')) return 'cash'
  return 'keep' // online / request orders: leave the payment mode alone
}

const num = (v: string): number => (v.trim() === '' ? 0 : Number(v) || 0)
const toProductId = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^\d+$/.test(s) ? s : null
}

export const EditOrderModal: React.FC<{
  order: EditableOrder
  /** a bill with returns keeps its products: only customer, charges and payment can change */
  itemsLocked?: boolean
  onClose: () => void
  onSaved: (edit: SavedOrderEdit) => void
}> = ({ order, itemsLocked = false, onClose, onSaved }) => {
  const { products, fetchProducts } = useProductStore()
  const { variantsMap, fetchVariants } = useVariantStore()

  const [name, setName] = useState(order.customer_name)
  const [phone, setPhone] = useState(order.phone)
  const [address, setAddress] = useState(order.address)
  const [rows, setRows] = useState<Row[]>(() =>
    order.items.map((raw, i) => ({ ...normalizeStructuredOrderItem(raw), key: `r${i}` })),
  )
  const [delivery, setDelivery] = useState(order.delivery_charge ? String(order.delivery_charge) : '')
  const [manualDiscount, setManualDiscount] = useState(order.manual_discount_amount ? String(order.manual_discount_amount) : '')
  const initialMode = toMode(order.payment_mode)
  const [mode, setMode] = useState<PaymentMode | 'keep'>(initialMode)
  const [splitInputs, setSplitInputs] = useState({ cash: '', card: '', qr: '' })
  const [remarks, setRemarks] = useState(order.remarks || '')
  const [reference, setReference] = useState(order.reference_number || '')
  const [search, setSearch] = useState('')
  const [manual, setManual] = useState({ name: '', qty: '1', price: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lockScroll()
    void fetchProducts()
    void fetchVariants()
    return () => unlockScroll()
  }, [fetchProducts, fetchVariants])

  const subtotal = rows.reduce((sum, r) => sum + r.line_total, 0)
  const total = Math.max(0, subtotal + num(delivery) + order.total_gst - order.discount_amount - num(manualDiscount))
  const splitAmounts: SplitAmounts = { cash: num(splitInputs.cash), card: num(splitInputs.card), qr: num(splitInputs.qr) }
  const splitDiff = splitDifference(splitAmounts, total)

  const updateRow = (key: string, patch: { quantity?: number; base_price?: number; name?: string }) =>
    setRows((cur) =>
      cur.map((r) => {
        if (r.key !== key) return r
        const next = { ...r, ...patch }
        return { ...next, line_total: calculateLineTotal(next.quantity, next.unit_type, next.base_quantity, next.base_price) }
      }),
    )

  // Catalogue search: products without variants, plus every active variant as its own line
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const out: { id: string; label: string; price: number; stock: number; add: () => void }[] = []
    for (const p of products) {
      if (p.isActive === false) continue
      const variants = (variantsMap[String(p.id)] || []).filter((v) => v.isActive !== false)
      if (variants.length > 0) {
        for (const v of variants) {
          const label = `${p.name} - ${v.variantName}`
          if (!label.toLowerCase().includes(q) && !(v.barcode || '').toLowerCase().includes(q)) continue
          out.push({
            id: v.id, label, price: v.price, stock: v.stock,
            add: () => addRow(buildStructuredOrderItem({
              productId: toProductId(p.id), variantId: v.id, variantName: v.variantName, name: label,
              quantity: 1, unit: v.sizeLabel || 'piece', unitType: 'unit', baseQuantity: 1, basePrice: v.price,
              imageUrl: v.imageUrl || p.image || null, category: p.category,
            })),
          })
        }
      } else if (p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)) {
        out.push({
          id: String(p.id), label: p.name, price: p.offerPrice || p.price, stock: p.stockQuantity,
          add: () => addRow(buildStructuredOrderItem({
            productId: toProductId(p.id), name: p.name, quantity: 1, unit: p.unitLabel || 'piece', unitType: 'unit',
            baseQuantity: 1, basePrice: p.offerPrice || p.price, imageUrl: p.image || null, category: p.category,
          })),
        })
      }
      if (out.length >= 8) break
    }
    return out.slice(0, 8)
  }, [search, products, variantsMap])

  function addRow(item: StructuredOrderItem) {
    setRows((cur) => {
      const same = cur.find((r) => item.variant_id ? r.variant_id === item.variant_id : !r.is_manual && r.product_id === item.product_id && r.name === item.name)
      if (same) {
        return cur.map((r) => r.key === same.key
          ? { ...r, quantity: r.quantity + 1, line_total: calculateLineTotal(r.quantity + 1, r.unit_type, r.base_quantity, r.base_price) }
          : r)
      }
      return [...cur, { ...item, key: `n${Date.now()}${cur.length}` }]
    })
    setSearch('')
  }

  const addManual = () => {
    const price = num(manual.price)
    if (!manual.name.trim() || price <= 0) return setError('Give the item a name and a price.')
    setError('')
    addRow(buildStructuredOrderItem({
      productId: null, name: manual.name.trim(), quantity: Math.max(1, Math.round(num(manual.qty) || 1)), unit: 'piece',
      unitType: 'unit', baseQuantity: 1, basePrice: price, source: 'manual', isManual: true, category: 'Unregistered',
    }))
    setManual({ name: '', qty: '1', price: '' })
  }

  const save = async () => {
    if (rows.length === 0) return setError('A bill needs at least one item.')
    if (rows.some((r) => r.quantity < 1 || r.base_price < 0)) return setError('Check the quantities and prices.')
    const trimmed = phone.trim()
    const normalizedPhone = trimmed ? normalizePhone(trimmed) : ''
    if (trimmed && !normalizedPhone) return setError('Enter a valid 10-digit mobile number, or leave it blank.')
    if (mode === 'split' && Math.abs(splitDiff) > 0.004) {
      return setError(splitDiff > 0 ? `Split amounts are short by ${formatCurrency(splitDiff)}` : `Split amounts exceed the total by ${formatCurrency(-splitDiff)}`)
    }

    setSaving(true)
    setError('')
    const paymentMethod = mode === 'keep' ? order.payment_mode : mode
    const items = rows.map(({ key: _key, ...item }) => item)
    const err = await updateOrderWithStock({
      orderId: order.id,
      customerName: name.trim(),
      phone: normalizedPhone || '',
      address: address.trim(),
      items,
      subtotal,
      total,
      deliveryCharge: num(delivery),
      manualDiscountAmount: num(manualDiscount),
      totalGst: order.total_gst,
      paymentMethod,
      splitDetails: mode === 'split' ? { ...splitAmounts } : {},
      remarks: remarks.trim(),
      referenceNumber: reference.trim(),
    })
    setSaving(false)
    if (err) return setError(err)
    onSaved({
      customer_name: name.trim() || order.customer_name,
      phone: normalizedPhone || '',
      address: address.trim(),
      items,
      total,
      delivery_charge: num(delivery),
      manual_discount_amount: num(manualDiscount),
      payment_mode: paymentMethod,
      remarks: remarks.trim(),
      reference_number: reference.trim(),
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[94dvh] bg-white rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col border border-accent-light">
        <div className="shrink-0 px-5 py-3.5 border-b border-gray-100 bg-accent-soft flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil size={16} className="text-accent shrink-0" />
            <h3 className="text-sm font-bold text-[#0A0A0A] truncate">Edit bill {order.invoice_no}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer">
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto min-h-0 flex-1 p-4 sm:p-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl">
              <AlertCircle size={15} className="text-rose-600 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {/* Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={labelCls}>Customer name</label><input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className={labelCls}>Mobile number</label><input className={fieldCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
            <div><label className={labelCls}>Address</label><input className={fieldCls} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          </div>

          {/* Items */}
          <div>
            <span className={labelCls}>Products on this bill</span>
            {itemsLocked && <p className="mb-1.5 text-[11px] font-bold text-amber-700">This bill has returns, so its products and prices are locked.</p>}
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="hidden sm:grid grid-cols-[1fr_84px_104px_92px_36px] gap-2 px-3 py-2 bg-gray-50 text-[10px] font-black uppercase tracking-wider text-gray-500">
                <span>Item</span><span>Qty</span><span>Price (₹)</span><span className="text-right">Total</span><span />
              </div>
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-2 sm:grid-cols-[1fr_84px_104px_92px_36px] gap-2 items-center px-3 py-2.5 border-t border-gray-100">
                  <div className="col-span-2 sm:col-span-1 min-w-0">
                    {r.is_manual ? (
                      <input className={`${fieldCls} h-9`} disabled={itemsLocked} value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} />
                    ) : (
                      <p className="text-xs font-bold text-[#0A0A0A] truncate" title={r.name}>{r.name}</p>
                    )}
                    {r.is_manual && <span className="text-[10px] font-bold text-gray-500">Manual item (no stock)</span>}
                  </div>
                  <input
                    type="number" min="1" step="1" disabled={itemsLocked} className={`${fieldCls} h-9`} value={r.quantity}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    onChange={(e) => updateRow(r.key, { quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                  <input
                    type="number" min="0" step="0.01" disabled={itemsLocked} className={`${fieldCls} h-9`} value={r.base_price}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    onChange={(e) => updateRow(r.key, { base_price: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <span className="text-xs font-black text-right text-[#0A0A0A]">{formatCurrency(r.line_total)}</span>
                  <button type="button" disabled={itemsLocked} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} aria-label="Remove item" className="w-9 h-9 rounded-lg border border-rose-100 text-rose-500 hover:bg-rose-50 flex items-center justify-center cursor-pointer justify-self-end">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {rows.length === 0 && <p className="px-3 py-4 text-xs font-semibold text-gray-500 border-t border-gray-100">No items. Add at least one below.</p>}
            </div>

            {/* Add a catalogue product */}
            {!itemsLocked && (<>
            <div className="mt-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${fieldCls} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add a product: search name or barcode" />
              {results.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                  {results.map((res) => (
                    <button key={res.id} type="button" onClick={res.add} className="w-full text-left px-3 py-2 border-t border-gray-100 first:border-t-0 hover:bg-accent-soft flex items-center justify-between gap-3 cursor-pointer">
                      <span className="text-xs font-bold text-[#0A0A0A] truncate">{res.label}</span>
                      <span className="text-[11px] font-semibold text-gray-500 shrink-0">{formatCurrency(res.price)} · stock {res.stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add a manual item */}
            <div className="mt-2 grid grid-cols-[1fr_64px_96px_auto] gap-2">
              <input className={`${fieldCls} h-9`} value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Manual item name" />
              <input type="number" min="1" className={`${fieldCls} h-9`} value={manual.qty} onChange={(e) => setManual({ ...manual, qty: e.target.value })} placeholder="Qty" />
              <input type="number" min="0" className={`${fieldCls} h-9`} value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value })} placeholder="Price" />
              <button type="button" onClick={addManual} className="h-9 px-3 rounded-xl bg-[#0A0A0A] text-accent text-xs font-bold inline-flex items-center gap-1 cursor-pointer"><Plus size={13} /> Add</button>
            </div>
            </>)}
          </div>

          {/* Charges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Delivery charge (₹)</label><input type="number" min="0" className={fieldCls} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" /></div>
            <div><label className={labelCls}>Extra discount (₹)</label><input type="number" min="0" className={fieldCls} value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)} placeholder="0" /></div>
          </div>

          {/* Payment */}
          <div>
            <span className={labelCls}>Payment</span>
            <div className="grid grid-cols-4 gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                  className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 cursor-pointer transition-colors ${mode === m.id ? 'bg-[#0A0A0A] text-accent border-[#0A0A0A]' : 'bg-white text-[#374151] border-gray-200 hover:border-gray-300'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {initialMode === 'keep' && (
              <button type="button" onClick={() => setMode('keep')} className={`mt-1.5 text-[11px] font-bold underline cursor-pointer ${mode === 'keep' ? 'text-[#0A0A0A]' : 'text-gray-500'}`}>
                Keep “{order.payment_mode || 'current'}” as it is
              </button>
            )}
            {mode === 'split' && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SPLIT_PARTS.map((p) => (
                  <div key={p.id}>
                    <span className="block text-[10px] font-bold text-gray-500 mb-0.5">{p.label}</span>
                    <input type="number" min="0" step="0.01" className={`${fieldCls} h-9`} value={splitInputs[p.id]} placeholder="0.00"
                      onChange={(e) => setSplitInputs({ ...splitInputs, [p.id]: e.target.value })} />
                  </div>
                ))}
                <p className={`col-span-3 text-[11px] font-black ${Math.abs(splitDiff) <= 0.004 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {Math.abs(splitDiff) <= 0.004 ? 'Matches the total' : splitDiff > 0 ? `Still to collect ${formatCurrency(splitDiff)}` : `Over the total by ${formatCurrency(-splitDiff)}`}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Remarks</label><input className={fieldCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div><label className={labelCls}>Reference number</label><input className={fieldCls} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-gray-200 bg-[#FAFAFA] p-3.5 space-y-1 text-xs font-bold text-gray-700">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            {num(delivery) > 0 && <div className="flex justify-between"><span>Delivery</span><span>{formatCurrency(num(delivery))}</span></div>}
            {order.total_gst > 0 && <div className="flex justify-between"><span>GST</span><span>{formatCurrency(order.total_gst)}</span></div>}
            {order.discount_amount > 0 && <div className="flex justify-between"><span>Coupon discount (kept as billed)</span><span>− {formatCurrency(order.discount_amount)}</span></div>}
            {num(manualDiscount) > 0 && <div className="flex justify-between"><span>Extra discount</span><span>− {formatCurrency(num(manualDiscount))}</span></div>}
            <div className="flex justify-between pt-1.5 mt-1 border-t border-gray-200 text-sm font-black text-[#0A0A0A]"><span>Bill total</span><span>{formatCurrency(total)}</span></div>
          </div>
          <p className="text-[11px] font-semibold text-gray-500">Stock is adjusted for the quantity changes. The invoice number, date and status stay the same.</p>
        </div>

        <div className="shrink-0 px-5 py-3.5 border-t border-gray-100 bg-white flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="h-10 px-5 rounded-xl border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 cursor-pointer">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-10 px-6 rounded-xl bg-[#0A0A0A] text-accent text-xs font-bold tracking-wide disabled:opacity-60 cursor-pointer">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
