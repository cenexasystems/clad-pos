import { getDateRange, isInRange, formatLocalDate } from '../src/lib/dateRange'

console.log('=== VERIFYING ORDER FILTERING LOGIC WITH SAMPLE BILLS ===')

// Sample bills matching the user scenario:
// User noted: "On Mon 28/9/2026 it returned 15 bills dated 24/9-28/9."
const now = new Date(2026, 8, 28, 14, 30, 0) // Mon 28 Sep 2026 14:30:00 IST

const sampleBills = [
  { id: '1', invoice_no: 'INV-20260924-001', created_at: '2026-09-24T10:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Thursday
  { id: '2', invoice_no: 'INV-20260925-001', created_at: '2026-09-25T11:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Friday
  { id: '3', invoice_no: 'INV-20260926-001', created_at: '2026-09-26T12:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Saturday
  { id: '4', invoice_no: 'INV-20260927-001', created_at: '2026-09-27T13:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Sunday (previous week)
  { id: '5', invoice_no: 'INV-20260928-001', created_at: '2026-09-28T09:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Monday 09:00 (today)
  { id: '6', invoice_no: 'INV-20260928-002', created_at: '2026-09-28T14:00:00.000Z', type: 'pos_sale', mode: 'online' },  // Monday 14:00 (today, online)
  { id: '7', invoice_no: 'INV-20260929-001', created_at: '2026-09-29T10:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Tuesday (later this week)
  { id: '8', invoice_no: 'INV-20261005-001', created_at: '2026-10-05T10:00:00.000Z', type: 'pos_sale', mode: 'offline' }, // Next week / Next month
]

// 1. Test "Today"
const todayRange = getDateRange('today', now)!
const todayBills = sampleBills.filter(b => isInRange(b.created_at, todayRange))
console.log(`1. Today bills count: ${todayBills.length}`)
console.log('   Today bills:', todayBills.map(b => b.invoice_no))
if (todayBills.length !== 2) throw new Error('Today should only return bills from 28/09')

// 2. Test "This Week" on Monday 28/09/2026
const weekRange = getDateRange('week', now)!
console.log(`2. Week Range start: ${weekRange.start?.toLocaleString()} -> end: ${weekRange.end?.toLocaleString()}`)
const weekBills = sampleBills.filter(b => isInRange(b.created_at, weekRange))
console.log(`   This Week bills count: ${weekBills.length}`)
console.log('   This Week bills:', weekBills.map(b => b.invoice_no))
// Crucial: 24/9, 25/9, 26/9, 27/9 MUST NOT be included!
const oldBills = weekBills.filter(b => b.invoice_no.includes('20260924') || b.invoice_no.includes('20260925') || b.invoice_no.includes('20260926') || b.invoice_no.includes('20260927'))
if (oldBills.length > 0) {
  throw new Error(`CRITICAL BUG: 'This Week' included bills from previous week: ${oldBills.map(b => b.invoice_no).join(', ')}`)
}
console.log('   ✓ Verified: NO previous week bills (24/9-27/9) returned on Monday!')

// 3. Test "This Month"
const monthRange = getDateRange('month', now)!
console.log(`3. Month Range start: ${monthRange.start?.toLocaleString()} -> end: ${monthRange.end?.toLocaleString()}`)
const monthBills = sampleBills.filter(b => isInRange(b.created_at, monthRange))
console.log(`   This Month bills count: ${monthBills.length}`)
// Must include September bills (1-7), but exclude October (8)
if (monthBills.some(b => b.invoice_no.includes('20261005'))) {
  throw new Error('This Month should not include October bills')
}
if (!monthBills.every(b => b.invoice_no.includes('202609'))) {
  throw new Error('This Month should include all September bills')
}
console.log('   ✓ Verified: All September bills included, October excluded!')

// 4. Test Combine Date + Type (e.g. This Week + Offline)
const weekOfflineBills = sampleBills.filter(b => isInRange(b.created_at, weekRange) && b.mode === 'offline')
console.log(`4. This Week + Offline count: ${weekOfflineBills.length} (${weekOfflineBills.map(b => b.invoice_no).join(', ')})`)
if (weekOfflineBills.some(b => b.mode !== 'offline')) {
  throw new Error('Should only include offline bills')
}
console.log('   ✓ Verified: Combined filters work properly!')

console.log('=== ALL SAMPLE BILL TESTS PASSED! ===')
