import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { LOGO_BASE64 } from './logoBase64'
import { formatCurrency, formatInvoiceNo } from './retail'

export interface ThermalReceiptData {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  items: Array<{
    name: string
    qty: number
    unit?: string
    price: number
    line_total?: number
  }>
  subtotal: number
  shipping: number
  couponDiscount?: number
  manualDiscount?: number
  totalGst?: number
  total: number
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
}

export function printThermalReceipt(data: ThermalReceiptData) {
  try {
    // Create an isolated print iframe protected from third-party extension observers.
    // iOS Safari refuses to render/print an iframe that has zero width/height or
    // visibility:hidden, so it is pushed off-screen with real dimensions instead.
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:302px;height:600px;border:0;'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('tabindex', '-1')
    iframe.setAttribute('data-gramm', 'false')
    iframe.setAttribute('data-gramm_editor', 'false')
    iframe.setAttribute('data-enable-grammarly', 'false')
    iframe.setAttribute('spellcheck', 'false')
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      return
    }

    const dateStr = (() => {
      try { return new Date(data.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
      catch { return new Date().toLocaleString('en-IN') }
    })()

    const formatCustomerPhone = (phone?: string): string => {
      if (!phone) return ''
      const trimmed = phone.trim()
      const digits = trimmed.replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
      }
      if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
      }
      return trimmed
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false">
        <head>
          <meta charset="UTF-8">
          <meta name="grammarly" content="off">
          <meta name="robots" content="noindex,nofollow">
          <title>Receipt - ${data.invoiceNo}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          * {
            color: #000 !important;
            border-color: #000 !important;
            font-weight: 700 !important;
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body, div, span, applet, object, iframe,
          h1, h2, h3, h4, h5, h6, p, blockquote, pre,
          a, abbr, acronym, address, big, cite, code,
          del, dfn, em, img, ins, kbd, q, s, samp,
          small, strike, strong, sub, sup, tt, var,
          b, u, i, center,
          dl, dt, dd, ol, ul, li,
          fieldset, form, label, legend,
          table, caption, tbody, tfoot, thead, tr, th, td,
          article, aside, canvas, details, embed, 
          figure, figcaption, footer, header, hgroup, 
          menu, nav, output, ruby, section, summary,
          time, mark, audio, video {
            font-family: 'Courier New', Courier, monospace, sans-serif !important;
            font-weight: 700 !important;
            color: #000 !important;
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 12px;
            font-weight: 700 !important;
            color: #000;
            margin: 0;
            padding: 4mm;
            width: 80mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: 700 !important; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .border-bottom { border-bottom: 1.5px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
          .border-top { border-top: 1.5px dashed #000; padding-top: 4px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-weight: 700 !important; }
          th, td { padding: 2px 0; vertical-align: top; color: #000; font-weight: 700 !important; }
          div, span, th, td, p { font-weight: 700 !important; }
          .item-name { font-size: 11px; padding-right: 4px; color: #000; font-weight: 700 !important; }
        </style>
      </head>
      <body style="font-weight: bold;">
        <div class="text-center mb-2" style="font-weight: bold;">
          <img src="${LOGO_BASE64}" style="width: 48px; height: 48px; object-fit: contain; margin: 0 auto 6px auto; display: block;" alt="CLAD Logo" />
          <div class="font-bold" style="font-size: 16px; letter-spacing: 2px; color: #000; font-weight: bold;">${data.storeName || BRAND_EN}</div>
          <div style="font-size: 10px; margin-top: 2px; color: #000; font-weight: bold;">${data.storeAddress || BRAND_ADDRESS}</div>
          <div class="mt-1" style="font-size: 10px; color: #000; font-weight: bold;">Ph: ${data.storePhone || BRAND_PRIMARY_PHONE_DISPLAY}</div>
          <div style="font-size: 9px; color: #000; font-weight: bold;">${data.storeEmail || BRAND_EMAIL} | Insta: @${BRAND_INSTAGRAM}</div>
        </div>

        <div class="border-bottom border-top" style="font-size: 11px; color: #000; font-weight: bold;">
          <div style="font-weight: bold;">Inv: #${formatInvoiceNo(data.invoiceNo)}</div>
          <div style="font-weight: bold;">Date: ${dateStr}</div>
          ${data.customerName ? `<div style="font-weight: bold;">Name: ${data.customerName}</div>` : ''}
          ${data.phone ? `<div style="font-weight: bold;">Tel: ${formatCustomerPhone(data.phone)}</div>` : ''}
        </div>

        <table class="border-bottom" style="width: 100%; table-layout: fixed; border-collapse: collapse; font-weight: bold;">
          <thead>
            <tr style="font-size: 10px; border-bottom: 1.5px dashed #000; color: #000; font-weight: bold;">
              <th style="width: 50%; text-align: left; padding: 4px 0; color: #000; font-weight: bold;">Item Name</th>
              <th style="width: 18%; text-align: center; padding: 4px 0; color: #000; font-weight: bold;">Qty</th>
              <th style="width: 32%; text-align: right; padding: 4px 0; color: #000; font-weight: bold;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => {
              const lineTotal = item.line_total ?? (item.qty * item.price)
              const unit = item.unit && item.unit !== 'unit' && item.unit !== 'piece' ? item.unit : ''
              const rateDisplay = `${formatCurrency(item.price)}${unit ? `/${unit}` : ''}`
              return `
                <tr style="font-weight: bold;">
                  <td style="text-align: left; padding: 3px 2px 3px 0; vertical-align: top; word-break: break-word; color: #000; font-weight: bold;">
                    <div style="font-size: 11px; font-weight: bold; line-height: 1.25; color: #000;">${item.name}</div>
                    <div style="font-size: 9px; color: #000; margin-top: 1px; font-weight: bold;">@ ${rateDisplay}</div>
                  </td>
                  <td style="text-align: center; vertical-align: top; padding: 3px 0; font-size: 11px; font-weight: bold; color: #000;">
                    ${item.qty}
                  </td>
                  <td style="text-align: right; vertical-align: top; padding: 3px 0; font-size: 11px; font-weight: bold; color: #000;">
                    ${formatCurrency(lineTotal)}
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>

        <div class="border-bottom" style="font-size: 12px; font-weight: bold;">
          <table style="width: 100%; font-weight: bold;">
            ${data.subtotal !== data.total ? `
              <tr style="font-weight: bold;">
                <td class="text-left" style="font-weight: bold;">Subtotal</td>
                <td class="text-right" style="font-weight: bold;">${formatCurrency(data.subtotal)}</td>
              </tr>
            ` : ''}
            ${(data.couponDiscount || 0) > 0 ? `
              <tr style="font-weight: bold;">
                <td class="text-left" style="font-weight: bold;">Coupon</td>
                <td class="text-right" style="font-weight: bold;">-${formatCurrency(data.couponDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.manualDiscount || 0) > 0 ? `
              <tr style="font-weight: bold;">
                <td class="text-left" style="font-weight: bold;">Manual Disc.</td>
                <td class="text-right" style="font-weight: bold;">-${formatCurrency(data.manualDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.totalGst || 0) > 0 ? `
              <tr style="font-weight: bold;">
                <td class="text-left" style="font-weight: bold;">GST</td>
                <td class="text-right" style="font-weight: bold;">+${formatCurrency(data.totalGst || 0)}</td>
              </tr>
            ` : ''}
            ${data.shipping > 0 ? `
              <tr style="font-weight: bold;">
                <td class="text-left" style="font-weight: bold;">Delivery</td>
                <td class="text-right" style="font-weight: bold;">${formatCurrency(data.shipping)}</td>
              </tr>
            ` : ''}
            <tr class="font-bold" style="font-size: 14px; font-weight: bold;">
              <td class="text-left" style="font-weight: bold;">Total</td>
              <td class="text-right" style="font-weight: bold;">${formatCurrency(data.total)}</td>
            </tr>
          </table>
        </div>

        <div class="text-center mt-2" style="font-size: 11px; font-weight: bold; color: #000;">
          <div class="font-bold" style="font-weight: bold;">Thank you for shopping at CLAD Clothing!</div>
          <div class="font-bold" style="font-weight: bold; margin-top: 2px;">Follow us on Instagram: @${BRAND_INSTAGRAM}</div>
        </div>
      </body>
    </html>
  `

    doc.open()
    doc.write(html)
    doc.close()

    const cleanup = () => {
      try {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe)
        }
      } catch {}
    }

    // Wait for resources to load, then print safely
    setTimeout(() => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.onbeforeunload = null
          iframe.contentWindow.onunload = null
          iframe.contentWindow.onafterprint = cleanup
          iframe.contentWindow.focus()
          iframe.contentWindow.print()
        }
      } catch (printErr) {
        console.warn('[thermalPrint] Print execution error:', printErr)
      } finally {
        setTimeout(cleanup, 2000)
      }
    }, 250)
  } catch (err) {
    console.warn('[thermalPrint] Failed to print receipt:', err)
  }
}
