import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Cake, X } from 'lucide-react'
import { birthdayService } from '../../services/birthdayService'
import { daysInMonth, MONTH_NAMES, type BirthdayCustomer } from '../../lib/birthdays'
import { getSubscriberDigits } from '../../lib/phone'
import { lockScroll, unlockScroll } from '../../lib/scrollLock'

interface Props {
  onClose: () => void
  onSaved: (saved: BirthdayCustomer) => void
  /** Existing record to edit, or just a name/phone to pre-fill (customer picked from the No Birthday list) */
  customer?: Partial<BirthdayCustomer> | null
}

const inputCls =
  'w-full h-10 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-semibold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white'

/** Mount it only while open: the form starts from `customer` each time. */
export const BirthdayCustomerModal: React.FC<Props> = ({ onClose, onSaved, customer }) => {
  const [name, setName] = useState(customer?.name || '')
  const [phone, setPhone] = useState(customer?.phone ? getSubscriberDigits(customer.phone) || customer.phone : '')
  const [day, setDay] = useState(customer?.birth_day ? String(customer.birth_day) : '')
  const [month, setMonth] = useState(customer?.birth_month ? String(customer.birth_month) : '')
  const [year, setYear] = useState(customer?.birth_year ? String(customer.birth_year) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lockScroll()
    return () => unlockScroll()
  }, [])

  const maxDay = month ? daysInMonth(Number(month)) : 31
  const isEdit = Boolean(customer?.id)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!day || !month) return setError('Pick the birthday day and month.')
    if (Number(day) > maxDay) return setError(`${MONTH_NAMES[Number(month) - 1]} has only ${maxDay} days.`)
    const yearNum = year.trim() ? Number(year) : null
    if (yearNum !== null && (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear())) {
      return setError('Enter a valid birth year, or leave it blank.')
    }
    setSaving(true)
    setError('')
    const { data, error: err } = await birthdayService.saveCustomer({
      name,
      phone,
      birth_day: Number(day),
      birth_month: Number(month),
      birth_year: yearNum,
    })
    setSaving(false)
    if (err || !data) return setError(err || 'Could not save.')
    onSaved(data)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl sm:rounded-3xl max-w-md w-full max-h-[92dvh] border border-[#E8D399] shadow-2xl overflow-hidden flex flex-col">
        <div className="shrink-0 px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-[#FBFAF6]">
          <div className="flex items-center gap-2">
            <Cake size={17} className="text-[#D4AF37]" />
            <h3 className="text-sm font-bold text-[#0A0A0A]">{isEdit ? 'Edit Customer' : 'Add Customer'}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={submit} className="overflow-y-auto min-h-0 flex-1 p-4 sm:p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl">
              <AlertCircle size={15} className="text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" autoFocus />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">WhatsApp number *</label>
            <div className="flex">
              <span className="h-10 px-3 inline-flex items-center rounded-l-xl border border-r-0 border-gray-300 bg-gray-100 text-xs font-bold text-gray-600">+91</span>
              <input
                className={`${inputCls} rounded-l-none`}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))}
                inputMode="tel"
                placeholder="98765 43210"
                disabled={isEdit}
              />
            </div>
            {isEdit && <p className="mt-1 text-[10px] font-semibold text-gray-500">The number identifies the customer, so it can't be changed.</p>}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Birthday *</label>
            <div className="grid grid-cols-[1fr_1.6fr_1fr] gap-2">
              <select className={inputCls} value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Day</option>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Month</option>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                className={inputCls}
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="Year"
              />
            </div>
            <p className="mt-1 text-[10px] font-semibold text-gray-500">Year is optional.</p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full h-11 rounded-xl bg-[#0A0A0A] text-[#D4AF37] text-xs font-bold tracking-wide disabled:opacity-60 cursor-pointer"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Customer'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
