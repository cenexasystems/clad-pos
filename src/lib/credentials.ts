import { isSupabaseConfigured, supabase } from './supabase'

// Admin / staff passwords. Until a password is changed in Settings, the one from the app's environment
// settings (VITE_ADMIN_PASSWORD / VITE_STAFF_PASSWORD, or the built-in defaults) is used. After a
// change, only the SHA-256 of "<role>:<password>" is stored in the database.
// This login is checked in the browser, like the rest of the app's access control: it keeps staff
// out of admin screens but is not a replacement for server-side accounts.

export type PortalRole = 'admin' | 'staff'

const envPassword = (role: PortalRole): string =>
  role === 'admin'
    ? String(import.meta.env.VITE_ADMIN_PASSWORD || import.meta.env.VITE_PORTAL_PASSWORD || 'admin123').trim()
    : String(import.meta.env.VITE_STAFF_PASSWORD || 'staff123').trim()

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const hashPassword = (role: PortalRole, password: string) => sha256Hex(`${role}:${password.trim()}`)

/** The saved hash for a role, or '' when none was ever saved (or the database can't be reached). */
const storedHash = async (role: PortalRole): Promise<string> => {
  if (!isSupabaseConfigured) return ''
  const column = `${role}_password_hash`
  const { data, error } = await supabase.from('store_settings').select(column).eq('id', 1).maybeSingle()
  if (error || !data) return ''
  return String((data as unknown as Record<string, unknown>)[column] || '')
}

export async function verifyPortalPassword(role: PortalRole, input: string): Promise<boolean> {
  const password = (input || '').trim()
  if (!password) return false
  const saved = await storedHash(role)
  if (saved) return (await hashPassword(role, password)) === saved
  return password === envPassword(role)
}

export const verifyAdminPassword = (input: string) => verifyPortalPassword('admin', input)

/** Saves a new admin or staff password. Needs the admin's current password. Resolves to an error message, or null. */
export async function changePortalPassword(input: {
  targetRole: PortalRole
  currentAdminPassword: string
  newPassword: string
}): Promise<string | null> {
  const next = input.newPassword.trim()
  if (next.length < 6) return 'Use at least 6 characters for the new password.'
  if (!(await verifyAdminPassword(input.currentAdminPassword))) return 'The current admin password is not correct.'
  if (!isSupabaseConfigured) return 'Connect Supabase to change passwords.'
  if (typeof crypto === 'undefined' || !crypto.subtle) return 'This browser cannot change passwords (it needs a secure https connection).'

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { id: 1, [`${input.targetRole}_password_hash`]: await hashPassword(input.targetRole, next), updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
  if (!error) return null
  return /password_hash|schema cache|column/i.test(error.message)
    ? 'Settings are not set up yet. Run supabase/migrations/20261115_0034_shop_settings.sql in the Supabase SQL editor.'
    : error.message
}
