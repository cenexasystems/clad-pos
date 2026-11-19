import React, { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { BRAND_ADDRESS, BRAND_EN, BRAND_PRIMARY_PHONE_DISPLAY, BRAND_ICON } from '../../lib/brand'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { formatPhone } from '../../lib/phone'
import { isExchange, refundMethodText, type OrderReturn } from '../../lib/returns'

const th: React.CSSProperties = { padding: '8px 6px', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8 }

/** The return (credit note) invoice shown next to the original bill. */
type BillInfo = { subtotal: number; coupon_code: string | null; discount_amount: number; manual_discount_amount: number; total_gst: number; delivery_charge: number; total: number }
const num = (v: unknown) => Number(v) || 0

export const ReturnInvoice: React.FC<{ ret: OrderReturn }> = ({ ret }) => {
  const exchange = isExchange(ret)
  const [bills, setBills] = useState<Record<string, BillInfo>>({})
  // coupon / discount details live on the bills themselves: the original bill and (for exchanges) the new one
  useEffect(() => {
    const ids = [ret.order_id, ret.exchange_order_id].filter(Boolean) as string[]
    if (!isSupabaseConfigured || ids.length === 0) return
    let live = true
    void supabase.from('orders').select('id, subtotal, coupon_code, discount_amount, manual_discount_amount, total_gst, delivery_charge, total').in('id', ids).then(({ data }) => {
      if (!live || !data) return
      const map: Record<string, BillInfo> = {}
      for (const r of data as Record<string, unknown>[]) {
        map[String(r.id)] = {
          subtotal: num(r.subtotal), coupon_code: r.coupon_code ? String(r.coupon_code) : null, discount_amount: num(r.discount_amount),
          manual_discount_amount: num(r.manual_discount_amount), total_gst: num(r.total_gst), delivery_charge: num(r.delivery_charge), total: num(r.total),
        }
      }
      setBills(map)
    })
    return () => { live = false }
  }, [ret.order_id, ret.exchange_order_id])
  const original = bills[ret.order_id]
  const fresh = ret.exchange_order_id ? bills[ret.exchange_order_id] : undefined
  const pay = Math.max(0, ret.exchange_total - ret.credit_applied)
  const back = Math.max(0, ret.refund_total - ret.credit_applied)
  const dateStr = new Date(ret.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="w-full max-w-[680px] mx-auto bg-white text-[#111111] box-border p-4 sm:p-8" style={{ fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src={BRAND_ICON} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{BRAND_EN}</div>
            <div style={{ fontSize: 10, color: '#777', maxWidth: 260 }}>{BRAND_ADDRESS}</div>
            <div style={{ fontSize: 10, color: '#777' }}>Phone: {BRAND_PRIMARY_PHONE_DISPLAY}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: '#FEE2E2', color: '#B91C1C', fontSize: 10, fontWeight: 900, letterSpacing: 1 }}>{exchange ? 'EXCHANGE CREDIT NOTE' : 'RETURN INVOICE'}</div>
          <div style={{ fontSize: 14, fontWeight: 900, marginTop: 6 }}>{ret.return_no}</div>
          <div style={{ fontSize: 10, color: '#777' }}>Original bill: {formatInvoiceNo(ret.invoice_no)}</div>
          <div style={{ fontSize: 10, color: '#777' }}>Date: {dateStr}</div>
        </div>
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-light)', marginBottom: 18 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Customer</div>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{ret.customer_name || 'Walk-in Customer'}</div>
        <div style={{ fontSize: 12, color: '#555' }}>{formatPhone(ret.phone)}</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr style={{ background: '#0A0A0A' }}>
              <th style={{ ...th, textAlign: 'left', width: 28 }}>#</th>
              <th style={{ ...th, textAlign: 'left' }}>Returned item</th>
              <th style={{ ...th, textAlign: 'center', width: 50 }}>Qty</th>
              <th style={{ ...th, textAlign: 'right', width: 72 }}>Rate</th>
              <th style={{ ...th, textAlign: 'right', width: 86 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {ret.items.map((line, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 6px', fontSize: 11, color: '#999', verticalAlign: 'top' }}>{i + 1}</td>
                <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{line.name}</div>
                  <div style={{ fontSize: 10, color: line.restocked ? '#047857' : '#6b7280', marginTop: 2 }}>
                    {line.is_manual ? 'Manual item' : line.restocked ? 'Added back to stock' : 'Not added to stock'}
                  </div>
                </td>
                <td style={{ padding: '8px 6px', fontSize: 12, fontWeight: 600, textAlign: 'center', verticalAlign: 'top' }}>{line.quantity}</td>
                <td style={{ padding: '8px 6px', fontSize: 12, textAlign: 'right', color: '#555', verticalAlign: 'top' }}>{formatCurrency(line.unit_price)}</td>
                <td style={{ padding: '8px 6px', fontSize: 13, fontWeight: 800, textAlign: 'right', verticalAlign: 'top' }}>{formatCurrency(line.base_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, borderTop: '2px solid var(--accent)', paddingTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: '100%', maxWidth: 300 }}>
          <Row label="Returned items" value={formatCurrency(ret.items_total)} />
          {ret.discount_share > 0 && original && original.discount_amount > 0 && original.coupon_code && (
            <Row label={`Coupon ${original.coupon_code} (on original bill)`} value={`−${formatCurrency(original.discount_amount)}`} color="var(--accent-dark)" />
          )}
          {ret.discount_share > 0 && <Row label="Less: bill discount share" value={`−${formatCurrency(ret.discount_share)}`} color="var(--accent-dark)" />}
          {ret.gst_share > 0 && <Row label="Add: GST share" value={`+${formatCurrency(ret.gst_share)}`} />}
          {ret.adj_coupon_discount > 0 && <Row label={`Less: coupon${ret.adj_coupon_code ? ` ${ret.adj_coupon_code}` : ''}`} value={`−${formatCurrency(ret.adj_coupon_discount)}`} color="var(--accent-dark)" />}
          {ret.adj_manual_discount > 0 && <Row label="Less: discount" value={`−${formatCurrency(ret.adj_manual_discount)}`} color="var(--accent-dark)" />}
          {ret.adj_gst > 0 && <Row label="Add: GST" value={`+${formatCurrency(ret.adj_gst)}`} />}
          {ret.adj_delivery > 0 && <Row label="Less: delivery" value={`−${formatCurrency(ret.adj_delivery)}`} color="var(--accent-dark)" />}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 13, fontWeight: 900 }}>{exchange ? 'CREDIT FROM RETURNED ITEMS' : 'REFUND TOTAL'}</span>
            <span style={{ fontSize: 17, fontWeight: 900, color: '#B91C1C' }}>{formatCurrency(ret.refund_total)}</span>
          </div>
          {ret.delivery_charge_kept > 0 && (
            <div style={{ fontSize: 10, color: '#B45309', marginTop: 6, textAlign: 'right' }}>Delivery charge {formatCurrency(ret.delivery_charge_kept)} is not refunded.</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 11, color: '#555', lineHeight: 1.6 }}>
        {exchange && (
          <div style={{ margin: '4px 0 8px', padding: '10px 12px', borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent-light)' }}>
            <div><b>Exchanged for new bill:</b> {ret.exchange_invoice_no ? formatInvoiceNo(ret.exchange_invoice_no) : '(bill)'} worth {formatCurrency(ret.exchange_total)}</div>
            <div><b>Credit used against the new bill:</b> {formatCurrency(ret.credit_applied)}</div>
            {fresh && (
              <div style={{ margin: '6px 0', paddingTop: 6, borderTop: '1px dashed var(--accent-light)' }}>
                <Row label="New items" value={formatCurrency(fresh.subtotal)} />
                {fresh.discount_amount > 0 && <Row label={`Coupon${fresh.coupon_code ? ` ${fresh.coupon_code}` : ''}`} value={`−${formatCurrency(fresh.discount_amount)}`} color="var(--accent-dark)" />}
                {fresh.manual_discount_amount > 0 && <Row label="Discount" value={`−${formatCurrency(fresh.manual_discount_amount)}`} color="var(--accent-dark)" />}
                {fresh.total_gst > 0 && <Row label="GST" value={`+${formatCurrency(fresh.total_gst)}`} />}
                {fresh.delivery_charge > 0 && <Row label="Delivery" value={`+${formatCurrency(fresh.delivery_charge)}`} />}
              </div>
            )}
            {pay > 0 && <div><b>Customer paid the difference:</b> {formatCurrency(pay)} (shown on the new bill)</div>}
            {back > 0 && <div><b>Paid back to the customer:</b> {formatCurrency(back)}</div>}
            {pay <= 0 && back <= 0 && <div><b>Even exchange:</b> no money changed hands.</div>}
          </div>
        )}
        <div><b>{exchange ? 'Settled as' : 'Refunded as'}:</b> {refundMethodText(ret)}</div>
        {ret.reason && <div><b>Reason:</b> {ret.reason}</div>}
        {ret.confirmed_by && <div><b>Approved by:</b> {ret.confirmed_by}</div>}
      </div>
      <div style={{ marginTop: 18, textAlign: 'center', fontSize: 10, color: '#999' }}>This is a credit note for the original bill {formatInvoiceNo(ret.invoice_no)}{exchange ? ' and records an exchange' : ''}.</div>
    </div>
  )
}

const Row: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
    <span style={{ fontSize: 12, color: color || '#666' }}>{label}</span>
    <span style={{ fontSize: 12, fontWeight: 700, color: color || '#111' }}>{value}</span>
  </div>
)
