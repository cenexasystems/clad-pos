import JsBarcode from 'jsbarcode'
import { isSupabaseConfigured, supabase } from './supabase'

export const normalizeBarcode = (code: string | null | undefined): string => {
  return (code || '').trim().toUpperCase()
}

export interface LabelSizeConfig {
  id: string
  name: string
  labelsPerRow: number
  widthMm: number
  heightMm: number
  horizontalGapMm: number
  isCustom?: boolean
}

export const DEFAULT_LABEL_SIZES: LabelSizeConfig[] = [
  { id: '3_35x22', name: '35 × 22 mm (Compact Tag)', labelsPerRow: 1, widthMm: 35, heightMm: 22, horizontalGapMm: 0 },
  { id: '2_38x25', name: '38 × 25 mm (Tag / Jewelry)', labelsPerRow: 1, widthMm: 38, heightMm: 25, horizontalGapMm: 0 },
  { id: '1_50x25', name: '50 × 25 mm (Standard Compact)', labelsPerRow: 1, widthMm: 50, heightMm: 25, horizontalGapMm: 0 },
  { id: '2_50x25', name: '50 × 38 mm (Retail Standard)', labelsPerRow: 1, widthMm: 50, heightMm: 38, horizontalGapMm: 0 },
  { id: '1_60x40', name: '60 × 40 mm (Shipping / Product)', labelsPerRow: 1, widthMm: 60, heightMm: 40, horizontalGapMm: 0 },
  { id: '1_100x50', name: '100 × 50 mm (Large Carton / Box)', labelsPerRow: 1, widthMm: 100, heightMm: 50, horizontalGapMm: 0 },
  { id: '4_35x22_2up', name: '35 × 22 mm × 2-Up (Roll, side-by-side)', labelsPerRow: 2, widthMm: 35, heightMm: 22, horizontalGapMm: 2 },
  { id: '4_50x25_2up', name: '50 × 25 mm × 2-Up (Roll, side-by-side)', labelsPerRow: 2, widthMm: 50, heightMm: 25, horizontalGapMm: 2 },
  // A4 sheet presets — matches standard 4-column Avery/generic Indian label sheets
  { id: 'a4_4up_48x25', name: 'A4 Sheet — 4 columns × 48 × 25 mm', labelsPerRow: 4, widthMm: 48, heightMm: 25, horizontalGapMm: 2 },
  { id: 'a4_4up_48x30', name: 'A4 Sheet — 4 columns × 48 × 30 mm', labelsPerRow: 4, widthMm: 48, heightMm: 30, horizontalGapMm: 2 },
  { id: 'a4_3up_63x38', name: 'A4 Sheet — 3 columns × 63 × 38 mm', labelsPerRow: 3, widthMm: 63, heightMm: 38, horizontalGapMm: 3 },
  { id: 'a4_2up_99x34', name: 'A4 Sheet — 2 columns × 99 × 34 mm (Address label)', labelsPerRow: 2, widthMm: 99, heightMm: 34, horizontalGapMm: 3 },
]

export interface BarcodeSettings {
  printerType: 'label' | 'regular'
  selectedSizeId: string
  showSalePrice: boolean
  showCompanyName: boolean
  showItemName: boolean
  showDiscount: boolean
}

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  printerType: 'label',
  selectedSizeId: '2_38x25',
  showSalePrice: true,
  showCompanyName: true,
  showItemName: true,
  showDiscount: false,
}

const SETTINGS_KEY = 'clad_barcode_settings'
const LEGACY_SETTINGS_KEY = 'chaji_barcode_settings'
const CUSTOM_SIZES_KEY = 'clad_custom_label_sizes'
const LEGACY_CUSTOM_SIZES_KEY = 'chaji_custom_label_sizes'

export function getStoredBarcodeSettings(): BarcodeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (raw) return { ...DEFAULT_BARCODE_SETTINGS, ...JSON.parse(raw) }
  } catch (e) {
    console.error('Failed to parse barcode settings:', e)
  }
  return DEFAULT_BARCODE_SETTINGS
}

export function saveStoredBarcodeSettings(settings: BarcodeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save barcode settings:', e)
  }
}

type CustomSizeListener = (sizes: LabelSizeConfig[]) => void
const customSizeListeners: Set<CustomSizeListener> = new Set()

export function subscribeCustomSizes(listener: CustomSizeListener): () => void {
  customSizeListeners.add(listener)
  return () => {
    customSizeListeners.delete(listener)
  }
}

function notifyCustomSizesChanged(sizes: LabelSizeConfig[]) {
  customSizeListeners.forEach((fn) => {
    try {
      fn(sizes)
    } catch (e) {
      console.warn('[barcode] Listener error:', e)
    }
  })
}

export function getStoredCustomSizes(): LabelSizeConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SIZES_KEY) || localStorage.getItem(LEGACY_CUSTOM_SIZES_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to parse custom label sizes:', e)
  }
  return []
}

export async function fetchRemoteCustomSizes(): Promise<LabelSizeConfig[]> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('barcode_custom_sizes')
        .select('*')
        .order('created_at', { ascending: true })

      if (!error && Array.isArray(data)) {
        const remoteSizes: LabelSizeConfig[] = data.map((row: Record<string, unknown>) => ({
          id: String(row.id),
          name: String(row.name),
          labelsPerRow: Number(row.labels_per_row) || 1,
          widthMm: Number(row.width_mm),
          heightMm: Number(row.height_mm),
          horizontalGapMm: Number(row.horizontal_gap_mm) || 0,
          isCustom: true,
        }))

        // Merge remote sizes with local cache
        const local = getStoredCustomSizes()
        const mergedMap = new Map<string, LabelSizeConfig>()
        local.forEach((s) => mergedMap.set(s.id, s))
        remoteSizes.forEach((s) => mergedMap.set(s.id, s))
        const merged = Array.from(mergedMap.values())

        try {
          localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(merged))
        } catch {}
        notifyCustomSizesChanged(merged)
        return merged
      }
    } catch {
      // Table may be pending creation in Supabase
    }
  }
  return getStoredCustomSizes()
}

export function saveStoredCustomSize(size: LabelSizeConfig): LabelSizeConfig[] {
  const existing = getStoredCustomSizes().filter((s) => s.id !== size.id)
  const updatedSize: LabelSizeConfig = { ...size, isCustom: true }
  const updated = [...existing, updatedSize]

  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save custom label size locally:', e)
  }

  // Dual persistence: save to Supabase asynchronously
  if (isSupabaseConfigured) {
    ;(async () => {
      try {
        const { error } = await supabase
          .from('barcode_custom_sizes')
          .upsert({
            id: updatedSize.id,
            name: updatedSize.name,
            labels_per_row: updatedSize.labelsPerRow,
            width_mm: updatedSize.widthMm,
            height_mm: updatedSize.heightMm,
            horizontal_gap_mm: updatedSize.horizontalGapMm,
            is_custom: true,
            updated_at: new Date().toISOString(),
          })
        if (error) {
          console.warn('[barcode] Database save note:', error.message)
        }
      } catch (err) {
        console.warn('[barcode] Database save error:', err)
      }
    })()
  }

  notifyCustomSizesChanged(updated)
  return updated
}

export function deleteStoredCustomSize(sizeId: string): LabelSizeConfig[] {
  const existing = getStoredCustomSizes().filter((s) => s.id !== sizeId)
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Failed to delete custom label size locally:', e)
  }

  // Remove from Supabase asynchronously
  if (isSupabaseConfigured) {
    ;(async () => {
      try {
        const { error } = await supabase
          .from('barcode_custom_sizes')
          .delete()
          .eq('id', sizeId)
        if (error) {
          console.warn('[barcode] Database delete note:', error.message)
        }
      } catch (err) {
        console.warn('[barcode] Database delete error:', err)
      }
    })()
  }

  notifyCustomSizesChanged(existing)
  return existing
}

export function getAllLabelSizes(): LabelSizeConfig[] {
  return [...DEFAULT_LABEL_SIZES, ...getStoredCustomSizes()]
}

// Initial background sync from database if available
if (typeof window !== 'undefined' && isSupabaseConfigured) {
  fetchRemoteCustomSizes().catch(() => {})
}

export interface BarcodeQueueItem {
  id: string
  productId: number
  productName: string
  variantId?: string | null
  variantName?: string
  barcodeValue: string
  price: number
  costPrice?: number
  noOfLabels: number
  header: string
  line1: string
  line2: string
  line3: string
  line4: string
  selected: boolean
}

export interface BarcodeRenderOptions {
  width?: number
  height?: number
  displayValue?: boolean
  fontSize?: number
  font?: string
  textMargin?: number
  margin?: number
  lineColor?: string
  background?: string
}

/**
 * Render a CODE128 barcode directly into an SVG element.
 */
export function renderBarcodeSvg(
  svgElement: SVGSVGElement,
  value: string,
  options?: BarcodeRenderOptions
) {
  if (!svgElement || !value) return

  try {
    JsBarcode(svgElement, value.trim(), {
      format: 'CODE128',
      width: options?.width ?? 1.5,
      height: options?.height ?? 36,
      displayValue: options?.displayValue ?? true,
      fontSize: options?.fontSize ?? 11,
      font: options?.font ?? 'monospace',
      textMargin: options?.textMargin ?? 1,
      margin: options?.margin ?? 4,
      lineColor: options?.lineColor ?? '#000000',
      background: options?.background ?? '#ffffff',
    })
  } catch (err) {
    console.error('[renderBarcodeSvg] Failed to generate barcode:', err)
  }
}

/**
 * Generate a standalone SVG string for a CODE128 barcode.
 * Executes synchronously in the browser without requiring external CDN scripts.
 */
export function generateBarcodeSvgString(
  value: string,
  options?: BarcodeRenderOptions
): string {
  if (typeof document === 'undefined' || !value) return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    renderBarcodeSvg(svg, value, options)
    return svg.outerHTML || new XMLSerializer().serializeToString(svg)
  } catch (err) {
    console.error('[generateBarcodeSvgString] Failed to generate barcode SVG string:', err)
    return ''
  }
}

/**
 * Format barcode for UI display.
 */
export function formatBarcodeDisplay(value?: string | null): string {
  if (!value) return '—'
  return String(value).trim()
}

/**
 * Validate barcode format (alphanumeric, 4 to 32 chars).
 */
export function isValidBarcodeValue(value: string): boolean {
  return /^[A-Z0-9_-]{4,32}$/i.test(value.trim())
}
