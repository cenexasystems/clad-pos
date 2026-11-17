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

export interface CustomerSuggestion extends KnownCustomer {
  phone: string // 91XXXXXXXXXX
}

/**
 * Customers matching what the cashier has typed so far: 3+ letters of a name, or 4+ digits of a
 * mobile number (any 4 digits of it work, e.g. the last four). Newest customers first, one row per number.
 */
export async function searchCustomers(rawQuery: string, limit = 8): Promise<CustomerSuggestion[]> {
  const query = (rawQuery || '').trim()
  if (!query || !isSupabaseConfigured) return []
  const digits = query.replace(/\D/g, '')
  const byNumber = digits.length >= 4 && digits.length >= query.replace(/\s/g, '').length - 1
  const byName = !byNumber && query.length >= 3
  if (!byNumber && !byName) return []

  try {
    // phones are stored as typed ("98765 43210"), so match the digits in order, then confirm below
    const phonePattern = `%${digits.split('').join('%')}%`
    const namePattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`

    const [orders, saved] = await Promise.all([
      byNumber
        ? supabase.from('orders').select('customer_name, phone, address, created_at').ilike('phone', phonePattern).order('created_at', { ascending: false }).limit(120)
        : supabase.from('orders').select('customer_name, phone, address, created_at').ilike('customer_name', namePattern).order('created_at', { ascending: false }).limit(120),
      byNumber
        ? supabase.from('customer_birthdays').select('name, phone, birth_day, birth_month, birth_year').ilike('phone', `%${digits}%`).limit(20)
        : supabase.from('customer_birthdays').select('name, phone, birth_day, birth_month, birth_year').ilike('name', namePattern).limit(20),
    ])

    const found = new Map<string, CustomerSuggestion>()
    const keep = (phoneRaw: string | null, name: string, address: string) => {
      const phone = phoneRaw ? normalizePhone(phoneRaw) : null
      if (!phone) return
      if (byNumber && !phone.includes(digits)) return
      const cleanName = PLACEHOLDER_NAMES.test(name.trim()) ? '' : name.trim()
      const cleanAddress = PLACEHOLDER_ADDRESSES.test(address.trim()) ? '' : address.trim()
      const existing = found.get(phone)
      if (existing) {
        if (!existing.name && cleanName) existing.name = cleanName
        if (!existing.address && cleanAddress) existing.address = cleanAddress
      } else {
        found.set(phone, { name: cleanName, address: cleanAddress, phone })
      }
    }
    for (const row of (orders.data || []) as { customer_name: string | null; phone: string | null; address: string | null }[]) {
      keep(row.phone, row.customer_name || '', row.address || '')
    }
    for (const row of (saved.data || []) as { name: string; phone: string; birth_day: number; birth_month: number; birth_year: number | null }[]) {
      keep(row.phone, row.name || '', '')
      const entry = found.get(normalizePhone(row.phone) || '')
      if (entry && row.birth_day >= 1 && row.birth_month >= 1) {
        entry.birthday = { day: row.birth_day, month: row.birth_month, year: row.birth_year && row.birth_year >= 1900 ? row.birth_year : null }
      }
    }
    // a name search only keeps rows whose name really contains the text
    return [...found.values()]
      .filter((c) => byNumber || c.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
  } catch {
    return []
  }
}
