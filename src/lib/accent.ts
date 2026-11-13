// Theme colour (Settings > Appearance). The whole app is styled with the Tailwind colour "accent",
// which reads CSS variables set here, so changing the colour changes every screen at once.

export const DEFAULT_ACCENT = '#D4AF37'

export interface AccentShades {
  accent: string
  dark: string
  light: string
  soft: string
  hover: string
}

type Rgb = [number, number, number]

export const normalizeHex = (input: string): string | null => {
  const raw = (input || '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map((c) => c + c).join('').toUpperCase()}`
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`
  return null
}

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** WCAG relative luminance, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The app puts the accent on black buttons and on white cards, so it must read on both. */
export const accentProblem = (hex: string): string | null => {
  const l = luminance(hex)
  if (l < 0.1) return 'That colour is too dark: it would disappear on the black buttons. Pick a brighter one.'
  if (l > 0.82) return 'That colour is too light: it would disappear on white cards. Pick a stronger one.'
  return null
}

/** Dark text / border / background shades worked out from the chosen colour. The default gold keeps its hand-picked shades. */
export const deriveAccent = (hex: string): AccentShades => {
  const base = normalizeHex(hex) ?? DEFAULT_ACCENT
  if (base === DEFAULT_ACCENT) return { accent: '#D4AF37', dark: '#B48811', light: '#E8D399', soft: '#FBFAF6', hover: '#B89528' }
  const c = toRgb(base)
  return {
    accent: base,
    dark: toHex(mix(c, [0, 0, 0], 0.24)),
    light: toHex(mix(c, [255, 255, 255], 0.6)),
    soft: toHex(mix(c, [255, 255, 255], 0.955)),
    hover: toHex(mix(c, [0, 0, 0], 0.12)),
  }
}

const rgbVar = (hex: string) => toRgb(hex).join(' ')

/** Pushes the colour into the page (no-op outside a browser). */
export const applyAccentToDocument = (hex: string): AccentShades => {
  const shades = deriveAccent(hex)
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style
    root.setProperty('--accent-rgb', rgbVar(shades.accent))
    root.setProperty('--accent-dark-rgb', rgbVar(shades.dark))
    root.setProperty('--accent-light-rgb', rgbVar(shades.light))
    root.setProperty('--accent-soft-rgb', rgbVar(shades.soft))
    root.setProperty('--accent-hover-rgb', rgbVar(shades.hover))
    root.setProperty('--accent', shades.accent)
    root.setProperty('--accent-dark', shades.dark)
    root.setProperty('--accent-light', shades.light)
    root.setProperty('--accent-soft', shades.soft)
  }
  return shades
}

/** Colours offered in Settings, chosen to suit the black-and-gold look. */
export const ACCENT_PALETTE: { title: string; colors: { name: string; hex: string }[] }[] = [
  {
    title: 'Gold and bronze (CLAD theme)',
    colors: [
      { name: 'Classic gold', hex: '#D4AF37' },
      { name: 'Champagne', hex: '#C9A961' },
      { name: 'Bright gold', hex: '#E5B80B' },
      { name: 'Antique gold', hex: '#B8963E' },
      { name: 'Amber', hex: '#D98E04' },
      { name: 'Copper', hex: '#C07A3A' },
      { name: 'Bronze', hex: '#A97142' },
      { name: 'Rose gold', hex: '#C98B7B' },
    ],
  },
  {
    title: 'Rich tones',
    colors: [
      { name: 'Crimson', hex: '#D12E3F' },
      { name: 'Ruby', hex: '#C2185B' },
      { name: 'Plum', hex: '#9C3FAE' },
      { name: 'Violet', hex: '#7C4DDB' },
      { name: 'Sapphire', hex: '#3B6FE0' },
      { name: 'Teal', hex: '#17A2B8' },
      { name: 'Emerald', hex: '#1E9E6A' },
      { name: 'Olive', hex: '#8A9A2B' },
    ],
  },
  {
    title: 'Neutral',
    colors: [
      { name: 'Silver', hex: '#A8A8A8' },
      { name: 'Slate', hex: '#7A8699' },
      { name: 'Stone', hex: '#8C8577' },
    ],
  },
]
