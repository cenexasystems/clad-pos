import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phone'
import { birthdayService } from './birthdayService'

export interface CouponRecipient {
  name: string
  phone: string // 91XXXXXXXXXX
}

// Sending still works when the coupon_sends table doesn't exist yet (migration 0029 not run):
// the WhatsApp chat opens as usual, it just isn't counted.
export const couponShareService = {
  /** coupon id -> how many customers it was sent to */
  async listSendCounts(): Promise<Record<number, number>> {
    if (!isSupabaseConfigured) return {}
    const { data, error } = await supabase.from('coupon_sends').select('coupon_id, phone').limit(20000)
    if (error || !data) return {}
    const seen: Record<number, Set<string>> = {}
    for (const row of data as { coupon_id: number; phone: string }[]) {
      ;(seen[row.coupon_id] ||= new Set()).add(row.phone)
    }
    return Object.fromEntries(Object.entries(seen).map(([id, phones]) => [Number(id), phones.size]))
  },

  async listSentPhones(couponId: number): Promise<Set<string>> {
    if (!isSupabaseConfigured) return new Set()
    const { data, error } = await supabase.from('coupon_sends').select('phone').eq('coupon_id', couponId)
    if (error || !data) return new Set()
    return new Set((data as { phone: string }[]).map((r) => r.phone))
  },

  async recordSend(couponId: number, phone: string, name: string): Promise<void> {
    if (!isSupabaseConfigured) return
    const normalized = normalizePhone(phone)
    if (!normalized) return
    await supabase.from('coupon_sends').insert({ coupon_id: couponId, phone: normalized, customer_name: name.trim() })
  },

  /** Everyone we can message: customers from past bills plus anyone saved with a birthday. */
  async listRecipients(): Promise<CouponRecipient[]> {
    if (!isSupabaseConfigured) return []
    const [orders, births] = await Promise.all([
      birthdayService.listOrderCustomers(),
      supabase.from('customer_birthdays').select('name, phone'),
    ])
    const byPhone = new Map<string, CouponRecipient>()
    for (const c of orders.data || []) byPhone.set(c.phone, { name: c.name, phone: c.phone })
    for (const b of (births.data || []) as { name: string; phone: string }[]) {
      const existing = byPhone.get(b.phone)
      if (existing) existing.name = existing.name || b.name
      else byPhone.set(b.phone, { name: b.name, phone: b.phone })
    }
    return [...byPhone.values()].sort((a, b) => (a.name || '~').localeCompare(b.name || '~'))
  },
}
