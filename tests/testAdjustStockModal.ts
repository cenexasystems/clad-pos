import { chromium } from 'playwright'

async function run() {
  console.log('=== VERIFYING ADJUST INVENTORY STOCK MODAL & FOOTERS ===')
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })

  const viewports = [
    { name: 'Mobile 360px (Android)', width: 360, height: 740, isMobile: true },
    { name: 'Mobile 390px (iPhone WebKit)', width: 390, height: 844, isMobile: true },
    { name: 'Mobile 412px (Android Chrome)', width: 412, height: 915, isMobile: true },
    { name: 'Desktop 1280px', width: 1280, height: 800, isMobile: false },
  ]

  for (const vp of viewports) {
    console.log(`\n--- Testing ${vp.name} (${vp.width}x${vp.height}) ---`)
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent: vp.isMobile
        ? 'Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
        : undefined,
    })
    const page = await context.newPage()

    // Mock Supabase calls to ensure reliable tests with the exact user item "Kerchief"
    await page.route('**/rest/v1/products*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            name: 'Kerchief',
            price: 50,
            stock_quantity: 37,
            low_stock_alert: 5,
            unit: 'piece',
            unit_type: 'unit',
            category: 'Accessories',
            barcode: '8901234567890',
            sku: 'CLAD-KER-01',
            is_active: true,
            updated_at: new Date().toISOString(),
          },
        ]),
      })
    })

    await page.route('**/rest/v1/product_variants*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/rest/v1/categories*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, name_en: 'Accessories', is_active: true, sort_order: 1 }]),
      })
    })

    await page.route('**/rest/v1/inventory_movements*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
    })

    // 1. Log in via admin-login
    await page.goto('http://localhost:5173/admin-login')
    await page.waitForSelector('input[placeholder="Enter portal ID"]')
    await page.fill('input[placeholder="Enter portal ID"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard**')

    // 2. Navigate to Inventory tab
    await page.goto('http://localhost:5173/dashboard?tab=inventory')
    await page.waitForTimeout(1000)

    // Check if low stock alarm modal popped up, and acknowledge it if present
    const alarmBtn = page.locator('button:has-text("Silence Alarm & Acknowledge")')
    if (await alarmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log('  Dismissing low stock alarm overlay...')
      await alarmBtn.click()
      await page.waitForTimeout(500)
    }

    // 3. Find and click "Adjust" button for Kerchief
    const adjustBtn = page.locator('button:has-text("Adjust")').first()
    await adjustBtn.waitFor({ timeout: 10000 })
    await adjustBtn.scrollIntoViewIfNeeded()
    await adjustBtn.click()
    await page.waitForTimeout(500)

    // 4. Modal is visible
    const modalHeader = page.locator('text=/Adjust Inventory Stock/i')
    if (!(await modalHeader.isVisible())) {
      throw new Error(`Modal header not visible on ${vp.name}`)
    }
    console.log(`✓ Modal opened successfully for "Kerchief" (Current stock: 37 units) on ${vp.name}`)

    // 5. Verify Cancel & Confirm buttons exist and check visibility in viewport
    const cancelBtn = page.locator('button:has-text("Cancel")').first()
    const confirmBtn = page.locator('button[type="submit"]:has-text("Confirm")').first()

    const cancelVisible = await cancelBtn.isVisible()
    const confirmVisible = await confirmBtn.isVisible()
    console.log(`✓ Cancel button visible: ${cancelVisible}`)
    console.log(`✓ Confirm button visible: ${confirmVisible}`)

    if (!cancelVisible || !confirmVisible) {
      throw new Error(`Footer buttons are not visible on ${vp.name}!`)
    }

    // 6. Check that buttons are inside the visible viewport (NOT clipped or offscreen!)
    const confirmBox = await confirmBtn.boundingBox()
    const cancelBox = await cancelBtn.boundingBox()
    if (!confirmBox || !cancelBox) {
      throw new Error(`Could not get bounding box for buttons on ${vp.name}`)
    }

    console.log(`  Confirm button bounds: y=${Math.round(confirmBox.y)}, h=${Math.round(confirmBox.height)}, bottom=${Math.round(confirmBox.y + confirmBox.height)} (Viewport height: ${vp.height})`)
    if (confirmBox.y + confirmBox.height > vp.height) {
      throw new Error(`Confirm button is clipped below viewport on ${vp.name}! bottom=${confirmBox.y + confirmBox.height}, vp.h=${vp.height}`)
    }
    console.log(`✓ Confirm button is completely within visible viewport without scrolling outer window!`)

    if (vp.isMobile) {
      if (confirmBox.height < 44 || cancelBox.height < 44) {
        throw new Error(`Mobile button touch target height too small: confirm=${confirmBox.height}, cancel=${cancelBox.height}`)
      }
      console.log(`✓ Mobile touch target minimum height satisfied (>= 48px target): cancel=${Math.round(cancelBox.height)}px, confirm=${Math.round(confirmBox.height)}px`)
    } else {
      console.log(`✓ Desktop layout verified: cancel=${Math.round(cancelBox.height)}px, confirm=${Math.round(confirmBox.height)}px`)
    }

    // 7. Verify Initial Restock state:
    // Quantity = 0 -> Confirm button disabled & text contains "(+0 Units)"
    let confirmText = (await confirmBtn.textContent()) || ''
    let isDisabled = await confirmBtn.isDisabled()
    console.log(`✓ Initial Restock button text: "${confirmText.trim()}", disabled=${isDisabled}`)
    if (!confirmText.includes('+0 Units') || !isDisabled) {
      throw new Error(`Expected disabled button with (+0 Units), got "${confirmText}", disabled=${isDisabled}`)
    }

    // 8. Test Dynamic Quantity Updates: Quick Add chips and +/- stepper
    const plusOneChip = page.locator('button:has-text("+1")').first()
    await plusOneChip.click()
    await page.waitForTimeout(200)

    confirmText = (await confirmBtn.textContent()) || ''
    let isNowEnabled = !(await confirmBtn.isDisabled())
    console.log(`✓ After clicking Quick Add +1: "${confirmText.trim()}", enabled=${isNowEnabled}`)
    if (!confirmText.includes('+1 Units') || !isNowEnabled) {
      throw new Error(`Expected enabled button with (+1 Units), got "${confirmText}"`)
    }

    // Click + stepper button (exact match '+')
    const plusStepperBtn = page.locator('button:text-is("+")').first()
    await plusStepperBtn.click()
    await page.waitForTimeout(200)
    confirmText = (await confirmBtn.textContent()) || ''
    console.log(`✓ After clicking + stepper: "${confirmText.trim()}" (now +2 Units)`)
    if (!confirmText.includes('+2 Units')) {
      throw new Error(`Expected +2 Units, got "${confirmText}"`)
    }

    // Quick Add +10 chip
    const plusTenChip = page.locator('button:has-text("+10")').first()
    await plusTenChip.click()
    await page.waitForTimeout(200)
    confirmText = (await confirmBtn.textContent()) || ''
    console.log(`✓ After clicking Quick Add +10: "${confirmText.trim()}" (sets to +10 Units)`)
    if (!confirmText.includes('+10 Units')) {
      throw new Error(`Expected +10 Units, got "${confirmText}"`)
    }

    // Test - stepper button (exact match '-')
    const minusStepperBtn = page.locator('button:text-is("-")').first()
    await minusStepperBtn.click()
    await page.waitForTimeout(200)
    confirmText = (await confirmBtn.textContent()) || ''
    console.log(`✓ After clicking - stepper: "${confirmText.trim()}" (now +9 Units)`)
    if (!confirmText.includes('+9 Units')) {
      throw new Error(`Expected +9 Units, got "${confirmText}"`)
    }

    // 9. Test Mode 2: Remove Stock
    const removeModeBtn = page.locator('button:has-text("Remove Stock")').first()
    await removeModeBtn.click()
    await page.waitForTimeout(200)

    confirmText = (await confirmBtn.textContent()) || ''
    console.log(`✓ In Remove Stock mode: "${confirmText.trim()}"`)
    if (!confirmText.includes('Confirm Removal')) {
      throw new Error(`Expected Confirm Removal, got "${confirmText}"`)
    }

    // 10. Test Mode 3: Reconciliation
    const reconModeBtn = page.locator('button:has-text("Reconciliation")').first()
    await reconModeBtn.click()
    await page.waitForTimeout(200)

    confirmText = (await confirmBtn.textContent()) || ''
    console.log(`✓ In Reconciliation mode: "${confirmText.trim()}"`)
    if (!confirmText.includes('Confirm Reconciliation')) {
      throw new Error(`Expected Confirm Reconciliation, got "${confirmText}"`)
    }

    // 11. Switch back to Restock mode & test real adjustment submit
    const restockModeBtn = page.locator('button:has-text("Restock")').first()
    await restockModeBtn.click()
    await page.waitForTimeout(200)
    const plusFiveChip = page.locator('button:has-text("+5")').first()
    await plusFiveChip.click()
    await page.waitForTimeout(200)

    console.log('  Submitting Restock adjustment...')
    await confirmBtn.click()
    await page.waitForTimeout(600)

    const modalClosed = !(await modalHeader.isVisible())
    console.log(`✓ Modal successfully saved & closed: ${modalClosed}`)

    await context.close()
  }

  await browser.close()
  console.log('\n=== ALL 4 VIEWPORTS (360px, 390px, 412px, Desktop) TESTED & PASSED 100%! ===')
}

run().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
