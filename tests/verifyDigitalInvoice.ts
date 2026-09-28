import { chromium, webkit, devices } from 'playwright'

interface TestCase {
  urlPath: string
  label: string
}

const testCases: TestCase[] = [
  { urlPath: '/invoice/INV00000069', label: 'Exact WhatsApp link (INV00000069)' },
  { urlPath: '/invoice/%23INV00000069', label: 'URL-encoded hash (%23INV00000069)' },
  { urlPath: '/invoice/#INV00000069', label: 'Trailing hash route (/invoice/#INV00000069)' },
  { urlPath: '/invoice/00000069', label: 'Database exact invoice_no (00000069)' },
  { urlPath: '/invoice/69', label: 'Short invoice integer (69)' },
  { urlPath: '/invoice/INV-00000069', label: 'Hyphenated padded (INV-00000069)' },
  { urlPath: '/invoice/INV-69', label: 'Hyphenated short (INV-69)' },
  { urlPath: '/invoice/INV69', label: 'Prefix short (INV69)' },
  { urlPath: '/invoice/inv00000069', label: 'Lowercase (inv00000069)' },
  { urlPath: '/invoice?id=INV00000069', label: 'Query param id (INV00000069)' },
  { urlPath: '/invoice?id=69', label: 'Query param id (69)' },
  { urlPath: '/invoice#INV00000069', label: 'Hash route (/invoice#INV00000069)' },
  { urlPath: '/invoice#69', label: 'Hash short route (/invoice#69)' },
  { urlPath: '/invoice/DEP-20260928-0019', label: 'Advance Deposit ID (DEP-20260928-0019)' },
  { urlPath: '/invoice/5fe41912-918d-41d7-b89e-60a6f088bcd6', label: 'Order UUID' },
]

async function run() {
  console.log('=== VERIFYING DIGITAL INVOICE RESOLUTION ACROSS ALL PLATFORMS ===\n')

  let totalTests = 0
  let passedTests = 0
  const failures: string[] = []

  // 1. Test iPhone WebKit (Safari engine)
  console.log('--- 1. Testing iPhone WebKit (Safari Engine - iPhone 14 Pro 393x852) ---')
  const webkitBrowser = await webkit.launch({ headless: true })
  const iPhoneContext = await webkitBrowser.newContext({
    ...devices['iPhone 14 Pro'],
  })

  for (const tc of testCases) {
    totalTests++
    const page = await iPhoneContext.newPage()
    const fullUrl = `http://localhost:5173${tc.urlPath}`
    try {
      await page.goto(fullUrl, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      const text = await page.innerText('body')
      const success = text.includes('Kerchief') || text.includes('₹520.00')
      if (success) {
        passedTests++
        console.log(`  [iPhone WebKit] ✅ PASS: ${tc.label} (${tc.urlPath})`)
      } else {
        const errorSnippet = text.includes('Invoice Not Found') ? 'Invoice Not Found' : text.slice(0, 80).replace(/\n/g, ' ')
        failures.push(`[iPhone WebKit] ${tc.label}: ${errorSnippet}`)
        console.log(`  [iPhone WebKit] ❌ FAIL: ${tc.label} -> ${errorSnippet}`)
      }
    } catch (err: any) {
      failures.push(`[iPhone WebKit] ${tc.label}: ${err.message}`)
      console.log(`  [iPhone WebKit] ❌ ERROR: ${tc.label} -> ${err.message}`)
    } finally {
      await page.close()
    }
  }
  await webkitBrowser.close()

  // 2. Test Android Chromium (360x740 & 412x915)
  console.log('\n--- 2. Testing Android Chromium (Mobile Viewports 360px & 412px) ---')
  const chromBrowser = await chromium.launch({ headless: true, channel: 'msedge' })

  for (const vp of [
    { name: 'Android 360px', width: 360, height: 740 },
    { name: 'Android 412px', width: 412, height: 915 },
  ]) {
    const mobileContext = await chromBrowser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
      isMobile: true,
      hasTouch: true,
    })

    // Test a key subset of 5 variations on each mobile viewport
    const sampleCases = [
      testCases[0], // INV00000069
      testCases[1], // %23INV00000069
      testCases[4], // 69
      testCases[10], // ?id=69
      testCases[13], // DEP-20260928-0019
    ]

    for (const tc of sampleCases) {
      totalTests++
      const page = await mobileContext.newPage()
      const fullUrl = `http://localhost:5173${tc.urlPath}`
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
        const text = await page.innerText('body')
        const success = text.includes('Kerchief') || text.includes('₹520.00')
        if (success) {
          passedTests++
          console.log(`  [${vp.name}] ✅ PASS: ${tc.label}`)
        } else {
          failures.push(`[${vp.name}] ${tc.label}`)
          console.log(`  [${vp.name}] ❌ FAIL: ${tc.label}`)
        }
      } catch (err: any) {
        failures.push(`[${vp.name}] ${tc.label}: ${err.message}`)
        console.log(`  [${vp.name}] ❌ ERROR: ${tc.label}`)
      } finally {
        await page.close()
      }
    }
    await mobileContext.close()
  }

  // 3. Test Desktop Viewport (1280x800)
  console.log('\n--- 3. Testing Desktop Viewport (1280x800) ---')
  const desktopContext = await chromBrowser.newContext({
    viewport: { width: 1280, height: 800 },
  })

  for (const tc of [testCases[0], testCases[1], testCases[4], testCases[13]]) {
    totalTests++
    const page = await desktopContext.newPage()
    const fullUrl = `http://localhost:5173${tc.urlPath}`
    try {
      await page.goto(fullUrl, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      const text = await page.innerText('body')
      const success = text.includes('Kerchief') || text.includes('₹520.00')
      if (success) {
        passedTests++
        console.log(`  [Desktop] ✅ PASS: ${tc.label}`)
      } else {
        failures.push(`[Desktop] ${tc.label}`)
        console.log(`  [Desktop] ❌ FAIL: ${tc.label}`)
      }
    } catch (err: any) {
      failures.push(`[Desktop] ${tc.label}: ${err.message}`)
      console.log(`  [Desktop] ❌ ERROR: ${tc.label}`)
    } finally {
      await page.close()
    }
  }
  await desktopContext.close()
  await chromBrowser.close()

  console.log('\n=== SUMMARY ===')
  console.log(`Total tests run: ${totalTests}`)
  console.log(`Passed: ${passedTests}`)
  console.log(`Failed: ${failures.length}`)

  if (failures.length > 0) {
    console.error('\nFailures:\n' + failures.join('\n'))
    process.exit(1)
  } else {
    console.log('\n🎉 ALL DIGITAL INVOICE VERIFICATION TESTS PASSED 100%!')
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
