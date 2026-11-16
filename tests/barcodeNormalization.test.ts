import { normalizeBarcode, isValidBarcodeValue } from '../src/lib/barcode'

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

console.log('--- Running Barcode Normalization Tests ---')

{
  assertEqual(normalizeBarcode('%AD9.7;*'), 'AD97', 'scanner prefix/suffix noise is stripped')
  assertEqual(normalizeBarcode('  clad-204_5  '), 'CLAD-204_5', 'whitespace is trimmed and case normalized')
  assertEqual(normalizeBarcode(' item\n\r\t123 '), 'ITEM123', 'control characters are removed')
  assertEqual(isValidBarcodeValue('AD97'), true, 'valid sanitised code remains valid')
  assertEqual(isValidBarcodeValue('AD9.7'), false, 'punctuation-only noise is rejected')
}

console.log('✓ BARCODE NORMALIZATION TESTS PASSED SUCCESSFULLY!')
