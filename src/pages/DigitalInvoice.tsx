import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { Invoice } from '../components/Invoice'
import { Printer, ArrowLeft, MessageCircle, RefreshCw, Search } from 'lucide-react'
import { printThermalReceipt } from '../lib/thermalPrint'
import { invoicePdfFile, invoicePdfFileFromElement } from '../lib/invoicePdf'
import { uploadInvoicePdf } from '../lib/storage'
import { isUuid, normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { buildProfessionalWhatsAppMessage } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'

export function extractInvoiceCandidates(rawInput: string): string[] {
  if (!rawInput) return []
  let decoded = rawInput
  try {
    decoded = decodeURIComponent(rawInput)
  } catch {
    decoded = rawInput
  }

  // Strip zero-width chars, spaces, quotes
  const trimmed = decoded.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  // Strip leading punctuation: #, @, :, -, /, \
  const clean = trimmed.replace(/^[#@:\-/\\]+/, '').replace(/[/.,\s\\]+$/, '').trim()

  const set = new Set<string>()

  if (trimmed) set.add(trimmed)
  if (clean) set.add(clean)

  // Strip INV or INV- or INV_
  const strippedInv = clean.replace(/^INV[-_ ]?/i, '').trim()
  if (strippedInv) {
    set.add(strippedInv)
  }

  // Check for any digits
  const digitMatches = clean.match(/\d+/g)
  if (digitMatches) {
    const joinedDigits = digitMatches.join('')
    const intVal = parseInt(joinedDigits, 10)

    set.add(joinedDigits)
    if (joinedDigits.length < 8) {
      set.add(joinedDigits.padStart(8, '0'))
    }
    if (!isNaN(intVal)) {
      const intStr = String(intVal)
      set.add(intStr)
      set.add(intStr.padStart(8, '0'))
      set.add('INV' + intStr.padStart(8, '0'))
      set.add('INV-' + intStr.padStart(8, '0'))
      set.add('INV' + intStr)
      set.add('INV-' + intStr)
    }
  }

  try {
    const formatted = formatInvoiceNo(clean)
    if (formatted) set.add(formatted)
  } catch {}

  // Also include uppercase/lowercase versions of candidates
  const candidates = Array.from(set).map(s => s.trim()).filter(Boolean)
  const expanded = new Set<string>(candidates)
  for (const c of candidates) {
    if (c.toUpperCase() !== c) expanded.add(c.toUpperCase())
    if (c.toLowerCase() !== c) expanded.add(c.toLowerCase())
  }

  return Array.from(expanded)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformAdvanceOrderToInvoice(adv: any) {
  const items = Array.isArray(adv.products) && adv.products.length > 0
    ? adv.products
    : [
        {
          name: adv.product_name || 'Advance Order Item',
          quantity: 1,
          base_price: adv.total_amount,
          line_total: adv.total_amount,
          unit: 'piece',
          unit_type: 'unit',
          source: 'advance_order',
          category: adv.category || '',
        },
      ]

  return {
    id: adv.id,
    invoice_no: adv.invoice_number || adv.deposit_id,
    customer_name: adv.customer_name || 'Valued Customer',
    phone: adv.phone || '',
    address: adv.address || '',
    items,
    subtotal: adv.total_amount || 0,
    shipping: 0,
    total: adv.total_amount || 0,
    status: adv.status || 'completed',
    order_mode: 'offline',
    order_type: 'advance_order',
    delivery_charge: 0,
    discount_amount: 0,
    manual_discount_amount: 0,
    total_gst: 0,
    gst_amount: 0,
    payment_mode: adv.final_payment_method || 'cash',
    payment_method: adv.final_payment_method || 'cash',
    created_at: adv.created_at,
    updated_at: adv.updated_at,
  }
}

export default function DigitalInvoice() {
  const { id } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const invoiceElementRef = useRef<HTMLDivElement>(null)

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/dashboard')
    }
  }

  // Resolve target identifier from param, hash, or search query
  const getEffectiveIdentifier = useCallback((): string => {
    if (id && id.trim()) return id.trim()

    // Check location hash (e.g. /invoice#INV00000069 or /invoice/#INV00000069)
    if (location.hash) {
      const cleanHash = location.hash.replace(/^[#/]+/, '').trim()
      if (cleanHash) return cleanHash
    }

    // Check query params (?id=... or ?inv=... or ?no=... or ?invoice=...)
    const queryId =
      searchParams.get('id') ||
      searchParams.get('inv') ||
      searchParams.get('no') ||
      searchParams.get('invoice')
    if (queryId && queryId.trim()) return queryId.trim()

    return ''
  }, [id, location.hash, searchParams])

  const findInvoiceRow = useCallback(async (candidates: string[]) => {
    if (!isSupabaseConfigured) {
      throw new Error('Database connection not configured')
    }

    // Tier 1: Try RPC get_public_invoice_by_number with all candidate strings
    for (const c of candidates) {
      try {
        const { data, error } = await supabase.rpc('get_public_invoice_by_number', { p_invoice_no: c })
        if (!error && data) {
          const row = Array.isArray(data) ? data[0] : data
          if (row && typeof row === 'object' && ('id' in row || 'invoice_no' in row)) {
            return row
          }
        }
      } catch {
        // Fall through to next candidate / tier
      }
    }

    // Tier 2: Direct orders table query (exact match on invoice_no)
    for (const c of candidates) {
      try {
        const { data, error } = await supabase.from('orders').select('*').eq('invoice_no', c).maybeSingle()
        if (!error && data) return data
      } catch {
        // Fall through
      }
    }

    // Tier 3: Case-insensitive match on orders table
    for (const c of candidates) {
      try {
        const { data, error } = await supabase.from('orders').select('*').ilike('invoice_no', c).maybeSingle()
        if (!error && data) return data
      } catch {
        // Fall through
      }
    }

    // Tier 4: Query by ID (if candidate is UUID)
    for (const c of candidates) {
      if (isUuid(c)) {
        try {
          const { data, error } = await supabase.from('orders').select('*').eq('id', c).maybeSingle()
          if (!error && data) return data
        } catch {
          // Fall through
        }
      }
    }

    // Tier 5: Query advance_orders table (by deposit_id or invoice_number)
    for (const c of candidates) {
      try {
        const { data, error } = await supabase
          .from('advance_orders')
          .select('*')
          .or(`deposit_id.eq.${c},invoice_number.eq.${c},deposit_id.ilike.${c},invoice_number.ilike.${c}`)
          .maybeSingle()

        if (!error && data) {
          // If this advance order was completed into an order, fetch full sale order
          if (data.completed_order_id) {
            const { data: linkedOrder } = await supabase
              .from('orders')
              .select('*')
              .eq('id', data.completed_order_id)
              .maybeSingle()
            if (linkedOrder) return linkedOrder
          }
          return transformAdvanceOrderToInvoice(data)
        }
      } catch {
        // Fall through
      }
    }

    // Tier 6: Check local storage cache (for POS device or offline sync)
    try {
      const localOrdersStr = localStorage.getItem('local_orders')
      if (localOrdersStr) {
        const localOrders = JSON.parse(localOrdersStr)
        if (Array.isArray(localOrders)) {
          for (const order of localOrders) {
            for (const c of candidates) {
              if (
                order.invoice_no === c ||
                order.id === c ||
                (order.invoice_no && extractInvoiceCandidates(order.invoice_no).includes(c))
              ) {
                return order
              }
            }
          }
        }
      }
    } catch {
      // Local storage fallback optional
    }

    return null
  }, [])

  const loadInvoice = useCallback(async (customIdentifier?: string) => {
    const rawTarget = customIdentifier !== undefined ? customIdentifier : getEffectiveIdentifier()
    if (!rawTarget) {
      setError('Please provide an invoice number to view.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    const candidates = extractInvoiceCandidates(rawTarget)
    setSearchInput(rawTarget.replace(/^[#\s]+/, ''))

    try {
      let row = await findInvoiceRow(candidates)

      // Automatic fast retry after 500ms (solves replication/network lag right after order creation)
      if (!row) {
        await new Promise(r => setTimeout(r, 500))
        row = await findInvoiceRow(candidates)
      }

      if (!row) {
        throw new Error(`Invoice #${rawTarget.replace(/^[#\s]+/, '')} could not be found.`)
      }

      setInvoice(row)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('The requested invoice could not be found.')
      }
    } finally {
      setLoading(false)
    }
  }, [getEffectiveIdentifier, findInvoiceRow])

  useEffect(() => {
    void loadInvoice()
  }, [loadInvoice])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      void loadInvoice(searchInput.trim())
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#f9faf6] flex flex-col items-center justify-center p-4">
        <span className="w-10 h-10 border-4 border-[#E8D399] border-t-[#0A0A0A] rounded-full animate-spin mb-4" />
        <p className="text-xs uppercase font-semibold tracking-wider text-gray-500">Loading invoice...</p>
      </div>
    )
  }

  if (error || !invoice) {
    const currentId = getEffectiveIdentifier()
    return (
      <div className="min-h-[100dvh] bg-[#f9faf6] flex flex-col items-center justify-center p-4 sm:p-6 text-center">
        <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-[#E8D399]/40">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 font-bold text-xl">
            #
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0A0A0A] mb-2">Invoice Not Found</h1>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            {error || `We couldn't locate an invoice matching "${currentId}". Please verify the invoice number below.`}
          </p>

          <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="e.g. 69 or INV00000069"
              className="flex-1 px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent"
            />
            <button
              type="submit"
              className="px-4 py-2.5 bg-[#0A0A0A] text-[#D4AF37] rounded-xl font-bold text-sm hover:bg-[#1A1A1A] transition flex items-center gap-1.5 cursor-pointer"
            >
              <Search size={15} /> Find
            </button>
          </form>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => void loadInvoice()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition cursor-pointer"
            >
              <RefreshCw size={13} /> Try Again
            </button>
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0A0A0A] border border-[#E8D399] hover:bg-amber-50 rounded-lg transition cursor-pointer"
            >
              <ArrowLeft size={13} /> Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  const invoiceItems = (Array.isArray(invoice.items) ? invoice.items : [])
    .map((item: Record<string, unknown>) => normalizeStructuredOrderItem(item))
  const subtotal = invoiceItems.reduce((sum: number, item: ReturnType<typeof normalizeStructuredOrderItem>) => sum + item.line_total, 0)

  const downloadPdf = async () => {
    if (!invoiceElementRef.current) return
    const file = await invoicePdfFileFromElement(invoiceElementRef.current, invoice.invoice_no)
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const shareViaWhatsApp = async () => {
    const items = invoiceItems.map((item: ReturnType<typeof normalizeStructuredOrderItem>) => ({
      name: item.name,
      qty: item.quantity,
      unit: item.unit,
      unitType: item.unit_type,
      rate: item.base_price,
      lineTotal: item.line_total,
    }))
    const message = buildProfessionalWhatsAppMessage({
      customerName: invoice.customer_name,
      phone: invoice.phone,
      invoiceNumber: invoice.invoice_no,
      invoiceDate: invoice.created_at,
      items,
      subtotal,
      couponDiscount: invoice.discount_amount,
      manualDiscountAmount: invoice.manual_discount_amount,
      shipping: invoice.delivery_charge,
      gstAmount: invoice.total_gst || invoice.gst_amount || 0,
      total: invoice.total,
      paymentMode: invoice.payment_mode || invoice.payment_method,
    })

    const file = invoiceElementRef.current
      ? await invoicePdfFileFromElement(invoiceElementRef.current, invoice.invoice_no)
      : invoicePdfFile({
          invoiceNo: invoice.invoice_no,
          date: invoice.created_at,
          customerName: invoice.customer_name,
          phone: invoice.phone,
          address: invoice.address,
          items: invoiceItems as unknown as Array<Record<string, unknown>>,
          subtotal,
          shipping: Number(invoice.delivery_charge || 0),
          total: Number(invoice.total || 0),
          discountAmount: Number(invoice.discount_amount || 0),
          manualDiscountAmount: Number(invoice.manual_discount_amount || 0),
          gstAmount: Number(invoice.total_gst || invoice.gst_amount || 0),
          couponCode: invoice.coupon_code || undefined,
          paymentMode: invoice.payment_mode || invoice.payment_method || undefined,
        })

    let downloadLink = ''
    try {
      downloadLink = await uploadInvoicePdf(file, invoice.invoice_no)
    } catch (err) {
      console.warn('Failed to upload invoice PDF:', err)
    }

    const whatsappMessage = downloadLink
      ? `${message}\n\n📄 Download Invoice: ${downloadLink}`
      : `${message}\n\nThe PDF was downloaded. Please attach it in this chat before sending.`

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Invoice ${invoice.invoice_no}`, text: whatsappMessage })
        return
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError') {
          return
        }
      }
    }

    const downloadUrl = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    window.location.href = toWhatsAppUrl(invoice.phone, whatsappMessage)
  }

  const printReceipt = () => {
    const subtotalCalc = invoice.total - (invoice.delivery_charge || 0) + (invoice.discount_amount || 0)
    printThermalReceipt({
      invoiceNo: invoice.invoice_no,
      date: invoice.created_at,
      customerName: invoice.customer_name,
      phone: invoice.phone,
      items: (invoice.items || []).map((item: Record<string, unknown>) => ({
        name: String(item.name || item.product_name || 'Item'),
        qty: Number(item.qty || item.quantity || 1),
        unit: String(item.unit || 'piece'),
        price: Number(item.price || item.base_price || 0),
        line_total: Number(item.line_total || 0),
      })),
      subtotal: subtotalCalc,
      shipping: invoice.delivery_charge || 0,
      couponDiscount: invoice.discount_amount || 0,
      totalGst: invoice.total_gst || invoice.gst_amount || 0,
      total:
        invoice.total > 0
          ? invoice.total
          : subtotalCalc +
            (invoice.delivery_charge || 0) +
            (invoice.total_gst || invoice.gst_amount || 0) -
            (invoice.discount_amount || 0) -
            (invoice.manual_discount_amount || 0),
    })
  }

  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-[#f9faf6] font-sans pb-12 print:bg-white print:pb-0 print:h-auto print:min-h-0 print:overflow-visible print:m-0 print:p-0">
      {/* Top action bar */}
      <div className="bg-[#f9faf6]/95 backdrop-blur-md p-4 sticky top-0 z-50 print:hidden flex items-center justify-between max-w-4xl mx-auto pt-[calc(env(safe-area-inset-top)+0.75rem)] border-b border-[#E8D399]/30">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-[#0A0A0A] hover:text-[#D4AF37] font-semibold text-sm transition-colors bg-white border border-[#E8D399] px-4 py-2 rounded-full shadow-sm cursor-pointer min-h-[44px]"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadPdf}
            className="flex items-center gap-2 bg-[#0A0A0A] text-[#D4AF37] border border-[#D4AF37] px-4 sm:px-5 py-2 rounded-full font-bold text-xs sm:text-sm shadow-md hover:bg-[#1A1A1A] transition-colors cursor-pointer min-h-[44px]"
          >
            <Printer size={15} /> PDF Invoice
          </button>
          <button
            onClick={shareViaWhatsApp}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 sm:px-5 py-2 rounded-full font-bold text-xs sm:text-sm shadow-md hover:bg-emerald-700 transition-colors cursor-pointer min-h-[44px]"
          >
            <MessageCircle size={15} /> WhatsApp
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-4 print:mt-0 print:mb-0 print:p-0 print:px-0 print:max-w-full px-2 sm:px-0">
        <div
          ref={invoiceElementRef}
          className="bg-white shadow-xl rounded-2xl overflow-hidden print:shadow-none print:rounded-none border border-sand/20 print:border-none print:m-0 print:p-0 print:overflow-visible print:h-auto print:min-h-0"
        >
          <Invoice
            invoiceNo={invoice.invoice_no}
            date={invoice.created_at}
            customerName={invoice.customer_name}
            phone={invoice.phone}
            address={invoice.address}
            items={invoice.items || []}
            subtotal={subtotal}
            shipping={invoice.delivery_charge || 0}
            discountAmount={invoice.discount_amount || 0}
            manualDiscountAmount={invoice.manual_discount_amount || 0}
            gstAmount={invoice.total_gst || invoice.gst_amount || 0}
            couponCode={invoice.coupon_code}
            total={
              invoice.total > 0
                ? invoice.total
                : subtotal +
                  (invoice.delivery_charge || 0) +
                  (invoice.total_gst || invoice.gst_amount || 0) -
                  (invoice.discount_amount || 0) -
                  (invoice.manual_discount_amount || 0)
            }
            status={invoice.status}
            paymentMode={invoice.payment_mode || invoice.payment_method}
            onPrintReceipt={printReceipt}
          />
        </div>
      </div>
    </div>
  )
}
