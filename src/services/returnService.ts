import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { OrderReturn, ReturnPick } from '../lib/returns'

const MISSING_HINT =
  'Returns are not set up yet. Run supabase/migrations/20261114_0033_order_returns.sql in the Supabase SQL editor.'

const friendly = (message: string): string =>
  /order_returns|create_order_return|schema cache|could not find the function/i.test(message) ? MISSING_HINT : message

const toReturn = (row: Record<string, unknown>): OrderReturn => ({
  id: String(row.id),
  return_no: String(row.return_no),
  order_id: String(row.order_id),
  invoice_no: String(row.invoice_no || ''),
  customer_name: String(row.customer_name || ''),
  phone: String(row.phone || ''),
  items: Array.isArray(row.items) ? (row.items as OrderReturn['items']) : [],
  items_total: Number(row.items_total) || 0,
  discount_share: Number(row.discount_share) || 0,
  gst_share: Number(row.gst_share) || 0,
  refund_total: Number(row.refund_total) || 0,
  delivery_charge_kept: Number(row.delivery_charge_kept) || 0,
  refund_method: String(row.refund_method || 'cash'),
  refund_split: (row.refund_split && typeof row.refund_split === 'object' ? row.refund_split : {}) as Record<string, number>,
  reason: String(row.reason || ''),
  confirmed_by: String(row.confirmed_by || ''),
  created_at: String(row.created_at || ''),
  exchange_order_id: row.exchange_order_id ? String(row.exchange_order_id) : null,
  exchange_invoice_no: String(row.exchange_invoice_no || ''),
  exchange_total: Number(row.exchange_total) || 0,
  credit_applied: Number(row.credit_applied) || 0,
})

const friendlyExchange = (message: string): string =>
  /create_exchange|exchange_order_id|schema cache|could not find the function/i.test(message)
    ? 'Exchanges are not set up yet. Run supabase/migrations/20261116_0035_order_exchange.sql in the Supabase SQL editor.'
    : friendly(message)

export const returnService = {
  /** All returns, newest first. Resolves to [] when the returns table is not there yet. */
  async list(): Promise<OrderReturn[]> {
    if (!isSupabaseConfigured) return []
    const { data, error } = await supabase.from('order_returns').select('*').order('created_at', { ascending: false }).limit(5000)
    if (error || !data) return []
    return (data as Record<string, unknown>[]).map(toReturn)
  },

  async create(input: {
    orderId: string
    picks: ReturnPick[]
    refundMethod: string
    refundSplit: Record<string, number>
    reason: string
    confirmedBy: string
  }): Promise<{ data: OrderReturn; error: null } | { data: null; error: string }> {
    if (!isSupabaseConfigured) return { data: null, error: 'Connect Supabase to process returns.' }
    const { data, error } = await supabase.rpc('create_order_return', {
      p_order_id: input.orderId,
      p_items: input.picks.filter((p) => p.quantity > 0),
      p_refund_method: input.refundMethod,
      p_refund_split: input.refundSplit,
      p_reason: input.reason,
      p_confirmed_by: input.confirmedBy,
    })
    if (error) return { data: null, error: friendly(error.message || 'Could not save the return.') }

    const returnId = (Array.isArray(data) ? data[0] : data)?.return_id
    const { data: row, error: fetchError } = await supabase.from('order_returns').select('*').eq('id', returnId).single()
    if (fetchError || !row) return { data: null, error: 'The return was saved, but it could not be loaded. Refresh the page.' }
    return { data: toReturn(row as Record<string, unknown>), error: null }
  },

  /**
   * Exchange: returns items and creates the replacement bill in ONE database step.
   * Resolves to the credit note (with the new bill's invoice number) or an error message.
   */
  async createExchange(input: {
    orderId: string
    picks: ReturnPick[]
    newItems: unknown[]
    payMethod: string
    paySplit: Record<string, number>
    backMethod: string
    backSplit: Record<string, number>
    reason: string
    confirmedBy: string
  }): Promise<{ data: OrderReturn; error: null } | { data: null; error: string }> {
    if (!isSupabaseConfigured) return { data: null, error: 'Connect Supabase to process exchanges.' }
    const { data, error } = await supabase.rpc('create_exchange', {
      p_order_id: input.orderId,
      p_return_items: input.picks.filter((p) => p.quantity > 0),
      p_new_items: input.newItems,
      p_pay_method: input.payMethod,
      p_pay_split: input.paySplit,
      p_back_method: input.backMethod,
      p_back_split: input.backSplit,
      p_reason: input.reason,
      p_confirmed_by: input.confirmedBy,
    })
    if (error) return { data: null, error: friendlyExchange(error.message || 'Could not save the exchange.') }

    const returnId = (Array.isArray(data) ? data[0] : data)?.return_id
    const { data: row, error: fetchError } = await supabase.from('order_returns').select('*').eq('id', returnId).single()
    if (fetchError || !row) return { data: null, error: 'The exchange was saved, but it could not be loaded. Refresh the page.' }
    return { data: toReturn(row as Record<string, unknown>), error: null }
  },
}
