import React from 'react'

interface StickerFooterProps {
  /** Left side text (item name). Empty hides it. */
  name?: string
  /** Right side price. null hides it. */
  price: number | null
  /** Preview card height in px, used to scale the text */
  heightPx: number
}

/**
 * On-screen preview of the printed sticker footer: a black rule, then the
 * item name on the left and the price on the right. Keep in sync with the
 * `.footer` markup in CreateBarcodeModal's print template.
 */
export const StickerFooter: React.FC<StickerFooterProps> = ({ name, price, heightPx }) => {
  if (!name && price === null) return null

  return (
    <div
      className="w-full flex items-center justify-between gap-1 border-t border-black leading-none shrink-0"
      style={{ paddingTop: '2px' }}
    >
      <span
        className="min-w-0 flex-1 truncate text-left font-black text-black"
        style={{ fontSize: `${Math.max(7, Math.round(heightPx * 0.075))}px` }}
      >
        {name || ''}
      </span>
      {price !== null && (
        <span
          className="shrink-0 font-black text-black"
          style={{ fontSize: `${Math.max(8.5, Math.round(heightPx * 0.1))}px` }}
        >
          ₹{price}
        </span>
      )}
    </div>
  )
}
