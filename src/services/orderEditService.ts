import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { StructuredOrderItem } from '../lib/retail'

export interface OrderEditInput {
  orderId: string
  customerName: string
  phone: string
  address: string
  items: StructuredOrderItem[]
  subtotal: number
  total: number
  deliveryCharge: number
  manualDiscountAmount: number
  totalGst: number
  paymentMethod: string
  splitDetails?: Record<string, number>
  remarks: string
  referenceNumber: string
}

const MISSING_FUNCTION_HINT =
  'Bill editing is not set up yet. Run supabase/migrations/20261112_0030_update_order_with_stock.sql in the Supabase SQL editor.'

/** Saves an edited bill and fixes stock for the quantity changes. Resolves to an error message, or null on success. */
export async function updateOrderWithStock(input: OrderEditInput): Promise<string | null> {
  if (!isSupabaseConfigured) return 'Connect Supabase to edit bills.'

  const { error } = await supabase.rpc('update_order_with_stock', {
    p_order_id: input.orderId,
    p_customer_name: input.customerName,
    p_phone: input.phone,
    p_address: input.address,
    p_items: input.items,
    p_subtotal: input.subtotal,
    p_total: input.total,
    p_delivery_charge: input.deliveryCharge,
    p_manual_discount_amount: input.manualDiscountAmount,
    p_total_gst: input.totalGst,
    p_payment_method: input.paymentMethod,
    p_split_details: input.splitDetails ?? {},
    p_remarks: input.remarks || null,
    p_reference_number: input.referenceNumber || null,
  })
  if (!error) return null

  const message = error.message || 'Could not save the bill.'
  if (/update_order_with_stock|schema cache|could not find the function/i.test(message)) return MISSING_FUNCTION_HINT
  return message
}
