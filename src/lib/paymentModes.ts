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
  PAYMENT_MODES.find((m) => m.id === mode)?.label ?? mode

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
