import { jsPDF } from 'jspdf'
import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY, BRAND_ACCENT, BRAND_ACCENT_SOFT } from './brand'
import { formatCurrency, formatInvoiceNo } from './retail'
import { formatPhone } from './phone'
import { LOGO_BASE64 } from './logoBase64'
import { isExchange, refundMethodText, type OrderReturn } from './returns'

// jsPDF's built-in font has no rupee glyph, so amounts are written as "Rs. 1,234.00" (same as the sales invoice).
const money = (value: number): string => formatCurrency(Number(value || 0)).replace(/\s+/g, ' ').replace(/^[₹₹]\s*/, 'Rs. ')

// the PDF font has no rupee glyph either
const methodText = (ret: OrderReturn): string => refundMethodText(ret).replace(/₹/g, 'Rs. ')

/** A4 return invoice (credit note) for one return. */
export function createReturnInvoicePdf(ret: OrderReturn): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const exchange = isExchange(ret)
  const pay = Math.max(0, ret.exchange_total - ret.credit_applied)
  const back = Math.max(0, ret.refund_total - ret.credit_applied)
  const left = 16
  const right = 194
  const ink = '#18202a'
  const muted = '#68717c'
  const gold = BRAND_ACCENT
  const red = '#B91C1C'
  let y = 16

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(red)
  doc.text(exchange ? 'EXCHANGE CREDIT NOTE' : 'RETURN INVOICE (CREDIT NOTE)', left, y)
  doc.setTextColor(muted)
  doc.text(`Return: ${ret.return_no}`, right, y, { align: 'right' })
  y += 7
  doc.setDrawColor('#d8dce0')
  doc.line(left, y, right, y)
  y += 10

  try {
    doc.addImage(LOGO_BASE64, 'PNG', left, y, 20, 20)
  } catch {
    doc.setTextColor(gold)
    doc.setFontSize(16)
    doc.text(BRAND_EN, left, y + 10)
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(gold)
  doc.text(BRAND_EN, left + 24, y + 5)
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.setFont('helvetica', 'normal')
  doc.text(BRAND_ADDRESS, left + 24, y + 10, { maxWidth: 85 })
  doc.text(`Phone: ${BRAND_PHONE_DISPLAY}`, left + 24, y + 18)
  doc.text(`Date: ${new Date(ret.created_at).toLocaleDateString('en-IN')}`, right, y + 2, { align: 'right' })
  doc.text(`Original bill: #${formatInvoiceNo(ret.invoice_no)}`, right, y + 7, { align: 'right' })
  y += 28

  doc.setFillColor(BRAND_ACCENT_SOFT)
  doc.roundedRect(left, y, right - left, 20, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(muted)
  doc.text('CUSTOMER', left + 5, y + 7)
  doc.setFontSize(10)
  doc.setTextColor(ink)
  doc.text(String(ret.customer_name || 'Walk-in Customer'), left + 5, y + 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.text(`Mobile Number: ${formatPhone(ret.phone)}`, left + 5, y + 18)
  y += 28

  doc.setFillColor(gold)
  doc.rect(left, y, right - left, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor('#ffffff')
  doc.text('#', left + 4, y + 6)
  doc.text('RETURNED ITEM', left + 14, y + 6)
  doc.text('QTY', 140, y + 6, { align: 'right' })
  doc.text('RATE', 166, y + 6, { align: 'right' })
  doc.text('AMOUNT', right - 4, y + 6, { align: 'right' })
  y += 14

  ret.items.forEach((line, index) => {
    if (y > 250) { doc.addPage(); y = 20 }
    const nameLines = doc.splitTextToSize(line.name || 'Item', 105) as string[]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(ink)
    doc.text(String(index + 1), left + 4, y)
    doc.text(nameLines, left + 14, y)
    doc.text(String(line.quantity), 140, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text(money(line.unit_price), 166, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(money(line.base_total), right - 4, y, { align: 'right' })
    const note = line.is_manual ? 'Manual item' : line.restocked ? 'Added back to stock' : 'Not added to stock'
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(muted)
    doc.text(note, left + 14, y + nameLines.length * 4 + 1)
    y += nameLines.length * 4 + 8
    doc.setDrawColor('#eef0f2')
    doc.line(left, y - 4, right, y - 4)
  })

  y += 4
  if (y > 230) { doc.addPage(); y = 20 }
  doc.setDrawColor(gold)
  doc.line(120, y, right, y)
  y += 7
  const row = (label: string, value: string, color = ink) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(color)
    doc.text(label, 124, y)
    doc.setFont('helvetica', 'bold')
    doc.text(value, right, y, { align: 'right' })
    y += 6
  }
  row('Returned items', money(ret.items_total))
  if (ret.discount_share > 0) row('Less: bill discount share', `-${money(ret.discount_share)}`, gold)
  if (ret.gst_share > 0) row('Add: GST share', `+${money(ret.gst_share)}`)
  y += 1
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(red)
  doc.text(exchange ? 'CREDIT FROM RETURNED ITEMS' : 'REFUND TOTAL', 124, y)
  doc.text(money(ret.refund_total), right, y, { align: 'right' })
  y += 6
  if (ret.delivery_charge_kept > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor('#B45309')
    doc.text(`Delivery charge ${money(ret.delivery_charge_kept)} is not refunded.`, right, y, { align: 'right' })
    y += 6
  }

  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(ink)
  if (exchange) {
    doc.setFont('helvetica', 'bold')
    doc.text(`Exchanged for new bill #${ret.exchange_invoice_no ? formatInvoiceNo(ret.exchange_invoice_no) : ''} worth ${money(ret.exchange_total)}`, left, y); y += 5
    doc.setFont('helvetica', 'normal')
    doc.text(`Credit used against the new bill: ${money(ret.credit_applied)}`, left, y); y += 5
    if (pay > 0) { doc.text(`Customer paid the difference: ${money(pay)} (shown on the new bill)`, left, y); y += 5 }
    if (back > 0) { doc.text(`Paid back to the customer: ${money(back)}`, left, y); y += 5 }
    if (pay <= 0 && back <= 0) { doc.text('Even exchange: no money changed hands.', left, y); y += 5 }
  }
  doc.text(`${exchange ? 'Settled as' : 'Refunded as'}: ${methodText(ret)}`, left, y); y += 5
  if (ret.reason) { doc.text(`Reason: ${ret.reason}`, left, y, { maxWidth: 170 }); y += 5 }
  if (ret.confirmed_by) { doc.text(`Approved by: ${ret.confirmed_by}`, left, y); y += 5 }
  y += 4
  doc.setFontSize(7)
  doc.setTextColor(muted)
  doc.text(`This is a credit note for the original bill #${formatInvoiceNo(ret.invoice_no)}.`, 105, y, { align: 'center' })

  return doc.output('blob')
}

export const returnInvoicePdfFile = (ret: OrderReturn): File =>
  new File([createReturnInvoicePdf(ret)], `Return-${ret.return_no}.pdf`, { type: 'application/pdf' })
