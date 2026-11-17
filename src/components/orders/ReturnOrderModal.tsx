import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowLeftRight, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { computeRefund, exchangeSettlement, returnableLines, type OrderReturn } from '../../lib/returns'
import { ExchangeItemsEditor, type ExchangeRow } from './ExchangeItemsEditor'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { PAYMENT_MODES, SPLIT_PARTS, splitDifference, type SplitAmounts } from '../../lib/paymentModes'
import { lockScroll, unlockScroll } from '../../lib/scrollLock'
import { verifyAdminPassword } from '../../lib/adminConfirm'
import { returnService } from '../../services/returnService'

export interface ReturnableOrder {
  id: string
  invoice_no: string
  customer_name: string
  items: Record<string, unknown>[]
  discount_amount: number
  manual_discount_amount: number
  total_gst: number
  delivery_charge: number
}

const fieldCls =
  'w-full h-10 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-semibold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white'
const labelCls = 'block text-[10px] font-black tracking-wider text-gray-500 uppercase mb-1'

export const ReturnOrderModal: React.FC<{
  order: ReturnableOrder
  previousReturns: OrderReturn[]
  /** 'admin' confirms with a tick; anyone else needs the admin password */
  role: 'admin' | 'staff' | null
  adminName: string
  onClose: () => void
  onCreated: (ret: OrderReturn) => void
}> = ({ order, previousReturns, role, adminName, onClose, onCreated }) => {
  const lines = useMemo(() => returnableLines(order.items, previousReturns), [order.items, previousReturns])
  const [qty, setQty] = useState<Record<number, number>>({})
  // Only the admin decides whether returned items go back into stock. Staff see the choices locked
  // (nothing is added) until the admin password is entered.
  const [adminUnlocked, setAdminUnlocked] = useState(role === 'admin')
  const [restock, setRestock] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(lines.map((l) => [l.line_index, role === 'admin' && !l.is_manual])),
  )
  // 'exchange' = return items and take new ones; the difference is paid by the customer or paid back by the shop
  const [mode, setMode] = useState<'return' | 'exchange'>('return')
  const [newRows, setNewRows] = useState<ExchangeRow[]>([])
  const [method, setMethod] = useState<'cash' | 'card' | 'qr' | 'split'>('cash')
  const [splitInputs, setSplitInputs] = useState({ cash: '', card: '', qr: '' })
  const [reason, setReason] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminTick, setAdminTick] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lockScroll()
    return () => unlockScroll()
  }, [])

  const picks = lines.map((l) => ({ line_index: l.line_index, quantity: qty[l.line_index] || 0, restock: Boolean(restock[l.line_index]) }))
  const refund = computeRefund(order, picks)
  const splitAmounts: SplitAmounts = {
    cash: Number(splitInputs.cash) || 0,
    card: Number(splitInputs.card) || 0,
    qr: Number(splitInputs.qr) || 0,
  }
  const isExchange = mode === 'exchange'
  const newTotal = newRows.reduce((sum, r) => sum + r.line_total, 0)
  const settle = exchangeSettlement(refund.refund_total, newTotal)
  // the money that really changes hands: the refund (return), or the customer's extra / the shop's pay-back (exchange)
  const moneyDue = isExchange ? (settle.pay > 0 ? settle.pay : settle.back) : refund.refund_total
  const splitDiff = splitDifference(splitAmounts, moneyDue)
  const nothingLeft = lines.every((l) => l.available <= 0)
  const isAdmin = role === 'admin'

  const unlockAdmin = async () => {
    if (!(await verifyAdminPassword(adminPassword))) return setError('Admin password is not correct.')
    setError('')
    setAdminUnlocked(true)
    setRestock(Object.fromEntries(lines.map((l) => [l.line_index, !l.is_manual])))
  }

  const submit = async () => {
    if (refund.lines.length === 0) return setError('Choose at least one item to return.')
    if (isExchange && newRows.length === 0) return setError('Add the new items the customer is taking.')
    if (isExchange && newRows.some((r) => r.base_price <= 0)) return setError('Every new item needs a price.')
    if (moneyDue > 0.004 && method === 'split' && Math.abs(splitDiff) > 0.004) {
      return setError(splitDiff > 0 ? `Split amounts are short by ${formatCurrency(splitDiff)}` : `Split amounts exceed the amount by ${formatCurrency(-splitDiff)}`)
    }
    if (isAdmin ? !adminTick : !adminUnlocked) {
      return setError(isAdmin ? 'Tick the box to confirm as admin.' : 'This needs the admin. Enter the admin password and press Verify.')
    }

    setSaving(true)
    setError('')
    if (isExchange) {
      const parts = method === 'split' ? { ...splitAmounts } : {}
      const result = await returnService.createExchange({
        orderId: order.id,
        picks,
        newItems: newRows.map(({ key: _key, ...item }) => item),
        payMethod: settle.pay > 0 ? method : 'cash',
        paySplit: settle.pay > 0 ? parts : {},
        backMethod: settle.back > 0 ? method : 'cash',
        backSplit: settle.back > 0 ? parts : {},
        reason: reason.trim(),
        confirmedBy: isAdmin ? adminName || 'Admin' : 'Admin (password)',
      })
      setSaving(false)
      if (!result.data) return setError(result.error || 'Could not save the exchange.')
      return onCreated(result.data)
    }
    const result = await returnService.create({
      orderId: order.id,
      picks,
      refundMethod: method,
      refundSplit: method === 'split' ? { ...splitAmounts } : {},
      reason: reason.trim(),
      confirmedBy: isAdmin ? adminName || 'Admin' : 'Admin (password)',
    })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not save the return.')
    onCreated(result.data)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[94dvh] bg-white rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col border border-accent-light">
        <div className="shrink-0 px-5 py-3.5 border-b border-gray-100 bg-accent-soft flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isExchange ? <ArrowLeftRight size={16} className="text-accent shrink-0" /> : <RotateCcw size={16} className="text-accent shrink-0" />}
            <h3 className="text-sm font-bold text-[#0A0A0A] truncate">{isExchange ? 'Exchange' : 'Return / refund'} · bill {formatInvoiceNo(order.invoice_no)}</h3>
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

          <div className="inline-flex rounded-2xl border border-gray-200 p-1 gap-1">
            {([['return', 'Return / refund'], ['exchange', 'Exchange']] as const).map(([id, text]) => (
              <button key={id} type="button" onClick={() => { setMode(id); setError('') }}
                className={`h-9 px-4 rounded-xl text-[11px] font-black tracking-wider uppercase cursor-pointer ${mode === id ? 'bg-[#0A0A0A] text-accent' : 'text-gray-700 hover:bg-gray-50'}`}>
                {text}
              </button>
            ))}
          </div>

          {nothingLeft ? (
            <p className="text-sm font-bold text-gray-600">Everything on this bill has already been returned.</p>
          ) : (
            <div>
              <span className={labelCls}>{isExchange ? 'Items coming back' : 'Items being returned'}</span>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                {lines.map((l) => (
                  <div key={l.line_index} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_150px] gap-2 items-center px-3 py-2.5 border-t border-gray-100 first:border-t-0">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0A0A0A] truncate" title={l.name}>{l.name}</p>
                      <p className="text-[10px] font-semibold text-gray-500">
                        Bought {l.ordered} · {formatCurrency(l.unit_price)} each
                        {l.returned > 0 && ` · already returned ${l.returned}`}
                      </p>
                    </div>
                    {l.available > 0 ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black uppercase text-gray-500">Return</span>
                          <input
                            type="number" min="0" max={l.available} step="1" className={`${fieldCls} h-9 w-16`} value={qty[l.line_index] ?? ''} placeholder="0"
                            onWheel={(e) => (e.target as HTMLInputElement).blur()}
                            onChange={(e) => setQty({ ...qty, [l.line_index]: Math.min(l.available, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                          />
                          <span className="text-[10px] font-semibold text-gray-500">of {l.available}</span>
                        </div>
                        <label className={`col-span-2 sm:col-span-1 flex items-center gap-2 text-[11px] font-bold ${l.is_manual || !adminUnlocked ? 'text-gray-400' : 'text-gray-800 cursor-pointer'}`}>
                          <input
                            type="checkbox" disabled={l.is_manual || !adminUnlocked} checked={Boolean(restock[l.line_index]) && !l.is_manual}
                            onChange={(e) => setRestock({ ...restock, [l.line_index]: e.target.checked })}
                          />
                          {l.is_manual ? 'Manual item (no stock)' : adminUnlocked ? 'Add back to stock' : 'Not added (admin decides)'}
                        </label>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold text-gray-400">Fully returned</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-gray-500">Only the admin chooses whether returned items go back into stock. Untick “Add back to stock” for damaged items that cannot be sold again.</p>
            </div>
          )}

          {isExchange && (
            <div>
              <span className={labelCls}>New items the customer takes</span>
              <ExchangeItemsEditor rows={newRows} onChange={setNewRows} />
            </div>
          )}

          {/* Refund amount */}
          <div className="rounded-xl border border-gray-200 bg-[#FAFAFA] p-3.5 space-y-1 text-xs font-bold text-gray-700">
            <div className="flex justify-between"><span>Returned items</span><span>{formatCurrency(refund.items_total)}</span></div>
            {refund.discount_share > 0 && <div className="flex justify-between"><span>Less: their share of the bill discount</span><span>− {formatCurrency(refund.discount_share)}</span></div>}
            {refund.gst_share > 0 && <div className="flex justify-between"><span>Add: their share of GST</span><span>+ {formatCurrency(refund.gst_share)}</span></div>}
            <div className="flex justify-between pt-1.5 mt-1 border-t border-gray-200 text-sm font-black text-[#0A0A0A]"><span>{isExchange ? 'Credit from returned items' : 'Refund to customer'}</span><span>{formatCurrency(refund.refund_total)}</span></div>
            {isExchange && (
              <>
                <div className="flex justify-between"><span>New items</span><span>{formatCurrency(newTotal)}</span></div>
                <div className={`flex justify-between text-sm font-black ${settle.pay > 0 ? 'text-rose-700' : settle.back > 0 ? 'text-emerald-700' : 'text-gray-700'}`}>
                  <span>{settle.pay > 0 ? 'Customer pays the difference' : settle.back > 0 ? 'Shop pays back the difference' : newRows.length > 0 ? 'Even exchange, no money changes hands' : 'Add the new items'}</span>
                  <span>{settle.pay > 0 ? formatCurrency(settle.pay) : settle.back > 0 ? formatCurrency(settle.back) : formatCurrency(0)}</span>
                </div>
              </>
            )}
            {order.delivery_charge > 0 && (
              <p className="pt-1 text-[11px] font-semibold text-amber-700">Delivery charge {formatCurrency(order.delivery_charge)} is not refunded.</p>
            )}
          </div>

          {/* Refund method (or, in an exchange, how the difference is paid) */}
          {(!isExchange || moneyDue > 0.004) && (
          <div>
            <span className={labelCls}>{!isExchange ? 'Refund paid as' : settle.pay > 0 ? 'Customer pays the difference by' : 'Shop pays back by'}</span>
            <div className="grid grid-cols-4 gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                  className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 cursor-pointer transition-colors ${method === m.id ? 'bg-[#0A0A0A] text-accent border-[#0A0A0A]' : 'bg-white text-[#374151] border-gray-200 hover:border-gray-300'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {method === 'split' && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SPLIT_PARTS.map((p) => (
                  <div key={p.id}>
                    <span className="block text-[10px] font-bold text-gray-500 mb-0.5">{p.label}</span>
                    <input type="number" min="0" step="0.01" className={`${fieldCls} h-9`} value={splitInputs[p.id]} placeholder="0.00"
                      onChange={(e) => setSplitInputs({ ...splitInputs, [p.id]: e.target.value })} />
                  </div>
                ))}
                <p className={`col-span-3 text-[11px] font-black ${Math.abs(splitDiff) <= 0.004 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {Math.abs(splitDiff) <= 0.004 ? 'Matches the amount' : splitDiff > 0 ? `Still to cover ${formatCurrency(splitDiff)}` : `Over the amount by ${formatCurrency(-splitDiff)}`}
                </p>
              </div>
            )}
          </div>
          )}

          <div>
            <label className={labelCls}>Reason (optional)</label>
            <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, damaged, customer changed mind" />
          </div>

          {/* Admin confirmation */}
          <div className="rounded-xl border border-accent-light bg-accent-soft p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={15} className="text-accent-dark" />
              <span className="text-xs font-black text-[#0A0A0A]">Admin confirmation</span>
            </div>
            {isAdmin ? (
              <label className="flex items-start gap-2 text-xs font-bold text-gray-800 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={adminTick} onChange={(e) => setAdminTick(e.target.checked)} />
                {isExchange ? `I confirm this exchange (credit ${formatCurrency(refund.refund_total)}) as admin.` : `I confirm this refund of ${formatCurrency(refund.refund_total)} as admin.`}
              </label>
            ) : (
              <div>
                {adminUnlocked ? (
                  <p className="text-xs font-black text-emerald-700">Admin verified ✓ The admin can now choose which items go back into stock.</p>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-gray-600 mb-1.5">A refund or exchange must be approved by the admin. Ask the admin to enter their password; the admin also decides whether the returned items go back into stock.</p>
                    <div className="flex gap-2">
                      <input type="password" className={fieldCls} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void unlockAdmin() }} placeholder="Admin password" autoComplete="off" />
                      <button type="button" onClick={() => void unlockAdmin()} className="h-10 shrink-0 px-4 rounded-xl bg-[#0A0A0A] text-accent text-xs font-bold cursor-pointer">Verify</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 px-5 py-3.5 border-t border-gray-100 bg-white flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="h-10 px-5 rounded-xl border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 cursor-pointer">Cancel</button>
          <button type="button" disabled={saving || nothingLeft || refund.lines.length === 0 || (isExchange && newRows.length === 0)} onClick={() => void submit()}
            className="h-10 px-6 rounded-xl bg-[#0A0A0A] text-accent text-xs font-bold tracking-wide disabled:opacity-50 cursor-pointer">
            {saving ? 'Processing…' : isExchange ? 'Confirm exchange' : `Confirm refund ${formatCurrency(refund.refund_total)}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
