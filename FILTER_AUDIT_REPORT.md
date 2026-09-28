# Comprehensive Filter Audit & Fix Report

## Overview
This audit was performed across the **entire billing application** (mobile-first web app) to address filter reactivity and date range inconsistencies.

### Core Problems Identified & Resolved
1. **Lack of Auto-Apply (Order Management / Billing History):** Filters previously required tapping the "Search" button to reflect in the orders list and result count. Filter chips updated immediately while the table and count remained stale.
2. **Rolling vs. Calendar Date Ranges:** Date presets ("This Week", "This Month") previously calculated rolling windows (e.g., `today.getDate() - 6` or `Date.now() - 6 * 86400000`). On Monday 28/09/2026, "This Week" returned bills from 24/09 to 27/09.
3. **Timezone & Off-by-One UTC Parsing:** Naive `new Date('YYYY-MM-DD')` and `.toISOString().slice(0, 10)` parsed dates as UTC midnight (05:30 AM IST), cutting off morning transactions and causing month-end inconsistencies.
4. **State Desynchronization:** Filter chips, item counts, table rows, and "Export CSV" were reading from disconnected states.

---

## Shared Utilities Created

1. **`src/lib/dateRange.ts`**:
   - `getDateRange(preset, now, custom)`: Computes strictly calendar-based date ranges in local timezone (IST):
     - **`today`**: Current calendar day `00:00:00.000` to `23:59:59.999`.
     - **`week`**: Monday `00:00:00.000` to Sunday `23:59:59.999` of the current calendar week.
     - **`month`**: 1st day `00:00:00.000` to last calendar day `23:59:59.999` (properly handling 28, 29, 30, and 31 days).
     - **`year`**: Jan 1 `00:00:00.000` to Dec 31 `23:59:59.999`.
     - **`custom`**: Start of from-date to end of to-date inclusive; validates `from <= to` and auto-swaps if entered inverted.
   - `isInRange(date, range)`: Precise timestamp comparison (`getTime() >= range.start.getTime() && getTime() <= range.end.getTime()`).
   - `parseLocalDate(dateStr, isEndOfDay)`: Parses `'YYYY-MM-DD'` without UTC timezone shift.
   - `formatLocalDate(date)`: Formats local dates into `'YYYY-MM-DD'` strings.
2. **`src/lib/debounce.ts`**:
   - `useDebouncedValue<T>(value, delay = 300)`: Debounces text searches with 300ms delay and provides an immediate `flush()` callback for Enter key / manual button submissions.
3. **`tests/dateRange.test.ts`**:
   - Unit tests covering Monday, Wednesday, Sunday; 28/29/30/31-day months (including leap years); year-crossing weeks; Sunday 23:59:59.999 boundary; and custom date ranges. (100% passing).

---

## Audit Table

| Page / Screen | File & Component | Filters Present | Problem Found | Fix Applied | Tested |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Order Management / Billing History** | `src/pages/Dashboard.tsx` (`Dashboard` history tab) | Date Preset (Today/This Week/This Month/Custom), Bill Type (All/Offline/Online/Manual), Quick Search (invoice, customer, phone), Detailed filters (invoiceNo, customerName, phone, dateFrom, dateTo) | 1. Changing filters only updated chips; list and count stayed stale until "Search" tapped.<br>2. "This Week" used rolling 7 days (`getDate() - 6`).<br>3. "This Month" used today as end date with UTC string slicing. | 1. Replaced decoupled `searchResults` state with reactive `filteredSearchResults = useMemo(...)` derived directly from `orders`.<br>2. Auto-applied all filter changes immediately.<br>3. Debounced text search with 300ms delay while Enter and Search button flush instantly.<br>4. Replaced date logic with `getDateRange` and `isInRange`.<br>5. Chips, result count, mobile list, desktop table, and Export CSV now share the exact same filtered dataset. | **PASS** |
| **Dashboard & Sales Analytics** | `src/pages/Dashboard.tsx` (`Dashboard` overview & pos_analytics) | Date presets (`all`, `today`, `week`, `month`, `year`, `custom`), custom date inputs, today bills search, product analytics search | 1. Rolling 7-day week and UTC string slicing.<br>2. Stale searchResults referenced in summary cards.<br>3. Non-debounced search inputs. | 1. Switched `analytics` calculation to `getDateRange` + `isInRange`.<br>2. Debounced search inputs (300ms).<br>3. Linked overview and billing metric cards directly to store orders. | **PASS** |
| **Billing Analytics Page** | `src/pages/BillingAnalytics.tsx` | Global period presets (Today/This Week/This Month/This Year/Custom), Bill Type (All/Offline/Online/Manual), Payment mode, Debounced search, Custom date inputs | 1. Rolling 7-day window in `applyAnalyticsPreset`.<br>2. String comparisons on dates.<br>3. Non-debounced search input. | 1. Converted to `getDateRange` + `isInRange`.<br>2. Debounced search input (300ms).<br>3. Derived `filteredBills` reactively with instant auto-apply. | **PASS** |
| **Expenses Tracker** | `src/components/expenses/ExpensesView.tsx` & `src/services/expenseService.ts` | Category dropdown, Date preset dropdown (All/Today/This Week/This Month/Custom), Custom date inputs, Search query | 1. Rolling 7-day window.<br>2. `calculateMetricsFromList` had rolling date calculations.<br>3. Non-debounced search input. | 1. Replaced with `getDateRange` and `isInRange` in both UI view and calculation service.<br>2. Added `useDebouncedValue(search, 300)`.<br>3. Auto-applies custom dates as soon as both are selected with `from <= to` validation. | **PASS** |
| **Advance / Deposit Orders** | `src/pages/AdvanceOrders.tsx` | Status filter tabs (All/Pending/Completed/Cancelled), Date filter tabs (All/Today/This Week/This Month), Search query | 1. "This Week" checked rolling 6 days (`now - 6 * 86400000`).<br>2. Search query was not debounced. | 1. Replaced with `getDateRange(dateFilter, new Date())` and `isInRange(order.created_at, activeDateRange)`.<br>2. Added 300ms debounced search.<br>*(Note: Deposit orders remain excluded from revenue until fully paid/completed, preserving business logic).* | **PASS** |
| **Inventory Stock Management** | `src/components/inventory/InventoryTable.tsx` | Stock status filter tabs (All/In Stock/Low Stock/Out of Stock), SKU/variant/barcode/category search input | Search input lacked debouncing, causing UI lag during rapid keystrokes. | Added `useDebouncedValue(search, 300)`. Stock filter tabs already auto-apply instantly. | **PASS** |
| **Inventory Analytics** | `src/components/inventory/InventoryAnalyticsView.tsx` | Date preset buttons (All/Today/This Week/This Month), Product search | 1. "This Week" used rolling 7 days (`getDate() - 7`).<br>2. Search was not debounced. | 1. Replaced with `getDateRange(range, new Date())` and `isInRange`.<br>2. Added 300ms debounced search. | **PASS** |
| **Product Catalog Modal** | `src/components/CatalogModal.tsx` | Category tabs, Product name/category search | Search input lacked debouncing. | Added `useDebouncedValue(search, 300)`. Category selection already auto-applies reactively. | **PASS** |
| **User Management** | `src/pages/Dashboard.tsx` (`tab === 'users'`) | User search by name / email | Search input lacked debouncing. | Added `useDebouncedValue(userSearch, 300)`. | **PASS** |

---

## Intentionally Left Unchanged (With Reasons)
- **POS Deposit Order Delivery Date (`src/pages/Pos.tsx`)**: Form input for setting future expected delivery date on a deposit order, not a list filter.
- **Advance Order Delivery Date (`src/pages/AdvanceOrders.tsx`)**: Form input for creating/editing delivery date on an advance order, not a list filter.
- **Record Expense Date (`src/components/expenses/RecordExpenseModal.tsx`)**: Form input for the date an expense occurred, not a filter.
- **Coupon Expiry Date (`src/pages/Dashboard.tsx`)**: Form input for setting a coupon's expiration date, not a filter.
- **Deposit Orders Revenue Separation**: As requested, deposit orders do not count toward revenue metrics until fully completed/paid.

---

## Files Changed
- [`src/lib/dateRange.ts`](file:///c:/clad-pos/src/lib/dateRange.ts) *(New shared utility)*
- [`src/lib/debounce.ts`](file:///c:/clad-pos/src/lib/debounce.ts) *(New debouncing utility)*
- [`tests/dateRange.test.ts`](file:///c:/clad-pos/tests/dateRange.test.ts) *(Unit test suite for date ranges)*
- [`src/pages/Dashboard.tsx`](file:///c:/clad-pos/src/pages/Dashboard.tsx)
- [`src/pages/BillingAnalytics.tsx`](file:///c:/clad-pos/src/pages/BillingAnalytics.tsx)
- [`src/pages/AdvanceOrders.tsx`](file:///c:/clad-pos/src/pages/AdvanceOrders.tsx)
- [`src/components/expenses/ExpensesView.tsx`](file:///c:/clad-pos/src/components/expenses/ExpensesView.tsx)
- [`src/services/expenseService.ts`](file:///c:/clad-pos/src/services/expenseService.ts)
- [`src/components/inventory/InventoryTable.tsx`](file:///c:/clad-pos/src/components/inventory/InventoryTable.tsx)
- [`src/components/inventory/InventoryAnalyticsView.tsx`](file:///c:/clad-pos/src/components/inventory/InventoryAnalyticsView.tsx)
- [`src/components/CatalogModal.tsx`](file:///c:/clad-pos/src/components/CatalogModal.tsx)
- [`package.json`](file:///c:/clad-pos/package.json) *(Added `test` script)*
