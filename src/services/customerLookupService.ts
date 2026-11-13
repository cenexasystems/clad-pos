import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phone'

export interface KnownCustomer {
  name: string
  address: string
  /** birthday saved for this number, if any */
  birthday?: { day: number; month: number; year: number | null }
}

const PLACEHOLDER_NAMES = /^(walk-in customer|customer)$/i
const PLACEHOLDER_ADDRESSES = /^(pos counter)$/i

/**
 * Find what we already know about a customer from their mobile number: the name and address
 * from their latest bill, or the name saved with their birthday. Returns null when the number
 * is incomplete or the customer is new.
 */
export async function lookupCustomerByPhone(rawPhone: string): Promise<KnownCustomer | null> {
  const phone = normalizePhone(rawPhone)
  if (!phone || !isSupabaseConfigured) return null

  // Bills keep the number exactly as the cashier typed it ("98765 43210", "+91...", "091..."),
  // so match the digits in order and confirm the exact number below.
  const pattern = `%${phone.slice(2).split('').join('%')}%`

  try {
    const [orders, birthdayResult] = await Promise.all([
      supabase
        .from('orders')
        .select('customer_name, phone, address, created_at')
        .ilike('phone', pattern)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('customer_birthdays').select('name, birth_day, birth_month, birth_year').eq('phone', phone).maybeSingle(),
    ])

    let name = ''
    let address = ''
    for (const row of (orders.data || []) as { customer_name: string | null; phone: string | null; address: string | null }[]) {
      if (normalizePhone(row.phone || '') !== phone) continue
      const rowName = (row.customer_name || '').trim()
      const rowAddress = (row.address || '').trim()
      if (!name && rowName && !PLACEHOLDER_NAMES.test(rowName)) name = rowName
      if (!address && rowAddress && !PLACEHOLDER_ADDRESSES.test(rowAddress)) address = rowAddress
      if (name && address) break
    }
    // birthday table may not exist yet (migration not run): ignore its error and use the bill data
    const birthdayRow = birthdayResult.data as { name?: string; birth_day?: number; birth_month?: number; birth_year?: number | null } | null
    if (!name && birthdayRow?.name) name = String(birthdayRow.name).trim()

    const day = Number(birthdayRow?.birth_day)
    const month = Number(birthdayRow?.birth_month)
    const year = Number(birthdayRow?.birth_year)
    const birthday = day >= 1 && month >= 1 ? { day, month, year: year >= 1900 ? year : null } : undefined
    return name || address || birthday ? { name, address, ...(birthday ? { birthday } : {}) } : null
  } catch {
    return null
  }
}
