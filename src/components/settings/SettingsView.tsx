import React, { useState } from 'react'
import {
  AtSign, Bell, Clock, Hash, KeyRound, Languages, Mail, MapPin, MessageCircle, Palette, Phone, SlidersHorizontal, Store, User, Volume2,
} from 'lucide-react'
import { useShopSettingsStore, type ProfileFields } from '../../store/shopSettings'
import { useAlarmStore } from '../../store/alarmStore'
import { alarmSound } from '../../lib/alarmAudio'
import { ACCENT_PALETTE, DEFAULT_ACCENT, accentProblem, applyAccentToDocument, normalizeHex } from '../../lib/accent'
import { changePortalPassword, type PortalRole } from '../../lib/credentials'
import { normalizePhone } from '../../lib/phone'

const card = 'bg-white rounded-3xl border border-gray-200 shadow-sm p-5 sm:p-7'
const heading = 'flex items-center gap-2 text-[12px] font-black tracking-[0.2em] text-[#0A0A0A] uppercase'
const label = 'block text-[10px] font-black tracking-[0.18em] text-gray-600 uppercase mb-1.5'

// ───────────────────────── Appearance ─────────────────────────
const AppearanceCard: React.FC = () => {
  const accent = useShopSettingsStore((s) => s.settings.accent_color)
  const saveAccent = useShopSettingsStore((s) => s.saveAccent)
  const [hexInput, setHexInput] = useState(accent)
  const [message, setMessage] = useState('')

  const choose = async (hex: string) => {
    const normalized = normalizeHex(hex)
    setHexInput(hex)
    if (!normalized) return setMessage('Enter a colour like #D4AF37.')
    const problem = accentProblem(normalized)
    if (problem) {
      applyAccentToDocument(accent) // keep showing the saved colour
      return setMessage(problem)
    }
    setMessage('')
    applyAccentToDocument(normalized) // preview straight away
    const err = await saveAccent(normalized)
    setMessage(err || '')
  }

  return (
    <div className={card}>
      <h3 className={heading}><Palette size={15} /> Appearance</h3>
      <p className="mt-2 text-sm text-gray-600">One accent colour drives the whole app: POS, order pages, invoices, receipts and PDFs. The colours below suit the black and gold look.</p>

      {ACCENT_PALETTE.map((group) => (
        <div key={group.title} className="mt-5">
          <p className="text-[10px] font-black tracking-[0.18em] text-gray-500 uppercase mb-2">{group.title}</p>
          <div className="flex flex-wrap gap-2.5">
            {group.colors.map((c) => {
              const selected = normalizeHex(accent) === c.hex
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={`${c.name} ${c.hex}`}
                  aria-label={c.name}
                  onClick={() => void choose(c.hex)}
                  className={`w-10 h-10 rounded-xl cursor-pointer transition-transform hover:scale-105 ${selected ? 'ring-2 ring-offset-2 ring-[#0A0A0A]' : 'border border-black/10'}`}
                  style={{ backgroundColor: c.hex }}
                />
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-6 flex items-center gap-3">
        <label className="relative w-14 h-11 rounded-xl border border-black/10 overflow-hidden cursor-pointer shrink-0" style={{ backgroundColor: normalizeHex(hexInput) ?? accent }} title="Pick any colour">
          <input type="color" value={normalizeHex(hexInput) ?? accent} onChange={(e) => void choose(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <input
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={() => hexInput.toUpperCase() !== accent.toUpperCase() && void choose(hexInput)}
          onKeyDown={(e) => e.key === 'Enter' && void choose(hexInput)}
          maxLength={7}
          className="h-11 w-36 px-3 rounded-xl border border-gray-200 text-sm font-bold uppercase text-gray-900 outline-none focus:border-[#0A0A0A]"
          aria-label="Colour code"
        />
        <button type="button" onClick={() => void choose(DEFAULT_ACCENT)} className="text-[11px] font-black tracking-wider text-gray-700 underline cursor-pointer">RESET</button>
      </div>
      {message && <p className="mt-2 text-xs font-bold text-rose-700">{message}</p>}

      <div className="mt-5 rounded-2xl overflow-hidden border border-gray-200">
        <div className="bg-[#0A0A0A] px-5 py-5 text-center">
          <p className="text-sm font-black tracking-wide text-accent">CARD PREVIEW</p>
          <p className="text-xs text-white/80 mt-1">Buttons, links, totals and invoice headers use this colour.</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-white">
          <span className="rounded-xl bg-[#0A0A0A] px-4 py-2 text-[11px] font-black tracking-wider text-accent">BUTTON</span>
          <span className="text-sm font-black text-accent-dark">Accent link</span>
          <span className="rounded-lg bg-accent-soft border border-accent-light px-3 py-1.5 text-xs font-black text-[#0A0A0A]">Total ₹1,250</span>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Stock alerts ─────────────────────────
const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }> = ({ on, onChange, disabled, label: aria }) => (
  <button
    type="button" role="switch" aria-checked={on} aria-label={aria} disabled={disabled} onClick={() => onChange(!on)}
    className={`relative w-14 h-8 rounded-full transition-colors shrink-0 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${on ? 'bg-[#0A0A0A]' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
  </button>
)

const StockAlertsCard: React.FC = () => {
  const { notifyEnabled, soundEnabled, setNotifyEnabled, setSoundEnabled } = useAlarmStore()

  const testSound = () => {
    void alarmSound.unlock()
    alarmSound.startAlert(true)
    window.setTimeout(() => alarmSound.stopAlert(), 1800)
  }

  return (
    <div className={card}>
      <h3 className={heading}><Bell size={15} /> Stock alerts</h3>
      <p className="mt-2 text-sm text-gray-600">Choose how this device warns you when products run low or go out of stock.</p>

      <div className="mt-4 rounded-2xl border border-gray-200 px-4 py-3.5 flex items-center gap-4">
        <span className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><Bell size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-[#0A0A0A]">Low-stock notification</p>
          <p className="text-xs text-gray-600">Show a popup when items reach their low-stock alert level.</p>
        </div>
        <Toggle on={notifyEnabled} onChange={setNotifyEnabled} label="Low-stock notification" />
      </div>

      <div className={`mt-3 rounded-2xl border border-gray-200 px-4 py-3.5 flex items-center gap-4 ${notifyEnabled ? '' : 'opacity-60'}`}>
        <span className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><Volume2 size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-[#0A0A0A]">Alert sound</p>
          <p className="text-xs text-gray-600">Play the alarm sound with the popup.</p>
        </div>
        <Toggle on={soundEnabled} onChange={setSoundEnabled} disabled={!notifyEnabled} label="Alert sound" />
      </div>

      <button type="button" onClick={testSound} className="mt-4 h-10 px-4 rounded-xl border border-gray-300 text-[11px] font-black tracking-wider text-[#0A0A0A] inline-flex items-center gap-2 hover:bg-gray-50 cursor-pointer">
        <Volume2 size={14} /> TEST SOUND
      </button>
      <p className="mt-2 text-[11px] text-gray-500">These two choices are saved on this device only.</p>
    </div>
  )
}

// ───────────────────────── Shop profile ─────────────────────────
const Field: React.FC<{
  title: string
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'text' | 'tel' | 'email'
  className?: string
}> = ({ title, icon, value, onChange, placeholder, inputMode, className = '' }) => (
  <div className={className}>
    <label className={label}>{title}</label>
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode}
        className="w-full h-12 pl-11 pr-3 rounded-2xl border border-gray-200 text-sm font-bold text-[#0A0A0A] placeholder:font-semibold placeholder:text-gray-400 outline-none focus:border-[#0A0A0A]"
      />
    </div>
  </div>
)

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/

const ShopProfileCard: React.FC = () => {
  const settings = useShopSettingsStore((s) => s.settings)
  const saveProfile = useShopSettingsStore((s) => s.saveProfile)
  const [form, setForm] = useState<ProfileFields>({
    name: settings.name, name_ta: settings.name_ta, owner_name: settings.owner_name, phone: settings.phone, whatsapp: settings.whatsapp,
    owner_phone: settings.owner_phone, email: settings.email, address: settings.address, city: settings.city,
    business_hours: settings.business_hours, instagram: settings.instagram, gstin: settings.gstin,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (key: keyof ProfileFields) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(false)
    if (!form.name.trim()) return setError('Enter the shop name.')
    if (!form.phone.trim() || !normalizePhone(form.phone)) return setError('Enter a valid 10-digit contact number.')
    if (form.whatsapp.trim() && !normalizePhone(form.whatsapp)) return setError('The WhatsApp number is not a valid 10-digit number.')
    if (form.owner_phone.trim() && !normalizePhone(form.owner_phone)) return setError('The owner phone number is not a valid 10-digit number.')
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter a valid email address.')
    if (form.gstin.trim() && !GSTIN_FORMAT.test(form.gstin.trim().toUpperCase())) return setError('The GSTIN should be 15 characters, like 33ABCDE1234F1Z5.')

    setSaving(true)
    setError('')
    const err = await saveProfile(form)
    setSaving(false)
    if (err) return setError(err)
    setSaved(true)
  }

  return (
    <form onSubmit={submit} className={card}>
      <h3 className={heading}><Store size={15} /> Shop profile</h3>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
        <Field title="Shop owner name" icon={<User size={16} />} value={form.owner_name} onChange={set('owner_name')} />
        <Field title="Shop name" icon={<Store size={16} />} value={form.name} onChange={set('name')} />
        <Field title="Contact number" icon={<Phone size={16} />} value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" />
        <Field title="Email ID" icon={<Mail size={16} />} value={form.email} onChange={set('email')} inputMode="email" placeholder="shop@example.com" />
        <Field title="Owner phone number" icon={<Phone size={16} />} value={form.owner_phone} onChange={set('owner_phone')} inputMode="tel" placeholder="98765 43210" />
        <Field title="WhatsApp number" icon={<MessageCircle size={16} />} value={form.whatsapp} onChange={set('whatsapp')} inputMode="tel" placeholder="Same as contact number" />
        <div className="sm:col-span-2">
          <label className={label}>Shop address</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3.5 top-4 text-gray-400" />
            <textarea
              value={form.address} onChange={(e) => set('address')(e.target.value)} rows={3}
              className="w-full pl-11 pr-3 py-3.5 rounded-2xl border border-gray-200 text-sm font-bold text-[#0A0A0A] outline-none focus:border-[#0A0A0A] resize-y"
            />
          </div>
        </div>
        <Field title="City / location" icon={<MapPin size={16} />} value={form.city} onChange={set('city')} placeholder="e.g. Manapparai, Tamil Nadu" />
        <Field title="Business hours" icon={<Clock size={16} />} value={form.business_hours} onChange={set('business_hours')} placeholder="e.g. Open Daily, 10 AM – 9 PM" />
        <Field title="Shop name (Tamil)" icon={<Languages size={16} />} value={form.name_ta} onChange={set('name_ta')} />
        <Field title="Instagram ID" icon={<AtSign size={16} />} value={form.instagram} onChange={set('instagram')} placeholder="shop.official" />
        <Field title="GSTIN (on GST invoices)" icon={<Hash size={16} />} value={form.gstin} onChange={set('gstin')} placeholder="Optional" />
      </div>

      {error && <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {saved && <p className="mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">Saved. The new details are now used on bills, return invoices, receipts, PDFs, WhatsApp messages and labels.</p>}

      <div className="mt-5 flex justify-end">
        <button type="submit" disabled={saving} className="h-11 px-6 rounded-xl bg-[#0A0A0A] text-accent text-xs font-black tracking-wider disabled:opacity-60 cursor-pointer">
          {saving ? 'SAVING…' : 'SAVE SHOP PROFILE'}
        </button>
      </div>
    </form>
  )
}

// ───────────────────────── Change password ─────────────────────────
const ChangePasswordCard: React.FC = () => {
  const [role, setRole] = useState<PortalRole>('admin')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const switchRole = (r: PortalRole) => {
    setRole(r)
    setError('')
    setDone('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setDone('')
    if (next !== confirm) return setError('The new password and its confirmation are different.')
    setBusy(true)
    const err = await changePortalPassword({ targetRole: role, currentAdminPassword: current, newPassword: next })
    setBusy(false)
    if (err) return setError(err)
    setDone(role === 'admin' ? 'Admin password changed. Use the new password the next time you log in.' : 'Staff password reset. Staff use the new password the next time they log in.')
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  const input = 'w-full h-12 px-4 rounded-2xl border border-gray-200 text-sm font-bold text-[#0A0A0A] outline-none focus:border-[#0A0A0A]'

  return (
    <form onSubmit={submit} className={`${card} mt-6`}>
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-[#0A0A0A] text-white flex items-center justify-center"><KeyRound size={18} /></span>
        <div>
          <h3 className="text-sm font-black tracking-wide text-[#0A0A0A] uppercase">Change password</h3>
          <p className="text-xs text-gray-600">Change the admin password, or reset the staff password.</p>
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-2xl border border-gray-200 p-1.5 gap-1">
        {(['admin', 'staff'] as const).map((r) => (
          <button key={r} type="button" onClick={() => switchRole(r)}
            className={`h-10 px-5 rounded-xl text-[11px] font-black tracking-wider uppercase cursor-pointer ${role === r ? 'bg-[#0A0A0A] text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
            {r} password
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={label}>Your current admin password</label>
          <input type="password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className={label}>New {role} password</label>
          <input type="password" className={input} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className={label}>Confirm new password</label>
          <input type="password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
      </div>

      {error && <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {done && <p className="mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{done}</p>}

      <button type="submit" disabled={busy || !current || !next || !confirm}
        className="mt-5 h-12 px-6 rounded-2xl bg-[#0A0A0A] text-white text-xs font-black tracking-wider inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer">
        <KeyRound size={14} /> {busy ? 'CHANGING…' : 'CHANGE PASSWORD'}
      </button>
    </form>
  )
}

// ───────────────────────── Page ─────────────────────────
export const SettingsView: React.FC = () => {
  // A new key re-fills the profile form when the settings are reloaded from the database
  const version = useShopSettingsStore((s) => s.version)

  return (
    <div className="space-y-6">
      <div className={`${card} flex items-center gap-4`}>
        <span className="w-14 h-14 rounded-2xl bg-[#0A0A0A] text-white flex items-center justify-center shrink-0"><SlidersHorizontal size={22} /></span>
        <div>
          <h2 className="text-lg font-black tracking-wide text-[#0A0A0A] uppercase">Shop settings</h2>
          <p className="text-sm text-gray-600">Update the shop profile, colours and stock alerts used across the POS and invoices.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <AppearanceCard />
          <StockAlertsCard />
        </div>
        <ShopProfileCard key={version} />
      </div>

      <ChangePasswordCard />
    </div>
  )
}
