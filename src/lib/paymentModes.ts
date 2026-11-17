// One place for payment options so every screen shows them in the same order:
// Cash, Card, GPay, Split.

export type PaymentMode = 'cash' | 'card' | 'qr' | 'split'

/** Billing options, in display order. `qr` is the stored value for GPay / QR payments. */
export const PAYMENT_MODES: { id: PaymentMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'qr', label: 'GPay' },
  { id: 'split', label: 'Split' },
]

export type SplitPart = 'cash' | 'card' | 'qr'
export type SplitAmounts = Record<SplitPart, number>

export const SPLIT_PARTS: { id: SplitPart; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'qr', label: 'GPay' },
]

export const paymentModeLabel = (mode: string): string =>
  mode === 'exchange' ? 'Exchange credit' : (PAYMENT_MODES.find((m) => m.id === mode)?.label ?? mode)

const money = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`

/** "Cash ₹500 + Card ₹300" (parts that are zero are left out). */
export const splitSummary = (split: SplitAmounts): string =>
  SPLIT_PARTS.filter((p) => split[p.id] > 0)
    .map((p) => `${p.label} ${money(split[p.id])}`)
    .join(' + ')

/** Text printed on the bill: "Cash", "GPay", or "Split (Cash ₹500 + Card ₹300)". */
export const paymentDisplayLabel = (mode: PaymentMode, split?: SplitAmounts): string =>
  mode === 'split' && split ? `Split (${splitSummary(split)})` : paymentModeLabel(mode)

const cents = (n: number) => Math.round(n * 100)

/** Split parts must add up to exactly the bill total. */
export const splitDifference = (split: SplitAmounts, total: number): number =>
  (cents(total) - cents(split.cash) - cents(split.card) - cents(split.qr)) / 100

// Advance orders store 'upi' for GPay / QR (database rule), shown to staff as GPay.
export const ADVANCE_PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'GPay' },
] as const

export const advanceMethodLabel = (method?: string | null): string => {
  const key = (method || '').toLowerCase()
  return ADVANCE_PAYMENT_METHODS.find((m) => m.value === key)?.label ?? (method || '').toUpperCase()
}

/** Which analytics box a stored payment mode belongs to. Online / request orders and unknown values are 'other'. */
export const paymentBucket = (raw?: string | null): 'cash' | 'card' | 'qr' | 'split' | 'exchange' | 'other' => {
  const v = (raw || '').toLowerCase()
  if (v === 'exchange') return 'exchange'
  if (v.includes('split')) return 'split'
  if (v === 'qr' || v.includes('gpay') || v.includes('upi')) return 'qr'
  if (v.includes('card')) return 'card'
  if (v.includes('cash')) return 'cash'
  return 'other'
}

/**
 * What to print as the payment on a bill: "Cash", "Split (Cash ₹500 + Card ₹300)",
 * "Exchange credit ₹800" or "Exchange credit ₹800 + Cash ₹200". Splits that don't carry amounts keep their mode name.
 */
export const orderPaymentLabel = (mode: string, split?: Record<string, unknown> | null): string => {
  const raw = (mode || '').trim()
  if (!raw) return ''
  const key = raw.toLowerCase()
  if (key !== 'split' && key !== 'exchange') return paymentModeLabel(key) === key ? raw : paymentModeLabel(key)
  const num = (v: unknown) => Number(v) || 0
  const parts = [
    ['Exchange credit', num(split?.exchange)],
    ['Cash', num(split?.cash)],
    ['Card', num(split?.card)],
    ['GPay', num(split?.qr)],
  ].filter((p) => (p[1] as number) > 0).map((p) => `${p[0]} ${money(p[1] as number)}`)
  if (key === 'exchange') return parts.length ? parts.join(' + ') : 'Exchange credit'
  return parts.length ? `Split (${parts.join(' + ')})` : 'Split'
}
