import { BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'

export interface BirthdayCustomer {
  id: string
  name: string
  phone: string // 91XXXXXXXXXX
  birth_day: number
  birth_month: number
  birth_year: number | null
}

export type BirthdayPreset = 'today' | 'week' | 'month' | 'all' | 'custom'

export interface MonthDay {
  month: number // 1-12
  day: number // 1-31
}

export interface MonthDayRange {
  from: MonthDay
  to: MonthDay
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3))

export const DEFAULT_BIRTHDAY_TEMPLATE =
  "Hi {name}! 🎂 Happy Birthday!\n\nHere's a special treat from {shop}:\n🎁 {offer}\n\nVisit us in store or call {phone}.\nFollow us on Instagram @{instagram}\n\n– {shop}"

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Days in a month. February counts 29 so a Feb 29 birthday can be picked. */
export const daysInMonth = (month: number, year = 2024): number => new Date(year, month, 0).getDate()

/** Position of a month/day inside a non-leap year (1-365). Feb 29 is treated as Feb 28. */
export const dayOfYear = ({ month, day }: MonthDay): number => {
  const cap = month === 2 && day === 29 ? 28 : day
  return Math.round((Date.UTC(2023, month - 1, cap) - Date.UTC(2023, 0, 1)) / 86400000) + 1
}

export const monthDayOf = (d: Date): MonthDay => ({ month: d.getMonth() + 1, day: d.getDate() })

/** True when the customer's birthday falls inside the (year-agnostic) range; ranges may wrap Dec -> Jan. */
export const isBirthdayInRange = (c: Pick<BirthdayCustomer, 'birth_day' | 'birth_month'>, range: MonthDayRange): boolean => {
  const v = dayOfYear({ month: c.birth_month, day: c.birth_day })
  const from = dayOfYear(range.from)
  const to = dayOfYear(range.to)
  return from <= to ? v >= from && v <= to : v >= from || v <= to
}

export const presetRange = (preset: Exclude<BirthdayPreset, 'custom'>, today = new Date()): MonthDayRange | null => {
  if (preset === 'all') return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (preset === 'today') return { from: monthDayOf(start), to: monthDayOf(start) }
  if (preset === 'week') {
    // Monday - Sunday week containing today
    const dow = (start.getDay() + 6) % 7
    const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() - dow)
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
    return { from: monthDayOf(monday), to: monthDayOf(sunday) }
  }
  return {
    from: { month: start.getMonth() + 1, day: 1 },
    to: { month: start.getMonth() + 1, day: daysInMonth(start.getMonth() + 1, start.getFullYear()) },
  }
}

/** Whole days from `today` until the customer's next birthday (0 = today). */
export const daysUntilBirthday = (c: Pick<BirthdayCustomer, 'birth_day' | 'birth_month'>, today = new Date()): number => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const next = (year: number) => {
    const day = c.birth_month === 2 && c.birth_day === 29 && !isLeapYear(year) ? 28 : c.birth_day
    return new Date(year, c.birth_month - 1, day)
  }
  let target = next(start.getFullYear())
  if (target < start) target = next(start.getFullYear() + 1)
  return Math.round((target.getTime() - start.getTime()) / 86400000)
}

export const formatBirthday = (c: Pick<BirthdayCustomer, 'birth_day' | 'birth_month' | 'birth_year'>): string =>
  `${c.birth_day} ${MONTH_SHORT[c.birth_month - 1]}${c.birth_year ? ` ${c.birth_year}` : ''}`

export const daysUntilLabel = (days: number): string =>
  days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`

/** Fill {name} {shop} {offer} {phone} {instagram}; unknown {words} are left untouched. */
export const buildBirthdayMessage = (
  template: string,
  vars: { name: string; offer: string },
): string => {
  const values: Record<string, string> = {
    name: vars.name,
    shop: BRAND_EN,
    offer: vars.offer,
    phone: BRAND_PRIMARY_PHONE_DISPLAY,
    instagram: BRAND_INSTAGRAM,
  }
  // No offer picked: drop the "🎁 {offer}" line instead of sending an empty gift
  const source = vars.offer.trim()
    ? template
    : template.split('\n').filter((line) => !line.includes('{offer}')).join('\n')
  return source.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match))
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`

export function exportBirthdaysToCSV(customers: BirthdayCustomer[]): void {
  const headers = ['Name', 'Phone', 'Birthday', 'Birth Year']
  const rows = customers.map((c) => [
    csvCell(c.name),
    // leading tab keeps Excel from turning the number into 9.19E+11
    csvCell(`\t+${c.phone}`),
    csvCell(`${c.birth_day} ${MONTH_NAMES[c.birth_month - 1]}`),
    c.birth_year ? String(c.birth_year) : '',
  ])
  const csv = '﻿' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `CLAD-Birthdays-${new Date().toISOString().slice(0, 10)}.csv`)
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
