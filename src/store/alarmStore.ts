import { create } from 'zustand'
import { alarmSound } from '../lib/alarmAudio'

export interface LowStockItem {
  id: string | number
  name: string
  variantName?: string
  stock: number
  alertThreshold: number
  barcode?: string
  category?: string
}

const NOTIFY_KEY = 'clad_lowstock_notify'
const SOUND_KEY = 'clad_lowstock_sound'
const readFlag = (key: string): boolean => {
  try { return localStorage.getItem(key) !== '0' } catch { return true }
}
const writeFlag = (key: string, value: boolean) => {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* private mode: the choice just isn't remembered */ }
}

interface AlarmState {
  /** Settings > Stock alerts (saved on this device) */
  notifyEnabled: boolean
  soundEnabled: boolean
  setNotifyEnabled: (on: boolean) => void
  setSoundEnabled: (on: boolean) => void
  lowStockItems: LowStockItem[]
  isAlarmActive: boolean
  silencedItemIds: Set<string | number>
  setLowStockItems: (items: LowStockItem[]) => void
  silenceAlarm: () => void
  resetSilencedState: () => void
}

const initialNotify = readFlag(NOTIFY_KEY)
const initialSound = readFlag(SOUND_KEY)
alarmSound.allowed = initialNotify && initialSound

export const useAlarmStore = create<AlarmState>((set, get) => ({
  notifyEnabled: initialNotify,
  soundEnabled: initialSound,

  setNotifyEnabled: (on) => {
    writeFlag(NOTIFY_KEY, on)
    alarmSound.allowed = on && get().soundEnabled
    if (!on) alarmSound.stopAlert()
    set({ notifyEnabled: on, ...(on ? {} : { isAlarmActive: false }) })
    if (on) get().setLowStockItems(get().lowStockItems)
  },

  setSoundEnabled: (on) => {
    writeFlag(SOUND_KEY, on)
    alarmSound.allowed = on && get().notifyEnabled
    if (!on) alarmSound.stopAlert()
    set({ soundEnabled: on })
  },

  lowStockItems: [],
  isAlarmActive: false,
  silencedItemIds: new Set<string | number>(),

  setLowStockItems: (items) => {
    const { silencedItemIds } = get()
    
    // Alarm triggers only if there is at least one low-stock item that has not been acknowledged
    const hasUnsilencedLowStock = items.some(
      (item) => !silencedItemIds.has(String(item.id)) && !silencedItemIds.has(item.id)
    )

    if (items.length > 0 && hasUnsilencedLowStock && get().notifyEnabled) {
      alarmSound.startAlert()
      set({ lowStockItems: items, isAlarmActive: true })
    } else {
      // If no items or all items are acknowledged/silenced, ensure alert is stopped
      alarmSound.stopAlert()
      set({ lowStockItems: items, isAlarmActive: false })
      if (items.length === 0) {
        set({ silencedItemIds: new Set() })
      }
    }
  },

  silenceAlarm: () => {
    const currentItemIds = get().lowStockItems.map((i) => String(i.id))
    alarmSound.stopAlert()
    set({
      isAlarmActive: false,
      silencedItemIds: new Set(currentItemIds),
    })
  },

  resetSilencedState: () => {
    set({ silencedItemIds: new Set() })
  },
}))
