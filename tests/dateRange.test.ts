import {
  getDateRange,
  isInRange,
  formatLocalDate,
  parseLocalDate,
  parseDateToTimestamp,
} from '../src/lib/dateRange'

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg}. Expected ${expected}, got ${actual}`)
  }
}

console.log('--- Running Date Range Unit Tests ---')

// 1. Test formatLocalDate and parseLocalDate
{
  const d = new Date(2026, 8, 28, 15, 30, 0)
  assertEqual(formatLocalDate(d), '2026-09-28', 'formatLocalDate handles normal date')

  const parsedStart = parseLocalDate('2026-09-28', false)!
  assertEqual(parsedStart.getFullYear(), 2026, 'parsedStart year')
  assertEqual(parsedStart.getMonth(), 8, 'parsedStart month (0-indexed)')
  assertEqual(parsedStart.getDate(), 28, 'parsedStart date')
  assertEqual(parsedStart.getHours(), 0, 'parsedStart hour')
  assertEqual(parsedStart.getMinutes(), 0, 'parsedStart min')
  assertEqual(parsedStart.getSeconds(), 0, 'parsedStart sec')
  assertEqual(parsedStart.getMilliseconds(), 0, 'parsedStart ms')

  const parsedEnd = parseLocalDate('2026-09-28', true)!
  assertEqual(parsedEnd.getHours(), 23, 'parsedEnd hour')
  assertEqual(parsedEnd.getMinutes(), 59, 'parsedEnd min')
  assertEqual(parsedEnd.getSeconds(), 59, 'parsedEnd sec')
  assertEqual(parsedEnd.getMilliseconds(), 999, 'parsedEnd ms')
}

// 2. Test Today preset
{
  // Monday 28 Sep 2026 at 14:30
  const nowMon = new Date(2026, 8, 28, 14, 30, 0)
  const range = getDateRange('today', nowMon)
  assertEqual(formatLocalDate(range.start!), '2026-09-28', 'Today start is 28 Sep')
  assertEqual(formatLocalDate(range.end!), '2026-09-28', 'Today end is 28 Sep')
  assertEqual(range.start!.getHours(), 0, 'Today start hour 0')
  assertEqual(range.end!.getHours(), 23, 'Today end hour 23')
  assertEqual(range.end!.getMinutes(), 59, 'Today end min 59')
  assertEqual(range.end!.getSeconds(), 59, 'Today end sec 59')
  assertEqual(range.end!.getMilliseconds(), 999, 'Today end ms 999')
}

// 3. Test This Week preset: Monday, Wednesday, Sunday
{
  // Monday 28 Sep 2026 (day = 1) -> Monday 28 Sep to Sunday 4 Oct
  const nowMon = new Date(2026, 8, 28, 10, 0, 0)
  const weekMon = getDateRange('week', nowMon)
  assertEqual(formatLocalDate(weekMon.start!), '2026-09-28', 'Mon: Week start is Mon 28 Sep')
  assertEqual(formatLocalDate(weekMon.end!), '2026-10-04', 'Mon: Week end is Sun 4 Oct')

  // Wednesday 30 Sep 2026 (day = 3) -> Monday 28 Sep to Sunday 4 Oct
  const nowWed = new Date(2026, 8, 30, 16, 0, 0)
  const weekWed = getDateRange('week', nowWed)
  assertEqual(formatLocalDate(weekWed.start!), '2026-09-28', 'Wed: Week start is Mon 28 Sep')
  assertEqual(formatLocalDate(weekWed.end!), '2026-10-04', 'Wed: Week end is Sun 4 Oct')

  // Sunday 4 Oct 2026 (day = 0) -> Monday 28 Sep to Sunday 4 Oct
  const nowSun = new Date(2026, 9, 4, 21, 0, 0)
  const weekSun = getDateRange('week', nowSun)
  assertEqual(formatLocalDate(weekSun.start!), '2026-09-28', 'Sun: Week start is Mon 28 Sep')
  assertEqual(formatLocalDate(weekSun.end!), '2026-10-04', 'Sun: Week end is Sun 4 Oct')
}

// 4. Test Week crossing a year boundary
{
  // Thursday 1 Jan 2026 (day = 4) -> Monday 29 Dec 2025 to Sunday 4 Jan 2026
  const nowJan1 = new Date(2026, 0, 1, 10, 0, 0)
  const weekCross = getDateRange('week', nowJan1)
  assertEqual(formatLocalDate(weekCross.start!), '2025-12-29', 'Year cross week start is Mon 29 Dec 2025')
  assertEqual(formatLocalDate(weekCross.end!), '2026-01-04', 'Year cross week end is Sun 4 Jan 2026')
}

// 5. Test Sunday 23:59:59.999 boundary
{
  const nowWed = new Date(2026, 8, 30, 12, 0, 0)
  const weekRange = getDateRange('week', nowWed)

  // Sunday 23:59:59.999 should be inside
  const sunInside = new Date(2026, 9, 4, 23, 59, 59, 999)
  assert(isInRange(sunInside, weekRange), 'Sunday 23:59:59.999 is in range')

  // Next Monday 00:00:00.000 should be outside
  const nextMonOutside = new Date(2026, 9, 5, 0, 0, 0, 0)
  assert(!isInRange(nextMonOutside, weekRange), 'Next Monday 00:00:00 is outside week range')

  // Previous Sunday 23:59:59.999 should be outside
  const prevSunOutside = new Date(2026, 8, 27, 23, 59, 59, 999)
  assert(!isInRange(prevSunOutside, weekRange), 'Previous Sunday 23:59:59.999 is outside week range')
}

// 6. Test Month boundary: 28, 29, 30, 31 days
{
  // Month of 31 days: March 2026
  const march = getDateRange('month', new Date(2026, 2, 15))
  assertEqual(formatLocalDate(march.start!), '2026-03-01', 'March start')
  assertEqual(formatLocalDate(march.end!), '2026-03-31', 'March end has 31 days')

  // Month of 30 days: April 2026
  const april = getDateRange('month', new Date(2026, 3, 10))
  assertEqual(formatLocalDate(april.start!), '2026-04-01', 'April start')
  assertEqual(formatLocalDate(april.end!), '2026-04-30', 'April end has 30 days')

  // Month of 28 days: Feb 2026 (non leap year)
  const feb2026 = getDateRange('month', new Date(2026, 1, 10))
  assertEqual(formatLocalDate(feb2026.start!), '2026-02-01', 'Feb 2026 start')
  assertEqual(formatLocalDate(feb2026.end!), '2026-02-28', 'Feb 2026 end has 28 days')

  // Month of 29 days: Feb 2024 (leap year)
  const feb2024 = getDateRange('month', new Date(2024, 1, 10))
  assertEqual(formatLocalDate(feb2024.start!), '2024-02-01', 'Feb 2024 start')
  assertEqual(formatLocalDate(feb2024.end!), '2024-02-29', 'Feb 2024 end has 29 days')
}

// 7. Test Custom range and auto-swapping if from > to
{
  const customNormal = getDateRange('custom', new Date(), { from: '2026-09-01', to: '2026-09-10' })
  assertEqual(formatLocalDate(customNormal.start!), '2026-09-01', 'Custom start normal')
  assertEqual(formatLocalDate(customNormal.end!), '2026-09-10', 'Custom end normal')

  // Auto swap if from > to
  const customSwapped = getDateRange('custom', new Date(), { from: '2026-09-20', to: '2026-09-05' })
  assertEqual(formatLocalDate(customSwapped.start!), '2026-09-05', 'Custom auto swap start')
  assertEqual(formatLocalDate(customSwapped.end!), '2026-09-20', 'Custom auto swap end')
}

// 8. Test parseDateToTimestamp with various string inputs
{
  const isoWithZ = '2026-09-28T10:00:00Z'
  const t1 = parseDateToTimestamp(isoWithZ)
  assertEqual(t1, new Date('2026-09-28T10:00:00Z').getTime(), 'parse ISO with Z')

  const dateOnly = '2026-09-28'
  const t2 = parseDateToTimestamp(dateOnly)
  assertEqual(t2, new Date(2026, 8, 28, 12, 0, 0, 0).getTime(), 'parse dateOnly local noon')
}

console.log('✓ ALL UNIT TESTS PASSED SUCCESSFULLY!')
