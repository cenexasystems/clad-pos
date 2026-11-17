import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useProductStore, useVariantStore } from '../../store/store'
import { buildStructuredOrderItem, calculateLineTotal, formatCurrency, type StructuredOrderItem } from '../../lib/retail'

export type ExchangeRow = StructuredOrderItem & { key: string }

const fieldCls =
  'w-full h-9 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-semibold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white'

const num = (v: string): number => (v.trim() === '' ? 0 : Number(v) || 0)
const toProductId = (v: unknown): string | null => (/^\d+$/.test(String(v ?? '').trim()) ? String(v).trim() : null)

/** The new items the customer takes in an exchange: search the catalogue or add a manual item. */
export const ExchangeItemsEditor: React.FC<{
  rows: ExchangeRow[]
  onChange: (rows: ExchangeRow[]) => void
}> = ({ rows, onChange }) => {
  const { products, fetchProducts } = useProductStore()
  const { variantsMap, fetchVariants } = useVariantStore()
  const [search, setSearch] = useState('')
  const [manual, setManual] = useState({ name: '', qty: '1', price: '' })

  useEffect(() => {
    void fetchProducts()
    void fetchVariants()
  }, [fetchProducts, fetchVariants])

  const withTotal = (r: ExchangeRow): ExchangeRow => ({ ...r, line_total: calculateLineTotal(r.quantity, r.unit_type, r.base_quantity, r.base_price) })

  const addRow = (item: StructuredOrderItem) => {
    const same = rows.find((r) => (item.variant_id ? r.variant_id === item.variant_id : !r.is_manual && r.product_id === item.product_id && r.name === item.name))
    if (same) onChange(rows.map((r) => (r.key === same.key ? withTotal({ ...r, quantity: r.quantity + 1 }) : r)))
    else onChange([...rows, { ...item, key: `x${Date.now()}${rows.length}` }])
    setSearch('')
  }

  const update = (key: string, patch: Partial<Pick<ExchangeRow, 'quantity' | 'base_price' | 'name'>>) =>
    onChange(rows.map((r) => (r.key === key ? withTotal({ ...r, ...patch }) : r)))

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
              productId: toProductId(p.id), variantId: v.id, variantName: v.variantName, name: label, quantity: 1,
              unit: v.sizeLabel || 'piece', unitType: 'unit', baseQuantity: 1, basePrice: v.price, imageUrl: v.imageUrl || p.image || null, category: p.category,
            })),
          })
        }
      } else if (p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)) {
        out.push({
          id: String(p.id), label: p.name, price: p.offerPrice || p.price, stock: p.stockQuantity,
          add: () => addRow(buildStructuredOrderItem({
            productId: toProductId(p.id), name: p.name, quantity: 1, unit: p.unitLabel || 'piece', unitType: 'unit', baseQuantity: 1,
            basePrice: p.offerPrice || p.price, imageUrl: p.image || null, category: p.category,
          })),
        })
      }
      if (out.length >= 8) break
    }
    return out
    // addRow reads the latest rows through the closure created on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, products, variantsMap, rows])

  const addManual = () => {
    const price = num(manual.price)
    if (!manual.name.trim() || price <= 0) return
    addRow(buildStructuredOrderItem({
      productId: null, name: manual.name.trim(), quantity: Math.max(1, Math.round(num(manual.qty) || 1)), unit: 'piece', unitType: 'unit',
      baseQuantity: 1, basePrice: price, source: 'manual', isManual: true, category: 'Unregistered',
    }))
    setManual({ name: '', qty: '1', price: '' })
  }

  return (
    <div>
      {rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 overflow-hidden mb-2.5">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_64px_92px_80px_32px] gap-2 items-center px-3 py-2 border-t border-gray-100 first:border-t-0">
              {r.is_manual ? (
                <input className={fieldCls} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
              ) : (
                <p className="text-xs font-bold text-[#0A0A0A] truncate" title={r.name}>{r.name}</p>
              )}
              <input type="number" min="1" step="1" className={fieldCls} value={r.quantity} onWheel={(e) => (e.target as HTMLInputElement).blur()}
                onChange={(e) => update(r.key, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
              <input type="number" min="0" step="0.01" className={fieldCls} value={r.base_price} onWheel={(e) => (e.target as HTMLInputElement).blur()}
                onChange={(e) => update(r.key, { base_price: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="text-xs font-black text-right">{formatCurrency(r.line_total)}</span>
              <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label="Remove" className="w-8 h-8 rounded-lg border border-rose-100 text-rose-500 hover:bg-rose-50 flex items-center justify-center cursor-pointer">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className={`${fieldCls} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add a new item: search name or barcode" />
        {results.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg max-h-52 overflow-y-auto">
            {results.map((res) => (
              <button key={res.id} type="button" onClick={res.add} className="w-full text-left px-3 py-2 border-t border-gray-100 first:border-t-0 hover:bg-accent-soft flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-xs font-bold text-[#0A0A0A] truncate">{res.label}</span>
                <span className="text-[11px] font-semibold text-gray-500 shrink-0">{formatCurrency(res.price)} · stock {res.stock}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 grid grid-cols-[1fr_64px_96px_auto] gap-2">
        <input className={fieldCls} value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Manual item name" />
        <input type="number" min="1" className={fieldCls} value={manual.qty} onChange={(e) => setManual({ ...manual, qty: e.target.value })} placeholder="Qty" />
        <input type="number" min="0" className={fieldCls} value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value })} placeholder="Price" />
        <button type="button" onClick={addManual} className="h-9 px-3 rounded-xl bg-[#0A0A0A] text-accent text-xs font-bold inline-flex items-center gap-1 cursor-pointer"><Plus size={13} /> Add</button>
      </div>
    </div>
  )
}
