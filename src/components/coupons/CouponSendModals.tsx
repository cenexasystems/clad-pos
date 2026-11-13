import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, MessageCircle, Search, X } from 'lucide-react'
import { couponShareService, type CouponRecipient } from '../../services/couponShareService'
import { buildCouponMessage, canShareCouponImage, type CouponForMessage } from '../../lib/couponMessage'
import { formatPhone, normalizePhone, toWhatsAppUrl } from '../../lib/phone'
import { lockScroll, unlockScroll } from '../../lib/scrollLock'

export interface ShareableCoupon extends CouponForMessage {
  id: number
}

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-gray-300 bg-[#FAFAFA] text-sm font-semibold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white'

const openWhatsApp = (phone: string, message: string) => {
  window.open(toWhatsAppUrl(phone, message), '_blank', 'noopener')
}

/** Share the coupon picture itself (not just a link) through the device share sheet, with the message as caption. */
const shareCouponImage = async (imageUrl: string, message: string): Promise<'shared' | 'unsupported' | 'cancelled'> => {
  const response = await fetch(imageUrl)
  const blob = await response.blob()
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const file = new File([blob], `coupon.${ext}`, { type: blob.type || 'image/jpeg' })
  if (!navigator.canShare({ files: [file] })) return 'unsupported'
  try {
    await navigator.share({ files: [file], text: message })
    return 'shared'
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'unsupported'
  }
}

const ModalShell: React.FC<{ title: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => {
    lockScroll()
    return () => unlockScroll()
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md max-h-[92dvh] bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col border border-accent-light">
        <div className="shrink-0 bg-[#0A0A0A] text-white px-5 py-4 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-black tracking-tight min-w-0">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 shrink-0 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

const CouponPreviewImage: React.FC<{ url?: string | null }> = ({ url }) =>
  url ? (
    <img src={url} alt="Coupon" className="w-full max-h-44 object-contain rounded-xl border border-gray-200 bg-gray-50" />
  ) : null

// ───────────────────────── Send to one customer ─────────────────────────
export const SendCouponModal: React.FC<{
  coupon: ShareableCoupon
  onClose: () => void
  onSent: (couponId: number) => void
}> = ({ coupon, onClose, onSent }) => {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const prepare = (): string | null => {
    const normalized = normalizePhone(phone)
    if (!normalized) {
      setError('Enter a valid 10-digit WhatsApp number.')
      return null
    }
    setError('')
    return normalized
  }

  const sendLink = () => {
    const normalized = prepare()
    if (!normalized) return
    openWhatsApp(normalized, buildCouponMessage(coupon, name))
    void couponShareService.recordSend(coupon.id, normalized, name).then(() => onSent(coupon.id))
    onClose()
  }

  const sendImage = async () => {
    const normalized = prepare()
    if (!normalized || !coupon.image_url) return
    setBusy(true)
    try {
      const result = await shareCouponImage(coupon.image_url, buildCouponMessage(coupon, name))
      if (result === 'unsupported') {
        setError("This browser can't attach the image. Use \"Send link on WhatsApp\": the picture shows in the chat.")
      } else if (result === 'shared') {
        await couponShareService.recordSend(coupon.id, normalized, name)
        onSent(coupon.id)
        onClose()
      }
    } catch {
      setError('Could not load the coupon image. Use "Send link on WhatsApp" instead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={<>Send coupon · <span className="font-mono text-accent">{coupon.code}</span></>}
      onClose={onClose}
    >
      <div className="p-5 space-y-4">
        <p className="text-[13px] text-gray-600 leading-relaxed">
          The coupon goes in the customer's WhatsApp chat as a message{coupon.image_url ? ', with your coupon picture' : ''}. It is counted once the chat opens.
        </p>
        <CouponPreviewImage url={coupon.image_url} />

        <div>
          <label className="block text-[10px] font-black tracking-wider text-gray-500 uppercase mb-1">Customer phone *</label>
          <input
            className={inputCls}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))}
            inputMode="tel"
            placeholder="Enter WhatsApp number"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[10px] font-black tracking-wider text-gray-500 uppercase mb-1">Customer name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </div>

        {error && <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} className="h-11 px-5 rounded-xl border border-gray-300 text-sm font-bold text-gray-800 hover:bg-gray-50 cursor-pointer">
            Cancel
          </button>
          <button type="button" onClick={sendLink} className="h-11 px-5 rounded-xl bg-[#25D366] text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer hover:brightness-95">
            <MessageCircle size={16} /> Send link on WhatsApp
          </button>
        </div>
        {coupon.image_url && canShareCouponImage() && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendImage()}
            className="w-full h-11 rounded-xl border border-gray-300 text-sm font-bold text-gray-800 inline-flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-60 cursor-pointer"
          >
            <ImageIcon size={16} /> {busy ? 'Preparing…' : 'Share the coupon image'}
          </button>
        )}
      </div>
    </ModalShell>
  )
}

// ───────────────────────── Send to everyone ─────────────────────────
export const SendCouponToEveryoneModal: React.FC<{
  coupon: ShareableCoupon
  onClose: () => void
  onSent: (couponId: number) => void
}> = ({ coupon, onClose, onSent }) => {
  const [recipients, setRecipients] = useState<CouponRecipient[] | null>(null)
  const [alreadySent, setAlreadySent] = useState<Set<string>>(new Set())
  const [sentNow, setSentNow] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    let live = true
    void Promise.all([couponShareService.listRecipients(), couponShareService.listSentPhones(coupon.id)]).then(([list, sent]) => {
      if (!live) return
      setRecipients(list)
      setAlreadySent(sent)
    })
    return () => {
      live = false
    }
  }, [coupon.id])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return (recipients || []).filter((r) => !q || r.name.toLowerCase().includes(q) || (digits && r.phone.includes(digits)))
  }, [recipients, search])

  const send = (r: CouponRecipient) => {
    openWhatsApp(r.phone, buildCouponMessage(coupon, r.name))
    setSentNow((prev) => new Set(prev).add(r.phone))
    void couponShareService.recordSend(coupon.id, r.phone, r.name).then(() => onSent(coupon.id))
  }

  return (
    <ModalShell title={<>Send <span className="font-mono text-accent">{coupon.code}</span> to customers</>} onClose={onClose}>
      <div className="p-5 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inputCls} pl-9 h-10`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number" />
        </div>

        <div className="rounded-2xl border border-gray-200 overflow-hidden max-h-[46dvh] overflow-y-auto">
          {recipients === null ? (
            <p className="p-5 text-sm font-semibold text-gray-500">Loading customers…</p>
          ) : visible.length === 0 ? (
            <p className="p-5 text-sm font-semibold text-gray-500">{recipients.length === 0 ? 'No customers with a phone number yet.' : 'No customers match your search.'}</p>
          ) : (
            visible.map((r) => {
              const done = sentNow.has(r.phone)
              const before = alreadySent.has(r.phone)
              return (
                <div key={r.phone} className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 first:border-t-0">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0A0A0A] truncate">{r.name || 'Customer'}</p>
                    <p className="text-[11px] font-semibold italic text-gray-500">{formatPhone(r.phone)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => send(r)}
                    className={`shrink-0 text-xs font-black tracking-wide cursor-pointer ${done ? 'text-emerald-700' : before ? 'text-gray-500' : 'text-[#0A0A0A]'}`}
                  >
                    {done ? 'SENT ✓' : before ? 'SENT BEFORE · RESEND' : 'SEND'}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs font-semibold text-gray-500">{sentNow.size} sent</span>
          <button type="button" onClick={onClose} className="h-11 px-6 rounded-xl bg-[#0A0A0A] text-accent text-xs font-black tracking-wider cursor-pointer">
            DONE · {sentNow.size} SENT
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
