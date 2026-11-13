import { paymentBucket } from './paymentModes'
import type { OrderReturn } from './returns'

export interface CollectionBill {
  total: number
  payment_mode: string
  split_details?: Record<string, unknown>
}

export interface Collections {
  cash: { sales: number; refunds: number; bills: number }
  card: { sales: number; refunds: number; bills: number }
  qr: { sales: number; refunds: number; bills: number }
  split: { sales: number; bills: number }
  other: { sales: number; bills: number }
}

/**
 * Money received per payment mode, and what was paid back. A split bill adds its cash / card / GPay
 * parts to those boxes (and is also counted in the Split box); a split refund takes its parts back
 * out the same way. Net collected for a mode = sales - refunds.
 */
export const computeCollections = (bills: CollectionBill[], returns: Pick<OrderReturn, 'refund_method' | 'refund_split' | 'refund_total'>[]): Collections => {
  const c: Collections = {
    cash: { sales: 0, refunds: 0, bills: 0 },
    card: { sales: 0, refunds: 0, bills: 0 },
    qr: { sales: 0, refunds: 0, bills: 0 },
    split: { sales: 0, bills: 0 },
    other: { sales: 0, bills: 0 },
  }
  for (const bill of bills) {
    const bucket = paymentBucket(bill.payment_mode)
    if (bucket === 'split') {
      const parts = bill.split_details || {}
      c.cash.sales += Number(parts.cash) || 0
      c.card.sales += Number(parts.card) || 0
      c.qr.sales += Number(parts.qr) || 0
      c.split.sales += bill.total
      c.split.bills += 1
    } else if (bucket === 'other') {
      c.other.sales += bill.total
      c.other.bills += 1
    } else {
      c[bucket].sales += bill.total
      c[bucket].bills += 1
    }
  }
  for (const ret of returns) {
    if (ret.refund_method === 'split') {
      c.cash.refunds += Number(ret.refund_split?.cash) || 0
      c.card.refunds += Number(ret.refund_split?.card) || 0
      c.qr.refunds += Number(ret.refund_split?.qr) || 0
    } else {
      const bucket = paymentBucket(ret.refund_method)
      if (bucket === 'cash' || bucket === 'card' || bucket === 'qr') c[bucket].refunds += Number(ret.refund_total) || 0
    }
  }
  return c
}
