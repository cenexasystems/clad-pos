import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Cake,
  ChevronLeft,
  ChevronRight,
  Download,
  Gift,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import {
  birthdayService,
  type BirthdayOffer,
  type OrderCustomer,
} from '../../services/birthdayService'
import {
  buildBirthdayMessage,
  dayOfYear,
  daysInMonth,
  daysUntilBirthday,
  daysUntilLabel,
  DEFAULT_BIRTHDAY_TEMPLATE,
  exportBirthdaysToCSV,
  formatBirthday,
  isBirthdayInRange,
  MONTH_NAMES,
  MONTH_SHORT,
  presetRange,
  type BirthdayCustomer,
  type BirthdayPreset,
  type MonthDayRange,
} from '../../lib/birthdays'
import { formatPhone, toWhatsAppUrl } from '../../lib/phone'
import { BirthdayCustomerModal } from './BirthdayCustomerModal'

type SubTab = 'calendar' | 'customers' | 'none'

interface Filter {
  preset: BirthdayPreset
  fromMonth: string
  fromDay: string
  toMonth: string
  toDay: string
}

const ALL_FILTER: Filter = { preset: 'all', fromMonth: '', fromDay: '', toMonth: '', toDay: '' }

const rangeOf = (f: Filter): MonthDayRange | null => {
  if (f.preset !== 'custom') return presetRange(f.preset)
  if (!f.fromMonth || !f.fromDay) return null
  const from = { month: Number(f.fromMonth), day: Number(f.fromDay) }
  const to = f.toMonth && f.toDay ? { month: Number(f.toMonth), day: Number(f.toDay) } : from
  return { from, to }
}

/** Customers inside the range, soonest first (all = next birthday first). */
const applyFilter = (customers: BirthdayCustomer[], range: MonthDayRange | null): BirthdayCustomer[] => {
  if (!range) {
    return [...customers].sort((a, b) => daysUntilBirthday(a) - daysUntilBirthday(b) || a.name.localeCompare(b.name))
  }
  const start = dayOfYear(range.from)
  const offset = (c: BirthdayCustomer) => (dayOfYear({ month: c.birth_month, day: c.birth_day }) - start + 366) % 366
  return customers
    .filter((c) => isBirthdayInRange(c, range))
    .sort((a, b) => offset(a) - offset(b) || a.name.localeCompare(b.name))
}

const cardCls = 'bg-white rounded-2xl border border-gray-200 shadow-sm'
const selectCls =
  'h-10 w-full px-3 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]'
const labelCls = 'block text-[10px] font-black tracking-wider text-gray-500 uppercase mb-1'

// ───────────────────────── Step 1: date / range picker ─────────────────────────
const RangeFilter: React.FC<{ filter: Filter; onChange: (f: Filter) => void }> = ({ filter, onChange }) => {
  const chips: { id: Exclude<BirthdayPreset, 'custom'>; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'all', label: 'All' },
  ]
  const setCustom = (patch: Partial<Filter>) => onChange({ ...filter, ...patch, preset: 'custom' })

  const monthSelect = (value: string, onPick: (v: string) => void) => (
    <select className={selectCls} value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">Month</option>
      {MONTH_NAMES.map((m, i) => (
        <option key={m} value={i + 1}>{m}</option>
      ))}
    </select>
  )
  const daySelect = (month: string, value: string, onPick: (v: string) => void) => (
    <select className={selectCls} value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">Day</option>
      {Array.from({ length: month ? daysInMonth(Number(month)) : 31 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange({ ...ALL_FILTER, preset: chip.id })}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
              filter.preset === chip.id ? 'bg-[#0A0A0A] text-[#D4AF37]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div>
        <span className={labelCls}>From</span>
        <div className="grid grid-cols-[1.4fr_1fr] gap-2">
          {monthSelect(filter.fromMonth, (v) => setCustom({ fromMonth: v, fromDay: filter.preset === 'custom' ? filter.fromDay : '' }))}
          {daySelect(filter.fromMonth, filter.fromDay, (v) => setCustom({ fromDay: v }))}
        </div>
      </div>
      <div>
        <span className={labelCls}>To</span>
        <div className="grid grid-cols-[1.4fr_1fr] gap-2">
          {monthSelect(filter.toMonth, (v) => setCustom({ toMonth: v }))}
          {daySelect(filter.toMonth, filter.toDay, (v) => setCustom({ toDay: v }))}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Month calendar ─────────────────────────
const MonthGrid: React.FC<{
  month: number
  onMonth: (m: number) => void
  customers: BirthdayCustomer[]
  range: MonthDayRange | null
  onPickDay: (month: number, day: number) => void
  onToday: () => void
}> = ({ month, onMonth, customers, range, onPickDay, onToday }) => {
  const now = new Date()
  const todayDay = now.getMonth() + 1 === month ? now.getDate() : 0
  const birthdayDays = useMemo(
    () => new Set(customers.filter((c) => c.birth_month === month).map((c) => c.birth_day)),
    [customers, month],
  )
  const shift = (delta: number) => onMonth(((month - 1 + delta + 12) % 12) + 1)

  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <select
          className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-900 outline-none"
          value={month}
          onChange={(e) => onMonth(Number(e.target.value))}
        >
          {MONTH_SHORT.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 cursor-pointer">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={onToday} className="h-9 px-3 rounded-xl border border-gray-200 text-xs font-bold hover:bg-gray-50 cursor-pointer">
            Today
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 cursor-pointer">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => {
          const inRange = range ? isBirthdayInRange({ birth_day: d, birth_month: month }, range) : false
          const isToday = d === todayDay
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPickDay(month, d)}
              className={`relative h-9 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                inRange
                  ? 'bg-[#0A0A0A] border-[#0A0A0A] text-[#D4AF37]'
                  : isToday
                    ? 'bg-[#FBFAF6] border-[#D4AF37] text-gray-900'
                    : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'
              }`}
            >
              {d}
              {birthdayDays.has(d) && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[11px] font-semibold text-gray-500 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Dot = birthday
      </p>
    </div>
  )
}

// ───────────────────────── Customer row ─────────────────────────
const CustomerRow: React.FC<{
  customer: BirthdayCustomer
  onSend: (c: BirthdayCustomer) => void
  onEdit: (c: BirthdayCustomer) => void
  onDelete: (c: BirthdayCustomer) => void
}> = ({ customer, onSend, onEdit, onDelete }) => {
  const days = daysUntilBirthday(customer)
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-t border-gray-100 first:border-t-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 shrink-0 rounded-full bg-[#FBFAF6] border border-[#E8D399] flex items-center justify-center">
          <Cake size={17} className="text-[#B8962E]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0A0A0A] truncate">{customer.name}</p>
          <p className="text-[11px] font-semibold text-gray-500">{formatPhone(customer.phone)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <span className="text-xs font-bold text-gray-800 bg-gray-100 rounded-lg px-2.5 py-1">{formatBirthday(customer)}</span>
        <span className={`text-[11px] font-bold ${days === 0 ? 'text-emerald-700' : 'text-gray-500'}`}>{daysUntilLabel(days)}</span>
        <button
          type="button"
          onClick={() => onSend(customer)}
          className="h-9 px-3.5 rounded-xl bg-[#25D366] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:brightness-95"
        >
          <MessageCircle size={14} /> Send Offer
        </button>
        <button type="button" onClick={() => onEdit(customer)} aria-label="Edit" className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-50 cursor-pointer">
          <Pencil size={14} />
        </button>
        <button type="button" onClick={() => onDelete(customer)} aria-label="Delete" className="w-9 h-9 rounded-xl border border-rose-100 flex items-center justify-center text-rose-500 hover:bg-rose-50 cursor-pointer">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ───────────────────────── Panel ─────────────────────────
export const BirthdayPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTab>('calendar')
  const [customers, setCustomers] = useState<BirthdayCustomer[]>([])
  const [orderCustomers, setOrderCustomers] = useState<OrderCustomer[]>([])
  const [offers, setOffers] = useState<BirthdayOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [calFilter, setCalFilter] = useState<Filter>(ALL_FILTER)
  const [listFilter, setListFilter] = useState<Filter>(ALL_FILTER)
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1)
  const [search, setSearch] = useState('')

  const [template, setTemplate] = useState(DEFAULT_BIRTHDAY_TEMPLATE)
  const [offerId, setOfferId] = useState<string | null>(null)
  const [saved, setSaved] = useState({ template: DEFAULT_BIRTHDAY_TEMPLATE, offerId: null as string | null })
  const [savingSettings, setSavingSettings] = useState(false)
  const [offerEditor, setOfferEditor] = useState<{ mode: 'add' | 'edit'; text: string } | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalCustomer, setModalCustomer] = useState<Partial<BirthdayCustomer> | null>(null)

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }, [])

  const load = useCallback(async () => {
    const [cust, ord, off, set] = await Promise.all([
      birthdayService.listCustomers(),
      birthdayService.listOrderCustomers(),
      birthdayService.listOffers(),
      birthdayService.getSettings(),
    ])
    setError(cust.data ? '' : cust.error)
    if (cust.data) setCustomers(cust.data)
    if (ord.data) setOrderCustomers(ord.data)
    if (off.data) setOffers(off.data)
    if (set.data) {
      setTemplate(set.data.message_template)
      setOfferId(set.data.selected_offer_id)
      setSaved({ template: set.data.message_template, offerId: set.data.selected_offer_id })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load()
  }, [load])

  const selectedOffer = offers.find((o) => o.id === offerId) || null
  const dirty = template !== saved.template || offerId !== saved.offerId

  const calRange = useMemo(() => rangeOf(calFilter), [calFilter])
  const listRange = useMemo(() => rangeOf(listFilter), [listFilter])
  const calList = useMemo(() => applyFilter(customers, calRange), [customers, calRange])
  const listList = useMemo(() => {
    const q = search.trim().toLowerCase()
    const inRange = applyFilter(customers, listRange)
    return q ? inRange.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '') || '§')) : inRange
  }, [customers, listRange, search])

  const withoutBirthday = useMemo(() => {
    const known = new Set(customers.map((c) => c.phone))
    const q = search.trim().toLowerCase()
    return orderCustomers
      .filter((c) => !known.has(c.phone))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '') || '§'))
  }, [customers, orderCustomers, search])
  const withoutBirthdayTotal = useMemo(() => {
    const known = new Set(customers.map((c) => c.phone))
    return orderCustomers.filter((c) => !known.has(c.phone)).length
  }, [customers, orderCustomers])

  const sampleName = (calList[0]?.name || 'Aarav').split(' ')[0]
  const preview = buildBirthdayMessage(template, { name: sampleName, offer: selectedOffer?.title || '' })

  const sendOffer = (c: BirthdayCustomer) => {
    const message = buildBirthdayMessage(template, { name: c.name.split(' ')[0], offer: selectedOffer?.title || '' })
    window.open(toWhatsAppUrl(c.phone, message), '_blank', 'noopener')
  }

  const openAdd = (prefill?: Partial<BirthdayCustomer>) => {
    setModalCustomer(prefill || null)
    setModalOpen(true)
  }

  const handleSaved = (c: BirthdayCustomer) => {
    setCustomers((prev) => [...prev.filter((p) => p.id !== c.id && p.phone !== c.phone), c])
    setModalOpen(false)
    flash(`${c.name}'s birthday saved`)
  }

  const handleDelete = async (c: BirthdayCustomer) => {
    if (!window.confirm(`Remove ${c.name}'s birthday?`)) return
    const { error: err } = await birthdayService.deleteCustomer(c.id)
    if (err) return flash(err)
    setCustomers((prev) => prev.filter((p) => p.id !== c.id))
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    const { error: err } = await birthdayService.saveSettings({ message_template: template, selected_offer_id: offerId })
    setSavingSettings(false)
    if (err) return flash(err)
    setSaved({ template, offerId })
    flash('Offer message saved')
  }

  const submitOffer = async () => {
    if (!offerEditor) return
    const result =
      offerEditor.mode === 'add'
        ? await birthdayService.addOffer(offerEditor.text)
        : await birthdayService.updateOffer(offerId as string, offerEditor.text)
    if (result.error || !result.data) return flash(result.error || 'Could not save the offer')
    const offer = result.data
    setOffers((prev) => (offerEditor.mode === 'add' ? [...prev, offer] : prev.map((o) => (o.id === offer.id ? offer : o))))
    setOfferId(offer.id)
    setOfferEditor(null)
  }

  const deleteOffer = async () => {
    if (!selectedOffer || !window.confirm(`Delete the offer "${selectedOffer.title}"?`)) return
    const { error: err } = await birthdayService.deleteOffer(selectedOffer.id)
    if (err) return flash(err)
    setOffers((prev) => prev.filter((o) => o.id !== selectedOffer.id))
    setOfferId(null)
  }

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'calendar', label: 'Calendar' },
    { id: 'customers', label: 'Customers' },
    { id: 'none', label: 'No Birthday' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#FBFAF6] border border-[#E8D399] flex items-center justify-center">
            <Cake size={22} className="text-[#B8962E]" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#0A0A0A]">Date of Birth</h2>
            <p className="text-xs text-gray-500 font-bold mt-0.5">Customer birthdays &amp; one-tap offer sender</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setLoading(true); void load() }} aria-label="Refresh" className="w-10 h-10 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-gray-700 hover:bg-gray-50 cursor-pointer">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => openAdd()}
            className="h-10 px-4 rounded-xl bg-[#0A0A0A] text-[#D4AF37] text-xs font-bold tracking-wide inline-flex items-center gap-2 cursor-pointer"
          >
            <UserPlus size={15} /> ADD CUSTOMER
          </button>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setSubTab(t.id)
              setSearch('')
            }}
            className={`pb-2.5 -mb-px text-sm font-bold border-b-2 cursor-pointer transition-colors ${
              subTab === t.id ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
            {t.id === 'none' && withoutBirthdayTotal > 0 && (
              <span className="ml-1.5 text-[10px] font-black bg-gray-200 text-gray-700 rounded-full px-1.5 py-0.5">{withoutBirthdayTotal}</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl">{error}</div>}
      {notice && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9998] bg-[#0A0A0A] text-[#D4AF37] text-xs font-bold px-4 py-2.5 rounded-xl shadow-xl">
          {notice}
        </div>
      )}

      {/* ───── Calendar ───── */}
      {subTab === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 items-start">
          <div className="space-y-5">
            <MonthGrid
              month={calMonth}
              onMonth={setCalMonth}
              customers={customers}
              range={calRange}
              onPickDay={(m, d) =>
                setCalFilter({ preset: 'custom', fromMonth: String(m), fromDay: String(d), toMonth: String(m), toDay: String(d) })
              }
              onToday={() => {
                setCalMonth(new Date().getMonth() + 1)
                setCalFilter({ ...ALL_FILTER, preset: 'today' })
              }}
            />
            <div className={`${cardCls} p-4`}>
              <h3 className="text-sm font-black text-[#0A0A0A] mb-3">Step 1 · Pick a date or range</h3>
              <RangeFilter filter={calFilter} onChange={setCalFilter} />
            </div>
          </div>

          <div className="space-y-5 min-w-0">
            <div className={cardCls}>
              <div className="p-4 pb-3">
                <h3 className="text-sm font-black text-[#0A0A0A]">Step 2 · Customers with birthdays ({calList.length})</h3>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">Pick a date or range on the left, then tap Send Offer on a customer.</p>
              </div>
              {calList.length === 0 ? (
                <p className="px-4 pb-5 text-sm text-gray-500 font-semibold">No birthdays found for this range.</p>
              ) : (
                <div>
                  {calList.map((c) => (
                    <CustomerRow key={c.id} customer={c} onSend={sendOffer} onEdit={(x) => openAdd(x)} onDelete={handleDelete} />
                  ))}
                </div>
              )}
            </div>

            <div className={`${cardCls} p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                    <Gift size={18} className="text-gray-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-[#0A0A0A]">Step 3 · Customise offer message</h3>
                    <p className="text-xs text-gray-500 font-semibold">Sent on WhatsApp when you tap "Send Offer".</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={!dirty || savingSettings}
                  className="h-9 px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer bg-[#0A0A0A] text-[#D4AF37] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> {savingSettings ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="mt-4">
                <span className={labelCls}>Select offer</span>
                <div className="flex items-center gap-2">
                  <select
                    className={`${selectCls} flex-1`}
                    value={offerId || ''}
                    onChange={(e) => {
                      setOfferId(e.target.value || null)
                      setOfferEditor(null)
                    }}
                  >
                    <option value="">No offer (just wish them)</option>
                    {offers.map((o) => (
                      <option key={o.id} value={o.id}>{o.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedOffer}
                    onClick={() => selectedOffer && setOfferEditor({ mode: 'edit', text: selectedOffer.title })}
                    aria-label="Edit offer"
                    className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={!selectedOffer}
                    onClick={() => void deleteOffer()}
                    aria-label="Delete offer"
                    className="w-10 h-10 rounded-xl border border-rose-100 flex items-center justify-center text-rose-500 hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {offerEditor ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      value={offerEditor.text}
                      onChange={(e) => setOfferEditor({ ...offerEditor, text: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && void submitOffer()}
                      placeholder="e.g. Flat 20% off on your birthday week"
                      className="h-10 flex-1 px-3 rounded-xl border border-gray-300 text-xs font-semibold outline-none focus:border-[#0A0A0A]"
                    />
                    <button type="button" onClick={() => void submitOffer()} className="h-10 px-4 rounded-xl bg-[#0A0A0A] text-[#D4AF37] text-xs font-bold cursor-pointer">
                      {offerEditor.mode === 'add' ? 'Add' : 'Update'}
                    </button>
                    <button type="button" onClick={() => setOfferEditor(null)} aria-label="Cancel" className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center cursor-pointer">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOfferEditor({ mode: 'add', text: '' })}
                    className="mt-2 w-full h-10 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-800 inline-flex items-center justify-center gap-1.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <Plus size={14} /> Add Offer
                  </button>
                )}
              </div>

              <div className="mt-4">
                <span className={labelCls}>Customize message</span>
                <textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={8}
                  className="w-full p-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900 outline-none focus:border-[#0A0A0A] resize-y"
                />
                <div className="mt-1 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] text-gray-500 font-semibold">
                    Use <b>{'{name}'}</b> for the customer's name and <b>{'{offer}'}</b> for the selected offer.
                  </p>
                  <button type="button" onClick={() => setTemplate(DEFAULT_BIRTHDAY_TEMPLATE)} className="text-[11px] font-bold text-gray-600 underline cursor-pointer">
                    Reset message
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                <span className={labelCls}>Message preview</span>
                <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{preview}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───── Customers ───── */}
      {subTab === 'customers' && (
        <div className="space-y-5">
          <div className={`${cardCls} p-4 sm:p-5`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-black text-[#0A0A0A]">Filter by upcoming birthday</h3>
              <button
                type="button"
                disabled={listList.length === 0}
                onClick={() => exportBirthdaysToCSV(listList)}
                className="h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-bold inline-flex items-center gap-1.5 text-gray-800 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
              >
                <Download size={14} /> Export CSV
              </button>
            </div>
            <RangeFilter filter={listFilter} onChange={setListFilter} />
          </div>

          <div className={cardCls}>
            <div className="p-3 border-b border-gray-100 relative">
              <Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or number"
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 text-xs font-semibold outline-none focus:border-[#0A0A0A]"
              />
            </div>
            {listList.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 font-semibold">No birthdays found for this range.</p>
            ) : (
              listList.map((c) => <CustomerRow key={c.id} customer={c} onSend={sendOffer} onEdit={(x) => openAdd(x)} onDelete={handleDelete} />)
            )}
          </div>
        </div>
      )}

      {/* ───── No birthday ───── */}
      {subTab === 'none' && (
        <div className={cardCls}>
          <div className="p-4 sm:p-5 border-b border-gray-100">
            <h3 className="text-sm font-black text-[#0A0A0A]">Customers without a birthday ({withoutBirthdayTotal})</h3>
            <p className="text-xs text-gray-500 font-semibold mt-0.5">People who bought from you but have no birthday saved yet. Ask them and add it.</p>
            {withoutBirthdayTotal > 0 && (
              <div className="mt-3 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or number"
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 text-xs font-semibold outline-none focus:border-[#0A0A0A]"
                />
              </div>
            )}
          </div>
          {withoutBirthdayTotal === 0 ? (
            <p className="p-5 text-sm text-gray-500 font-semibold">Every customer who has bought has a birthday saved.</p>
          ) : withoutBirthday.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 font-semibold">No customers match your search.</p>
          ) : (
            withoutBirthday.slice(0, 300).map((c) => (
              <div key={c.phone} className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 first:border-t-0">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0A0A0A] truncate">{c.name || 'Unnamed customer'}</p>
                  <p className="text-[11px] font-semibold text-gray-500">{formatPhone(c.phone)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openAdd({ name: c.name, phone: c.phone })}
                  className="h-9 px-3.5 rounded-xl border border-gray-200 text-xs font-bold inline-flex items-center gap-1.5 text-gray-800 hover:bg-gray-50 shrink-0 cursor-pointer"
                >
                  <Cake size={14} /> Add birthday
                </button>
              </div>
            ))
          )}
          {withoutBirthday.length > 300 && (
            <p className="px-4 py-3 text-[11px] font-semibold text-gray-500 border-t border-gray-100">Showing the 300 most recent. Search to find others.</p>
          )}
        </div>
      )}

      {modalOpen && <BirthdayCustomerModal onClose={() => setModalOpen(false)} onSaved={handleSaved} customer={modalCustomer} />}
    </div>
  )
}
