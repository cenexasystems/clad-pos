import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { formatCurrency } from '../../lib/retail'

export interface AppliedCoupon { code: string; percentage: number; minOrderValue: number; discount: number }

/** What the person typed/chose for the new (exchange) bill: same options as a POS bill. */
export interface ExchangeBillState {
  coupon: AppliedCoupon | null
  manualType: 'flat' | 'percent'
  manualValue: string
  gstOn: boolean
  gstType: 'flat' | 'percent'
  gstValue: string
  delivery: string
}

export const emptyBillState: ExchangeBillState = {
  coupon: null, manualType: 'flat', manualValue: '', gstOn: false, gstType: 'percent', gstValue: '', delivery: '',
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Same arithmetic as the POS cart: items - coupon - manual discount + GST + delivery. */
export const computeBill = (subtotal: number, s: ExchangeBillState, deliverySign: 1 | -1 = 1) => {
  const couponOk = s.coupon && subtotal >= (s.coupon.minOrderValue || 0)
  const couponDiscount = couponOk && s.coupon
    ? (s.coupon.percentage > 0 ? r2((subtotal * s.coupon.percentage) / 100) : s.coupon.discount)
    : 0
  const manualNumeric = Math.max(0, Number(s.manualValue) || 0)
  const manualDiscount = s.manualType === 'percent' ? r2((subtotal * manualNumeric) / 100) : manualNumeric
  const discounted = Math.max(0, subtotal - couponDiscount - manualDiscount)
  const gstNumeric = Math.max(0, Number(s.gstValue) || 0)
  const totalGst = s.gstOn ? (s.gstType === 'percent' ? r2((discounted * gstNumeric) / 100) : gstNumeric) : 0
  const delivery = Math.max(0, Number(s.delivery) || 0)
  return {
    couponDiscount, manualDiscount, manualNumeric, totalGst, delivery,
    total: Math.max(0, r2(discounted + totalGst + deliverySign * delivery)),
  }
}

const inputCls = 'w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[#0A0A0A]'
const labelCls = 'block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1'

/** Coupon, manual discount, GST, delivery and grand total for the new bill of an exchange. */
export const ExchangeBillPanel: React.FC<{
  subtotal: number
  itemCount: number
  state: ExchangeBillState
  onChange: (next: ExchangeBillState) => void
  /** refund mode: delivery is deducted and the total is the refund */
  refund?: boolean
}> = ({ subtotal, itemCount, state, onChange, refund = false }) => {
  const [couponInput, setCouponInput] = useState('')
  const [couponError, setCouponError] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const calc = computeBill(subtotal, state, refund ? -1 : 1)
  const set = (patch: Partial<ExchangeBillState>) => onChange({ ...state, ...patch })

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase()
    if (!code) return setCouponError('Enter a coupon code')
    if (!isSupabaseConfigured) return setCouponError('Coupon validation requires a live connection')
    setCouponLoading(true)
    setCouponError('')
    try {
      const { data, error } = await supabase.from('coupons').select('*').eq('is_active', true).ilike('code', code).single()
      if (error || !data) return setCouponError('Invalid or expired coupon code')
      if (data.expiry_date && new Date(data.expiry_date) < new Date()) return setCouponError('This coupon has expired')
      if (data.usage_limit && data.usage_count >= data.usage_limit) return setCouponError('Coupon usage limit has been reached')
      if (data.min_order_value && subtotal < Number(data.min_order_value)) return setCouponError(`Minimum order of ${formatCurrency(Number(data.min_order_value))} required`)
      set({ coupon: { code: String(data.code), percentage: Number(data.percentage) || 0, minOrderValue: Number(data.min_order_value || 0), discount: Number(data.discount || 0) } })
    } catch {
      setCouponError('Failed to validate coupon. Try again.')
    } finally {
      setCouponLoading(false)
    }
  }

  const removeCoupon = () => {
    set({ coupon: null })
    setCouponInput('')
    setCouponError('')
  }

  const selectCls = 'appearance-none h-9 bg-white border border-gray-200 rounded-xl pl-2 pr-7 text-[12px] font-black text-[#111111] focus:outline-none focus:border-[#0A0A0A]'

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Coupon Code</label>
        <div className="flex gap-2">
          <input
            type="text" value={state.coupon ? state.coupon.code : couponInput} placeholder="Enter code" disabled={state.coupon !== null}
            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
            className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] placeholder:text-gray-400 placeholder:font-normal focus:outline-none focus:border-[#0A0A0A] uppercase disabled:bg-gray-100"
          />
          {state.coupon ? (
            <button type="button" onClick={removeCoupon} className="h-9 px-3 bg-red-100 text-red-600 hover:bg-red-200 rounded-xl text-[11px] font-black shrink-0 cursor-pointer">Remove</button>
          ) : (
            <button type="button" onClick={() => void applyCoupon()} disabled={couponLoading || !couponInput.trim()}
              className="h-9 px-3 bg-[#0A0A0A] text-accent border border-accent rounded-xl text-[11px] font-black disabled:opacity-50 shrink-0 cursor-pointer">Apply</button>
          )}
        </div>
        {couponError && <p className="text-[10px] font-bold text-red-500 mt-0.5">{couponError}</p>}
        {state.coupon && <p className="text-[10px] font-bold text-green-600 mt-0.5">Applied: -{formatCurrency(calc.couponDiscount)}</p>}
      </div>

      <div>
        <label className={labelCls}>Manual Discount</label>
        <div className="flex gap-2">
          <div className="relative shrink-0">
            <select value={state.manualType} onChange={(e) => set({ manualType: e.target.value as 'flat' | 'percent' })} className={selectCls}>
              <option value="flat">₹</option>
              <option value="percent">%</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#374151] pointer-events-none" />
          </div>
          <input type="number" min="0" placeholder="0" value={state.manualValue} className={inputCls}
            onWheel={(e) => (e.target as HTMLInputElement).blur()} onChange={(e) => set({ manualValue: e.target.value })} />
        </div>
      </div>

      <div className="flex items-center justify-between py-1 border-b border-gray-200">
        <span className="text-[11px] font-black text-[#374151]">Enable GST on Bill</span>
        <button type="button" aria-label="Enable GST on bill" onClick={() => set({ gstOn: !state.gstOn })}
          className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${state.gstOn ? 'bg-[#0A0A0A]' : 'bg-gray-200'}`}>
          <div className={`w-4 h-4 rounded-full bg-white transition-transform ${state.gstOn ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {state.gstOn && (
        <div className="flex gap-2">
          <div className="relative shrink-0">
            <select value={state.gstType} onChange={(e) => set({ gstType: e.target.value as 'flat' | 'percent' })} className={selectCls}>
              <option value="percent">%</option>
              <option value="flat">₹</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#374151] pointer-events-none" />
          </div>
          <input type="number" min="0" value={state.gstValue} placeholder={state.gstType === 'percent' ? 'e.g. 6' : '0'} className={inputCls}
            onWheel={(e) => (e.target as HTMLInputElement).blur()} onChange={(e) => set({ gstValue: e.target.value })} />
        </div>
      )}

      <div className="bg-[#FAFAF8] rounded-xl border border-gray-200 p-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black text-[#374151]">{refund ? `Returned items (${itemCount})` : `Subtotal (${itemCount} items)`}</span>
          <span className="text-[12px] font-black text-[#111111]">{formatCurrency(subtotal)}</span>
        </div>
        {calc.couponDiscount > 0 && (
          <div className="flex items-center justify-between"><span className="text-[11px] font-black text-[#374151]">Coupon</span><span className="text-[12px] font-black text-green-700">- {formatCurrency(calc.couponDiscount)}</span></div>
        )}
        {calc.manualDiscount > 0 && (
          <div className="flex items-center justify-between"><span className="text-[11px] font-black text-[#374151]">Discount</span><span className="text-[12px] font-black text-green-700">- {formatCurrency(calc.manualDiscount)}</span></div>
        )}
        {state.gstOn && calc.totalGst > 0 && (
          <div className="flex items-center justify-between"><span className="text-[11px] font-black text-[#374151]">GST Amount</span><span className="text-[12px] font-black text-[#111111]">{formatCurrency(calc.totalGst)}</span></div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black text-[#374151]">{refund ? 'Delivery (deducted)' : 'Delivery'}</span>
          <input type="number" min="0" value={state.delivery} placeholder="0" className="w-20 h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[#0A0A0A]"
            onWheel={(e) => (e.target as HTMLInputElement).blur()} onChange={(e) => set({ delivery: e.target.value })} />
        </div>
        <div className="h-px bg-gray-200" />
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[12px] font-black text-[#111111] uppercase tracking-wider">{refund ? 'Refund Total' : 'Grand Total'}</span>
          <span className="text-[20px] font-black text-[#0A0A0A] tracking-tight">{formatCurrency(calc.total)}</span>
        </div>
      </div>
    </div>
  )
}
