import { BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'

export interface CouponForMessage {
  code: string
  percentage: number
  min_order_value?: number | null
  expiry_date?: string | null
  image_url?: string | null
}

const formatExpiry = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The WhatsApp text for a coupon. WhatsApp links can only carry text, so the coupon picture goes
 * as a link on its own line: WhatsApp shows it as an image preview in the chat.
 */
export const buildCouponMessage = (coupon: CouponForMessage, customerName?: string): string => {
  const name = (customerName || '').trim().split(/\s+/)[0]
  const minOrder = Number(coupon.min_order_value || 0)
  const expiry = coupon.expiry_date ? formatExpiry(coupon.expiry_date) : ''

  const lines = [
    `🎟️ *${BRAND_EN}*`,
    '',
    name ? `Hi ${name}! Here's a coupon just for you.` : "Here's a coupon just for you.",
    '',
    `Use code *${coupon.code}* to get *${coupon.percentage}% OFF*${minOrder > 0 ? ` on orders above ₹${minOrder}` : ''}.`,
  ]
  if (expiry) lines.push(`⏳ Valid till ${expiry}`)
  if (coupon.image_url) lines.push('', coupon.image_url)
  lines.push(
    '',
    'Show this message or tell us the code at billing.',
    `📞 ${BRAND_PRIMARY_PHONE_DISPLAY}`,
    `📸 @${BRAND_INSTAGRAM}`,
  )
  return lines.join('\n')
}

/** Only some browsers can share image files through the share sheet. */
export const canShareCouponImage = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
