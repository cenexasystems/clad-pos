import { normalizePhoneForWhatsApp } from './phone'
import { DEFAULT_ACCENT, deriveAccent } from './accent'

// The shop's name, contacts and colours. The values below are the CLAD defaults; the shop owner can
// change them in Settings, which calls applyBrandSettings() so every screen, invoice, PDF and
// WhatsApp message picks up the new values. They are `let` exports on purpose: importing modules
// always see the current value.

export interface ShopSettings {
  name: string
  name_ta: string
  owner_name: string
  phone: string
  whatsapp: string
  owner_phone: string
  email: string
  address: string
  city: string
  business_hours: string
  instagram: string
  gstin: string
  accent_color: string
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  name: 'CLAD Clothing',
  name_ta: '',
  owner_name: 'Rubi krishna',
  phone: '+91 70103 12145',
  whatsapp: '',
  owner_phone: '+91 95857 47494',
  email: 'cladclothing26@gmail.com',
  address: 'Manapparai, Trichy, Tamil nadu - 621 306',
  city: '',
  business_hours: '',
  instagram: '_clad_clothing',
  gstin: '',
  accent_color: DEFAULT_ACCENT,
}

export let BRAND_EN = 'CLAD Clothing'
export let BRAND_TA = 'CLAD Clothing'
export let BRAND_SHORT = 'CLAD'
export const BRAND_SUBTITLE = 'Retail Billing & Inventory'
export const BRAND_LOGO = '/clad-logo.png'
export const BRAND_ICON = '/clad-icon.png'
export const BRAND_FAVICON = '/clad-favicon.png'
export const BRAND_PRODUCTION_DOMAIN = 'https://cen-gen-pos.vercel.app'

// Owner / Personal contact
export let BRAND_OWNER_NAME = 'Rubi krishna'
export let BRAND_OWNER_PHONE_DISPLAY = '+91 95857 47494'
export let BRAND_OWNER_PHONE_E164 = '919585747494'

// Official Shop contact (used for receipts, billing, and customer WhatsApp)
export let BRAND_PRIMARY_PHONE_DISPLAY = '+91 70103 12145'
export let BRAND_PRIMARY_PHONE_E164 = '917010312145'
export let BRAND_SECONDARY_PHONE_DISPLAY = '+91 95857 47494'
export let BRAND_SECONDARY_PHONE_E164 = '919585747494'
export let BRAND_THIRD_PHONE_DISPLAY = BRAND_SECONDARY_PHONE_DISPLAY
export let BRAND_THIRD_PHONE_E164 = BRAND_SECONDARY_PHONE_E164

export let BRAND_PHONE_DISPLAY = BRAND_PRIMARY_PHONE_DISPLAY
export let BRAND_PHONE_E164 = BRAND_PRIMARY_PHONE_E164

export let BRAND_WHATSAPP = BRAND_PRIMARY_PHONE_DISPLAY
export let WHATSAPP_NUM = BRAND_PRIMARY_PHONE_E164
export let BRAND_WHATSAPP_LINK = `https://wa.me/${BRAND_PRIMARY_PHONE_E164}`

export let BRAND_EMAIL = 'cladclothing26@gmail.com'
export let BRAND_ADDRESS = 'Manapparai, Trichy, Tamil nadu - 621 306'
export let BRAND_CITY = ''
export let BRAND_BUSINESS_HOURS = ''
export let BRAND_GSTIN = ''
export let BRAND_INSTAGRAM = '_clad_clothing'
export let BRAND_INSTAGRAM_URL = 'https://www.instagram.com/_clad_clothing/'
export const BRAND_LOCATION_LINK = '#'

// Theme colour and the shades worked out from it (for PDFs and other places CSS variables cannot reach)
export let BRAND_ACCENT = '#D4AF37'
export let BRAND_ACCENT_DARK = '#B48811'
export let BRAND_ACCENT_LIGHT = '#E8D399'
export let BRAND_ACCENT_SOFT = '#FBFAF6'

/** "9876543210" or "+91 98765 43210" -> "+91 98765 43210". Anything else is shown as typed. */
export const formatPhoneDisplay = (raw: string): string => {
  const digits = (raw || '').replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : ''
  return local ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : (raw || '').trim()
}

/** "@shop.name", "instagram.com/shop.name/" or "shop.name" -> "shop.name" */
export const cleanInstagram = (raw: string): string =>
  (raw || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')

const pick = (value: string | undefined, fallback: string) => (value && value.trim() ? value.trim() : fallback)

/** Makes the whole app use these shop details. Blank required fields keep the default. */
export function applyBrandSettings(input: Partial<ShopSettings>): void {
  const d = DEFAULT_SHOP_SETTINGS
  const name = pick(input.name, d.name)

  BRAND_EN = name
  BRAND_TA = pick(input.name_ta, name)
  BRAND_SHORT = name.split(/\s+/)[0].toUpperCase()

  BRAND_OWNER_NAME = pick(input.owner_name, d.owner_name)
  const ownerPhone = pick(input.owner_phone, d.owner_phone)
  BRAND_OWNER_PHONE_DISPLAY = formatPhoneDisplay(ownerPhone)
  BRAND_OWNER_PHONE_E164 = normalizePhoneForWhatsApp(ownerPhone)
  BRAND_SECONDARY_PHONE_DISPLAY = BRAND_OWNER_PHONE_DISPLAY
  BRAND_SECONDARY_PHONE_E164 = BRAND_OWNER_PHONE_E164
  BRAND_THIRD_PHONE_DISPLAY = BRAND_OWNER_PHONE_DISPLAY
  BRAND_THIRD_PHONE_E164 = BRAND_OWNER_PHONE_E164

  const phone = pick(input.phone, d.phone)
  BRAND_PRIMARY_PHONE_DISPLAY = formatPhoneDisplay(phone)
  BRAND_PRIMARY_PHONE_E164 = normalizePhoneForWhatsApp(phone)
  BRAND_PHONE_DISPLAY = BRAND_PRIMARY_PHONE_DISPLAY
  BRAND_PHONE_E164 = BRAND_PRIMARY_PHONE_E164

  const whatsapp = pick(input.whatsapp, phone)
  BRAND_WHATSAPP = formatPhoneDisplay(whatsapp)
  WHATSAPP_NUM = normalizePhoneForWhatsApp(whatsapp)
  BRAND_WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUM}`

  BRAND_EMAIL = pick(input.email, d.email)
  BRAND_ADDRESS = pick(input.address, d.address)
  BRAND_CITY = (input.city ?? '').trim()
  BRAND_BUSINESS_HOURS = (input.business_hours ?? '').trim()
  BRAND_GSTIN = (input.gstin ?? '').trim().toUpperCase()

  BRAND_INSTAGRAM = cleanInstagram(input.instagram ?? '') || d.instagram
  BRAND_INSTAGRAM_URL = `https://www.instagram.com/${BRAND_INSTAGRAM}/`

  const shades = deriveAccent(input.accent_color || DEFAULT_ACCENT)
  BRAND_ACCENT = shades.accent
  BRAND_ACCENT_DARK = shades.dark
  BRAND_ACCENT_LIGHT = shades.light
  BRAND_ACCENT_SOFT = shades.soft
}
