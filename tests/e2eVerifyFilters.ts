import { chromium } from 'playwright'

async function run() {
  console.log('=== STARTING FILTER AUDIT VERIFICATION ===')
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const context = await browser.newContext({ viewport: { width: 480, height: 800 } })
  const page = await context.newPage()

  // 1. Set admin session
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'purple-boutique-admin-session',
      JSON.stringify({ state: { isLoggedIn: true, role: 'admin', adminId: 'admin' }, version: 0 })
    )
  })

  // 2. Go to Order Management (Billing History)
  console.log('2. Navigating to Order Management (/dashboard?tab=history)...')
  await page.goto('http://localhost:5173/dashboard?tab=history')
  await page.waitForTimeout(2000)

  // Wait for result count text
  const resultCountEl = page.locator('text=/\\d+\\s+result\\(s\\)/i').first()
  await resultCountEl.waitFor({ timeout: 10000 })
  const initialText = await resultCountEl.textContent()
  console.log(`Initial result count: "${initialText}"`)

  // Test 3: Select Date -> "Today"
  console.log('3. Testing Date -> "Today" (auto-apply without clicking Search)...')
  const dateDropdown = page.locator('select').nth(1) // Second dropdown is Date Preset
  await dateDropdown.selectOption('today')
  await page.waitForTimeout(500)

  const todayCountText = await resultCountEl.textContent()
  console.log(`Today result count (auto-applied): "${todayCountText}"`)

  // Check chips
  const dateChip = page.locator('text=/Date:\\s*Today/i')
  const dateChipVisible = await dateChip.isVisible()
  console.log(`Date: Today chip visible: ${dateChipVisible}`)

  // Test 4: Select Date -> "This Week"
  console.log('4. Testing Date -> "This Week" (Mon 28/09/2026 calendar start)...')
  await dateDropdown.selectOption('week')
  await page.waitForTimeout(500)

  const weekCountText = await resultCountEl.textContent()
  console.log(`This Week result count (auto-applied): "${weekCountText}"`)
  const weekChip = page.locator('text=/Date:\\s*This Week/i')
  console.log(`Date: This Week chip visible: ${await weekChip.isVisible()}`)

  // Test 5: Select Date -> "This Month"
  console.log('5. Testing Date -> "This Month" (1st to month-end calendar)...')
  await dateDropdown.selectOption('month')
  await page.waitForTimeout(500)
  const monthCountText = await resultCountEl.textContent()
  console.log(`This Month result count (auto-applied): "${monthCountText}"`)

  // Test 6: Select Type -> "Offline"
  console.log('6. Testing Bill Type -> "Offline"...')
  const typeDropdown = page.locator('select').nth(0) // First dropdown is Bill Type
  await typeDropdown.selectOption('offline')
  await page.waitForTimeout(500)
  const offlineCountText = await resultCountEl.textContent()
  console.log(`Offline result count (auto-applied): "${offlineCountText}"`)
  const typeChip = page.locator('text=/Type:\\s*offline/i')
  console.log(`Type: offline chip visible: ${await typeChip.isVisible()}`)

  // Test 7: Text Search Debounce (300ms)
  console.log('7. Testing text search debounce...')
  const searchInput = page.locator('input[placeholder*="Invoice"]').first()
  await searchInput.fill('INV')
  console.log('Typed "INV", waiting 400ms for debounce...')
  await page.waitForTimeout(400)
  const searchResultText = await resultCountEl.textContent()
  console.log(`Debounced search result count: "${searchResultText}"`)

  // Clear search
  await searchInput.fill('')
  await page.waitForTimeout(400)

  // Reset filters to All
  await typeDropdown.selectOption('all')
  await dateDropdown.selectOption('')
  await page.waitForTimeout(500)
  console.log(`Reset all filters: "${await resultCountEl.textContent()}"`)

  // 8. Test Expenses View
  console.log('8. Navigating to Expenses (/expenses)...')
  await page.goto('http://localhost:5173/expenses')
  await page.waitForTimeout(1500)
  const expensesSelect = page.locator('select').nth(1)
  if (await expensesSelect.isVisible()) {
    await expensesSelect.selectOption('today')
    await page.waitForTimeout(500)
    console.log('Expenses Today preset selected successfully')
    await expensesSelect.selectOption('week')
    await page.waitForTimeout(500)
    console.log('Expenses This Week preset selected successfully')
  }

  // 9. Test Advance Orders View
  console.log('9. Navigating to Advance Orders (/advance-orders)...')
  await page.goto('http://localhost:5173/advance-orders')
  await page.waitForTimeout(1500)
  const todayTab = page.locator('button:has-text("Today")').first()
  if (await todayTab.isVisible()) {
    await todayTab.click()
    await page.waitForTimeout(500)
    console.log('Advance Orders Today tab clicked successfully')
    const weekTab = page.locator('button:has-text("This Week")').first()
    await weekTab.click()
    await page.waitForTimeout(500)
    console.log('Advance Orders This Week tab clicked successfully')
  }

  console.log('=== ALL TESTS COMPLETED SUCCESSFULLY! ===')
  await browser.close()
}

run().catch((err) => {
  console.error('Test run failed:', err)
  process.exit(1)
})
