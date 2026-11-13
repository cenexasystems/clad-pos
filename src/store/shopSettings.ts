import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEFAULT_SHOP_SETTINGS, applyBrandSettings, type ShopSettings } from '../lib/brand'
import { DEFAULT_ACCENT, applyAccentToDocument, normalizeHex } from '../lib/accent'
import { useSettingsStore } from './store'

const CACHE_KEY = 'clad_shop_settings_v1'

const PROFILE_FIELDS = [
  'name', 'name_ta', 'owner_name', 'phone', 'whatsapp', 'owner_phone', 'email', 'address', 'city', 'business_hours', 'instagram', 'gstin',
] as const
export type ProfileFields = Pick<ShopSettings, (typeof PROFILE_FIELDS)[number]>

const MISSING_HINT = 'Settings are not set up yet. Run supabase/migrations/20261115_0034_shop_settings.sql in the Supabase SQL editor.'
const friendly = (message: string) => (/profile_saved|accent_color|schema cache|column/i.test(message) ? MISSING_HINT : message)

interface ShopSettingsState {
  settings: ShopSettings
  /** goes up every time the settings change, so screens re-render with the new values */
  version: number
  load: () => Promise<void>
  saveProfile: (profile: ProfileFields) => Promise<string | null>
  saveAccent: (hex: string) => Promise<string | null>
}

const readCache = (): ShopSettings | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? { ...DEFAULT_SHOP_SETTINGS, ...(JSON.parse(raw) as Partial<ShopSettings>) } : null
  } catch {
    return null
  }
}
const writeCache = (settings: ShopSettings) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)) } catch { /* private mode: nothing to remember */ }
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)

/** The saved shop profile is used only once the owner has saved the Settings page; before that the built-in details stay. */
const fromRow = (row: Record<string, unknown> | null): ShopSettings => {
  const accent = normalizeHex(str(row?.accent_color, '')) ?? DEFAULT_ACCENT
  const out = { ...DEFAULT_SHOP_SETTINGS, accent_color: accent }
  if (!row || row.profile_saved !== true) return out
  for (const key of PROFILE_FIELDS) out[key] = str(row[key], DEFAULT_SHOP_SETTINGS[key])
  return out
}

export const useShopSettingsStore = create<ShopSettingsState>((set, get) => {
  const apply = (settings: ShopSettings) => {
    applyBrandSettings(settings)
    applyAccentToDocument(settings.accent_color)
    writeCache(settings)
    set({ settings, version: get().version + 1 })
  }

  return {
    settings: DEFAULT_SHOP_SETTINGS,
    version: 0,

    load: async () => {
      if (!isSupabaseConfigured) return
      const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).maybeSingle()
      if (error) return // keep the cached / built-in values
      apply(fromRow(data as Record<string, unknown> | null))
    },

    saveProfile: async (profile) => {
      if (!isSupabaseConfigured) return 'Connect Supabase to save settings.'
      const cleaned = { ...profile } as Record<string, string>
      for (const key of PROFILE_FIELDS) cleaned[key] = (cleaned[key] ?? '').trim()
      cleaned.gstin = cleaned.gstin.toUpperCase()
      const { error } = await supabase
        .from('store_settings')
        .upsert({ id: 1, ...cleaned, profile_saved: true, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      if (error) return friendly(error.message)
      apply({ ...get().settings, ...(cleaned as unknown as ProfileFields) })
      void useSettingsStore.getState().fetchSettings() // the older settings store reads the same row
      return null
    },

    saveAccent: async (hex) => {
      const accent = normalizeHex(hex)
      if (!accent) return 'Enter a colour like #D4AF37.'
      if (isSupabaseConfigured) {
        const { error } = await supabase.from('store_settings').upsert({ id: 1, accent_color: accent, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        if (error) return friendly(error.message)
      }
      apply({ ...get().settings, accent_color: accent })
      return null
    },
  }
})

/** Call once before the first render: shows the last known settings immediately, then refreshes from the database. */
export function initShopSettings(): void {
  const cached = readCache()
  if (cached) {
    applyBrandSettings(cached)
    applyAccentToDocument(cached.accent_color)
    useShopSettingsStore.setState({ settings: cached })
  }
  void useShopSettingsStore.getState().load()
}
