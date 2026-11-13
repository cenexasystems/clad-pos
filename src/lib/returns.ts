import { paymentModeLabel, splitSummary, type SplitAmounts } from './paymentModes'

// Return / refund rules, shared by the return window and the analytics boxes.
// The database function create_order_return() does the same maths and is the authority;
// this copy only previews the refund before the admin confirms it.

export interface ReturnLine {
  line_index: number
  name: string
  product_id: string | null
  variant_id: string | null
  variant_name: string | null
  unit: string
  is_manual: boolean
  quantity: number
  unit_price: number
  base_total: number
  discount_share: number
  gst_share: number
  refund_amount: number
  /** the shop chose to add it back to stock */
  restock: boolean
  /** it really was added (false for manual items or items that no longer exist) */
  restocked: boolean
}

export interface OrderReturn {
  id: string
  return_no: string
  order_id: string
  invoice_no: string
  customer_name: string
  phone: string
  items: ReturnLine[]
  items_total: number
  discount_share: number
  gst_share: number
  refund_total: number
  /** delivery charge on the original bill: never refunded */
  delivery_charge_kept: number
  refund_method: string
  refund_split: Record<string, number>
  reason: string
  confirmed_by: string
  created_at: string
}

export interface ReturnableLine {
  line_index: number
  name: string
  variant_name: string | null
  unit: string
  is_manual: boolean
  ordered: number
  returned: number
  available: number
  unit_price: number
  line_total: number
}

export interface ReturnPick {
  line_index: number
  quantity: number
  restock: boolean
}

type BillForReturn = {
  items: Record<string, unknown>[]
  discount_amount: number
  manual_discount_amount: number
  total_gst: number
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const n = (v: unknown, fallback = 0) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

const lineTotalOf = (raw: Record<string, unknown>): number =>
  raw.line_total !== undefined && raw.line_total !== null && raw.line_total !== ''
    ? n(raw.line_total)
    : r2(n(raw.quantity) * n(raw.base_price ?? raw.price))

/** Every line of the bill with how much of it can still be returned. */
export const returnableLines = (items: Record<string, unknown>[], returns: OrderReturn[]): ReturnableLine[] => {
  const returned = new Map<number, number>()
  for (const ret of returns) {
    for (const line of ret.items || []) returned.set(line.line_index, (returned.get(line.line_index) || 0) + n(line.quantity))
  }
  return items.map((raw, index) => {
    const ordered = n(raw.quantity)
    const lineTotal = lineTotalOf(raw)
    const done = returned.get(index) || 0
    return {
      line_index: index,
      name: String(raw.name ?? raw.product_name ?? 'Item'),
      variant_name: raw.variant_name ? String(raw.variant_name) : null,
      unit: String(raw.unit ?? 'piece'),
      is_manual: Boolean(raw.is_manual),
      ordered,
      returned: done,
      available: Math.max(0, ordered - done),
      unit_price: ordered > 0 ? r2(lineTotal / ordered) : 0,
      line_total: lineTotal,
    }
  })
}

/**
 * Refund for the chosen items: price, minus the item's share of the bill discount (coupon + extra
 * discount), plus its share of the GST charged. The delivery charge is never refunded.
 */
export const computeRefund = (bill: BillForReturn, picks: ReturnPick[]) => {
  const subtotal = bill.items.reduce((sum, raw) => sum + lineTotalOf(raw), 0)
  const discountRatio = subtotal > 0 ? Math.min(1, (n(bill.discount_amount) + n(bill.manual_discount_amount)) / subtotal) : 0
  const gstRatio = subtotal > 0 ? n(bill.total_gst) / subtotal : 0

  const lines: ReturnLine[] = []
  for (const pick of picks) {
    if (pick.quantity <= 0) continue
    const raw = bill.items[pick.line_index]
    if (!raw) continue
    const ordered = n(raw.quantity)
    if (ordered <= 0) continue
    const lineTotal = lineTotalOf(raw)
    const base = r2((lineTotal * pick.quantity) / ordered)
    const discount = r2(base * discountRatio)
    const gst = r2(base * gstRatio)
    const isManual = Boolean(raw.is_manual)
    lines.push({
      line_index: pick.line_index,
      name: String(raw.name ?? raw.product_name ?? 'Item'),
      product_id: raw.product_id ? String(raw.product_id) : null,
      variant_id: raw.variant_id ? String(raw.variant_id) : null,
      variant_name: raw.variant_name ? String(raw.variant_name) : null,
      unit: String(raw.unit ?? 'piece'),
      is_manual: isManual,
      quantity: pick.quantity,
      unit_price: r2(lineTotal / ordered),
      base_total: base,
      discount_share: discount,
      gst_share: gst,
      refund_amount: r2(base - discount + gst),
      restock: pick.restock && !isManual,
      restocked: false,
    })
  }
  const sum = (pick: (l: ReturnLine) => number) => r2(lines.reduce((s, l) => s + pick(l), 0))
  return {
    lines,
    items_total: sum((l) => l.base_total),
    discount_share: sum((l) => l.discount_share),
    gst_share: sum((l) => l.gst_share),
    refund_total: sum((l) => l.refund_amount),
  }
}

/** "Cash", "GPay", or "Split (Cash ₹500 + Card ₹300)" */
export const refundMethodText = (ret: Pick<OrderReturn, 'refund_method' | 'refund_split'>): string =>
  ret.refund_method === 'split'
    ? `Split (${splitSummary({ cash: 0, card: 0, qr: 0, ...ret.refund_split } as SplitAmounts)})`
    : paymentModeLabel(ret.refund_method)

/** order id -> total refunded on it */
export const refundedByOrder = (returns: OrderReturn[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const ret of returns) out[ret.order_id] = r2((out[ret.order_id] || 0) + n(ret.refund_total))
  return out
}
