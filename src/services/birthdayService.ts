import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phone'
import { DEFAULT_BIRTHDAY_TEMPLATE, type BirthdayCustomer } from '../lib/birthdays'

export interface BirthdayOffer {
  id: string
  title: string
}

export interface BirthdaySettings {
  message_template: string
  selected_offer_id: string | null
}

export interface OrderCustomer {
  name: string
  phone: string // 91XXXXXXXXXX
}

export interface BirthdayInput {
  name: string
  phone: string
  birth_day: number
  birth_month: number
  birth_year: number | null
}

const MISSING_TABLE_HINT =
  'Birthday tables are missing. Run supabase/migrations/20261111_0028_customer_birthdays.sql in the Supabase SQL editor.'

const friendly = (message: string | undefined): string => {
  if (!message) return 'Something went wrong. Try again.'
  return /relation .* does not exist|schema cache|customer_birthdays|birthday_/i.test(message) ? MISSING_TABLE_HINT : message
}

type Result<T> = { data: T; error: null } | { data: null; error: string }

const notConfigured = { data: null, error: 'Connect Supabase to use birthdays.' } as const

export const birthdayService = {
  async listCustomers(): Promise<Result<BirthdayCustomer[]>> {
    if (!isSupabaseConfigured) return notConfigured
    const { data, error } = await supabase
      .from('customer_birthdays')
      .select('id, name, phone, birth_day, birth_month, birth_year')
      .order('birth_month', { ascending: true })
      .order('birth_day', { ascending: true })
      .order('name', { ascending: true })
    if (error) return { data: null, error: friendly(error.message) }
    return { data: (data || []) as BirthdayCustomer[], error: null }
  },

  async saveCustomer(input: BirthdayInput): Promise<Result<BirthdayCustomer>> {
    if (!isSupabaseConfigured) return notConfigured
    const phone = normalizePhone(input.phone)
    if (!phone) return { data: null, error: 'Enter a valid 10-digit mobile number.' }
    const name = input.name.trim()
    if (!name) return { data: null, error: 'Enter the customer name.' }

    const { data, error } = await supabase
      .from('customer_birthdays')
      .upsert(
        {
          name,
          phone,
          birth_day: input.birth_day,
          birth_month: input.birth_month,
          birth_year: input.birth_year,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' },
      )
      .select('id, name, phone, birth_day, birth_month, birth_year')
      .single()
    if (error) return { data: null, error: friendly(error.message) }
    return { data: data as BirthdayCustomer, error: null }
  },

  async deleteCustomer(id: string): Promise<{ error: string | null }> {
    if (!isSupabaseConfigured) return { error: notConfigured.error }
    const { error } = await supabase.from('customer_birthdays').delete().eq('id', id)
    return { error: error ? friendly(error.message) : null }
  },

  /** Everyone who has bought (valid mobile number on a bill), newest first, one row per phone. */
  async listOrderCustomers(): Promise<Result<OrderCustomer[]>> {
    if (!isSupabaseConfigured) return notConfigured
    const { data, error } = await supabase
      .from('orders')
      .select('customer_name, phone, created_at')
      .neq('phone', '')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) return { data: null, error: error.message }
    const seen = new Map<string, OrderCustomer>()
    for (const row of (data || []) as { customer_name: string | null; phone: string | null }[]) {
      const phone = row.phone ? normalizePhone(row.phone) : null
      if (!phone || seen.has(phone)) continue
      const name = (row.customer_name || '').trim()
      seen.set(phone, { name: !name || /^(walk-in customer|customer)$/i.test(name) ? '' : name, phone })
    }
    return { data: [...seen.values()], error: null }
  },

  async listOffers(): Promise<Result<BirthdayOffer[]>> {
    if (!isSupabaseConfigured) return notConfigured
    const { data, error } = await supabase.from('birthday_offers').select('id, title').order('created_at', { ascending: true })
    if (error) return { data: null, error: friendly(error.message) }
    return { data: (data || []) as BirthdayOffer[], error: null }
  },

  async addOffer(title: string): Promise<Result<BirthdayOffer>> {
    if (!isSupabaseConfigured) return notConfigured
    const clean = title.trim()
    if (!clean) return { data: null, error: 'Enter the offer text.' }
    const { data, error } = await supabase.from('birthday_offers').insert({ title: clean }).select('id, title').single()
    if (error) return { data: null, error: /duplicate|unique/i.test(error.message) ? 'That offer already exists.' : friendly(error.message) }
    return { data: data as BirthdayOffer, error: null }
  },

  async updateOffer(id: string, title: string): Promise<Result<BirthdayOffer>> {
    if (!isSupabaseConfigured) return notConfigured
    const clean = title.trim()
    if (!clean) return { data: null, error: 'Enter the offer text.' }
    const { data, error } = await supabase.from('birthday_offers').update({ title: clean }).eq('id', id).select('id, title').single()
    if (error) return { data: null, error: /duplicate|unique/i.test(error.message) ? 'That offer already exists.' : friendly(error.message) }
    return { data: data as BirthdayOffer, error: null }
  },

  async deleteOffer(id: string): Promise<{ error: string | null }> {
    if (!isSupabaseConfigured) return { error: notConfigured.error }
    const { error } = await supabase.from('birthday_offers').delete().eq('id', id)
    return { error: error ? friendly(error.message) : null }
  },

  async getSettings(): Promise<Result<BirthdaySettings>> {
    if (!isSupabaseConfigured) return notConfigured
    const { data, error } = await supabase
      .from('birthday_settings')
      .select('message_template, selected_offer_id')
      .eq('id', 1)
      .maybeSingle()
    if (error) return { data: null, error: friendly(error.message) }
    return {
      data: {
        message_template: data?.message_template?.trim() ? data.message_template : DEFAULT_BIRTHDAY_TEMPLATE,
        selected_offer_id: data?.selected_offer_id ?? null,
      },
      error: null,
    }
  },

  async saveSettings(settings: BirthdaySettings): Promise<{ error: string | null }> {
    if (!isSupabaseConfigured) return { error: notConfigured.error }
    const { error } = await supabase.from('birthday_settings').upsert(
      {
        id: 1,
        message_template: settings.message_template,
        selected_offer_id: settings.selected_offer_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    return { error: error ? friendly(error.message) : null }
  },
}
