/**
 * Centralized calendar-based date range utilities in local timezone (IST).
 * Never uses rolling windows.
 * Correctly handles Monday-start weeks, month boundaries (28/29/30/31),
 * year transitions, and custom ranges without UTC off-by-one errors.
 */

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom' | ''

export interface DateRange {
  start: Date | null
  end: Date | null
  startDateStr?: string
  endDateStr?: string
}

export interface CustomDateRange {
  from?: string | null
  to?: string | null
}

/**
 * Format a Date object to YYYY-MM-DD using LOCAL timezone (never UTC).
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Parse a local date string "YYYY-MM-DD" or "YYYY/MM/DD" into a local Date object.
 * When isEndOfDay is true, sets time to 23:59:59.999.
 * When false, sets time to 00:00:00.000.
 */
export function parseLocalDate(dateStr: string, isEndOfDay: boolean = false): Date | null {
  if (!dateStr) return null
  const trimmed = String(dateStr).trim()
  const parts = trimmed.split(/[-/]/)
  if (parts.length >= 3) {
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    const d = parseInt(parts[2].slice(0, 2), 10)
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return isEndOfDay
        ? new Date(y, m, d, 23, 59, 59, 999)
        : new Date(y, m, d, 0, 0, 0, 0)
    }
  }
  return null
}

/**
 * Safely parse any date value (ISO string, YYYY-MM-DD string, Date, or number)
 * into epoch milliseconds timestamp for exact comparison.
 */
export function parseDateToTimestamp(input: Date | string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return NaN
  if (typeof input === 'number') return input
  if (input instanceof Date) return input.getTime()

  const str = String(input).trim()
  if (!str) return NaN

  // Date-only string like "YYYY-MM-DD" or "YYYY/MM/DD" -> treat as local noon to avoid DST/offset shifts
  const dateOnlyMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (dateOnlyMatch) {
    const y = parseInt(dateOnlyMatch[1], 10)
    const m = parseInt(dateOnlyMatch[2], 10) - 1
    const d = parseInt(dateOnlyMatch[3], 10)
    return new Date(y, m, d, 12, 0, 0, 0).getTime()
  }

  // String with time without timezone: e.g. "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DD HH:mm:ss"
  const localDateTimeMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?$/)
  if (localDateTimeMatch) {
    const y = parseInt(localDateTimeMatch[1], 10)
    const m = parseInt(localDateTimeMatch[2], 10) - 1
    const d = parseInt(localDateTimeMatch[3], 10)
    const hh = parseInt(localDateTimeMatch[4], 10)
    const mm = parseInt(localDateTimeMatch[5], 10)
    const ss = localDateTimeMatch[6] ? parseInt(localDateTimeMatch[6], 10) : 0
    const ms = localDateTimeMatch[7] ? parseInt(localDateTimeMatch[7].slice(0, 3).padEnd(3, '0'), 10) : 0
    return new Date(y, m, d, hh, mm, ss, ms).getTime()
  }

  // ISO string with timezone (e.g. 2026-09-28T16:20:47Z or 2026-09-28T21:50:47+05:30)
  const parsed = new Date(str).getTime()
  return parsed
}

/**
 * Computes calendar-based date range for a given preset in local timezone.
 * Recompute on demand (e.g. filter change) so it is always accurate.
 */
export function getDateRange(
  preset: DatePreset,
  now: Date = new Date(),
  custom?: CustomDateRange
): DateRange {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const day = now.getDay() // 0=Sun, 1=Mon, ..., 6=Sat

  switch (preset) {
    case 'today': {
      const start = new Date(y, m, d, 0, 0, 0, 0)
      const end = new Date(y, m, d, 23, 59, 59, 999)
      return {
        start,
        end,
        startDateStr: formatLocalDate(start),
        endDateStr: formatLocalDate(end),
      }
    }
    case 'week': {
      // Monday 00:00:00.000 to Sunday 23:59:59.999
      const dayFromMonday = (day + 6) % 7 // Mon: 0, Tue: 1, ..., Sun: 6
      const start = new Date(y, m, d - dayFromMonday, 0, 0, 0, 0)
      const end = new Date(y, m, d + (6 - dayFromMonday), 23, 59, 59, 999)
      return {
        start,
        end,
        startDateStr: formatLocalDate(start),
        endDateStr: formatLocalDate(end),
      }
    }
    case 'month': {
      // 1st 00:00:00.000 to last day of month 23:59:59.999
      const start = new Date(y, m, 1, 0, 0, 0, 0)
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999)
      return {
        start,
        end,
        startDateStr: formatLocalDate(start),
        endDateStr: formatLocalDate(end),
      }
    }
    case 'year': {
      // Jan 1 00:00:00.000 to Dec 31 23:59:59.999
      const start = new Date(y, 0, 1, 0, 0, 0, 0)
      const end = new Date(y, 11, 31, 23, 59, 59, 999)
      return {
        start,
        end,
        startDateStr: formatLocalDate(start),
        endDateStr: formatLocalDate(end),
      }
    }
    case 'custom': {
      if (!custom?.from && !custom?.to) {
        return { start: null, end: null, startDateStr: '', endDateStr: '' }
      }
      let startDate = custom.from ? parseLocalDate(custom.from, false) : null
      let endDate = custom.to ? parseLocalDate(custom.to, true) : null

      // Validate from <= to; auto-swap if inverted
      if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
        const temp = startDate
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0)
        endDate = new Date(temp.getFullYear(), temp.getMonth(), temp.getDate(), 23, 59, 59, 999)
      }

      return {
        start: startDate,
        end: endDate,
        startDateStr: startDate ? formatLocalDate(startDate) : '',
        endDateStr: endDate ? formatLocalDate(endDate) : '',
      }
    }
    case 'all':
    case '':
    default:
      return { start: null, end: null, startDateStr: '', endDateStr: '' }
  }
}

/**
 * Checks if a given timestamp/date falls within the specified date range.
 * Inclusive on both start and end boundaries.
 */
export function isInRange(
  date: Date | string | number | null | undefined,
  range: DateRange | null | undefined
): boolean {
  if (!range) return true
  if (!range.start && !range.end) return true
  if (date === null || date === undefined || date === '') return false

  const t = parseDateToTimestamp(date)
  if (isNaN(t)) return false

  if (range.start && t < range.start.getTime()) return false
  if (range.end && t > range.end.getTime()) return false
  return true
}
