import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, X, AlertCircle, Sparkles, ScanLine, SwitchCamera } from 'lucide-react'
import { BrowserMultiFormatReader, BarcodeFormat, type IScannerControls } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { barcodeService } from '../../services/barcodeService'
import { BRAND_EN } from '../../lib/brand'
import { normalizeBarcode } from '../../lib/barcode'

// Only decode what we print (CODE128 labels) plus retail EAN/UPC codes.
// All of these carry a checksum. With every format enabled the camera was slow
// and returned short "ghost" reads (e.g. "60892") from formats like Code 39 / ITF.
const CAMERA_SCAN_HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E],
  ],
  [DecodeHintType.TRY_HARDER, true],
])

// The library default waits 500 ms between frames, which made scanning feel stuck.
const CAMERA_SCAN_OPTIONS = { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 150 }

// Ask for a Full HD back-camera stream; the default is often 640x480, too blurry for the thin bars on 35 mm labels.
const buildCameraConstraints = (deviceId: string): MediaStreamConstraints => ({
  audio: false,
  video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
})

export interface ScannedItemPayload {
  product_id: number
  variant_id?: string | null
  product_name: string
  name_ta?: string
  variant_name?: string
  price: number
  offer_price?: number
  stock: number
  barcode: string
  unit?: string
  image_url?: string
  category?: string
}

export interface BarcodeScannerInputProps {
  onItemScanned: (item: ScannedItemPayload) => void
  disabled?: boolean
  /**
   * Listen for USB/Bluetooth scanner keystrokes. Turn this off when a page-level
   * listener (useHardwareBarcodeScanner in Dashboard) already handles them,
   * otherwise every scan is processed twice and the item gets +2 qty.
   */
  listenForHardwareScanner?: boolean
}

export const BarcodeScannerInput: React.FC<BarcodeScannerInputProps> = ({
  onItemScanned,
  disabled = false,
  listenForHardwareScanner = true,
}) => {
  const [manualCode, setManualCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScannedName, setLastScannedName] = useState('')

  // Camera scanner state
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const activeStreamRef = useRef<MediaStream | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Explicit camera stop helper ensuring ALL camera hardware resources & tracks are released
  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop()
      } catch (e) {
        console.warn('Could not stop ZXing scanner controls:', e)
      }
      controlsRef.current = null
    }

    if (activeStreamRef.current) {
      try {
        activeStreamRef.current.getTracks().forEach((track) => {
          track.stop()
          track.enabled = false
        })
      } catch (e) {
        console.warn('Could not stop active stream tracks:', e)
      }
      activeStreamRef.current = null
    }

    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((track) => {
          track.stop()
          track.enabled = false
        })
        videoRef.current.srcObject = null
      } catch (e) {
        console.warn('Could not stop video element stream:', e)
      }
    }

    if (readerRef.current) {
      readerRef.current = null
    }
  }, [])

  const handleCloseCamera = useCallback(() => {
    stopCamera()
    setIsCameraOpen(false)
  }, [stopCamera])

  // Hardware Scanner buffer (tracking keystroke timing)
  const bufferRef = useRef<{ code: string; lastTime: number; targetInput: HTMLInputElement | HTMLTextAreaElement | null }>({
    code: '',
    lastTime: 0,
    targetInput: null,
  })

  // Audio Beep generator via Web Audio API
  const playBeep = (isSuccess = true) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = isSuccess ? 'sine' : 'square'
      osc.frequency.setValueAtTime(isSuccess ? 1800 : 300, ctx.currentTime)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (isSuccess ? 0.08 : 0.25))

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + (isSuccess ? 0.08 : 0.25))
    } catch {
      // Audio context might be restricted before first user interaction
    }
  }

  // Handle scanned barcode lookup
  const processBarcode = useCallback(async (barcodeVal: string) => {
    const clean = normalizeBarcode(barcodeVal)
    if (!clean) return

    setLoading(true)
    setErrorMsg('')

    try {
      const record = await barcodeService.lookupBarcode(clean)

      if (!record || !record.product) {
        playBeep(false)
        setErrorMsg(`Barcode "${clean}" not recognized in ${BRAND_EN} catalog`)
        return
      }

      const prod = record.product
      const varnt = record.variant

      const effectiveStock = varnt ? (Number(varnt.stock) || 0) : 999

      const price = varnt?.price ? Number(varnt.price) : Number(prod.price)

      const payload: ScannedItemPayload = {
        product_id: record.product_id,
        variant_id: record.variant_id || null,
        product_name: prod.name,
        name_ta: prod.name_ta,
        variant_name: varnt?.variant_name,
        price: price,
        offer_price: record.variant_id ? undefined : (prod.offer_price ? Number(prod.offer_price) : undefined),
        stock: effectiveStock,
        barcode: clean,
        image_url: prod.image_url,
        category: prod.category,
      }

      playBeep(true)
      setLastScannedName(`${prod.name}${varnt?.variant_name ? ` (${varnt.variant_name})` : ''}`)
      onItemScanned(payload)
      setManualCode('')

      setTimeout(() => setLastScannedName(''), 3500)
    } catch (err) {
      console.error('Barcode lookup failed:', err)
      playBeep(false)
      setErrorMsg((err as Error).message || 'Failed to scan barcode')
    } finally {
      setLoading(false)
    }
  }, [onItemScanned])

  // Latest processBarcode, read by the camera loop so parent re-renders don't restart the camera
  const processBarcodeRef = useRef(processBarcode)
  useEffect(() => {
    processBarcodeRef.current = processBarcode
  }, [processBarcode])

  // Non-Blocking HID Keystroke Interceptor
  useEffect(() => {
    if (!listenForHardwareScanner) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now()
      const diff = now - bufferRef.current.lastTime
      const target = e.target as HTMLElement
      const isInputField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (e.key === 'Enter') {
        const buffered = bufferRef.current.code
        // If rapid keystrokes (< 45ms average) accumulated >= 4 characters
        if (buffered.length >= 4 && diff < 150) {
          e.preventDefault()
          e.stopPropagation()

          // If the cashier was focused in an input field, strip the injected barcode text from that field
          if (isInputField && bufferRef.current.targetInput) {
            const inputEl = bufferRef.current.targetInput
            if (inputEl.value && inputEl.value.endsWith(buffered)) {
              inputEl.value = inputEl.value.slice(0, -buffered.length)
              // Dispatch input event so React state updates
              inputEl.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }

          bufferRef.current = { code: '', lastTime: 0, targetInput: null }
          void processBarcode(buffered)
          return
        }

        bufferRef.current = { code: '', lastTime: 0, targetInput: null }
        return
      }

      // Printable single character
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (diff > 45) {
          // Slow typing cadence (human typing): start fresh buffer
          bufferRef.current = {
            code: e.key,
            lastTime: now,
            targetInput: isInputField ? (target as HTMLInputElement | HTMLTextAreaElement) : null,
          }
        } else {
          // Rapid typing cadence (< 45ms): hardware barcode scanner burst
          bufferRef.current.code += e.key
          bufferRef.current.lastTime = now
          if (isInputField) {
            bufferRef.current.targetInput = target as HTMLInputElement | HTMLTextAreaElement
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [processBarcode, listenForHardwareScanner])

  // Touch Device Detection Helper
  const isTouchDevice = () => {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  // Handle Input Bar Click on Touch Devices
  const handleInputBarClick = () => {
    if (isTouchDevice()) {
      setIsCameraOpen(true)
    }
  }

  // Camera scanner lifecycle & decoding
  useEffect(() => {
    if (!isCameraOpen) {
      stopCamera()
      return
    }

    const videoElement = videoRef.current
    if (!videoElement) return

    let isMounted = true
    let lastRead = ''
    const reader = new BrowserMultiFormatReader(CAMERA_SCAN_HINTS, CAMERA_SCAN_OPTIONS)
    readerRef.current = reader

    // Enumerate devices for the camera picker only. We no longer auto-select a device here:
    // doing so changed selectedDeviceId and restarted the camera right after it opened.
    BrowserMultiFormatReader.listVideoInputDevices()
      .then((devices) => {
        if (isMounted) setVideoDevices(devices)
      })
      .catch((err) => {
        console.warn('Could not enumerate cameras:', err)
      })

    const decodePromise = reader.decodeFromConstraints(
      buildCameraConstraints(selectedDeviceId),
      videoElement,
      (result) => {
        if (!isMounted || !result) return
        const text = normalizeBarcode(result.getText())
        if (!text) return

        // Accept a code only after two matching reads in a row, so a single misread never reaches the cart
        if (text !== lastRead) {
          lastRead = text
          return
        }

        isMounted = false
        stopCamera()
        setIsCameraOpen(false)
        void processBarcodeRef.current(text)
      }
    )

    decodePromise
      .then((controls) => {
        if (!isMounted) {
          controls.stop()
        } else {
          controlsRef.current = controls
          if (videoElement.srcObject) {
            activeStreamRef.current = videoElement.srcObject as MediaStream
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('Camera barcode reader error:', err)
        setErrorMsg('Camera access denied or unavailable')
      })

    return () => {
      isMounted = false
      stopCamera()
    }
  }, [isCameraOpen, selectedDeviceId, stopCamera])

  // Listen for Escape key to close camera
  useEffect(() => {
    if (!isCameraOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseCamera()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCameraOpen, handleCloseCamera])

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-2">
        {/* Scanner Search Box */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (manualCode.trim()) void processBarcode(manualCode.trim())
          }}
          className="relative flex-1 flex items-center"
        >
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#D4AF37] flex items-center pointer-events-none">
            <ScanLine size={18} />
          </div>

          <input
            ref={inputRef}
            type="text"
            placeholder="Scan barcode with machine, camera, or type code..."
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            disabled={disabled || loading}
            className={`w-full pl-10 ${manualCode ? 'pr-24' : 'pr-12'} py-2.5 sm:py-3 rounded-2xl border-2 border-[#E8D399] bg-[#FBFAF6] font-medium text-xs sm:text-xs text-black placeholder:text-gray-400 placeholder:font-normal outline-none focus:border-[#0A0A0A] focus:bg-white shadow-xs transition-all`}
          />

          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {manualCode && (
              <button
                type="submit"
                disabled={loading}
                className="px-3 py-1.5 rounded-xl bg-[#0A0A0A] text-[#D4AF37] text-xs font-black hover:bg-[#1A1A1A] cursor-pointer"
              >
                {loading ? '...' : 'Add'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsCameraOpen(true)}
              title="Scan with Camera"
              className="p-2 rounded-xl bg-white border border-[#E8D399] text-gray-700 hover:text-black hover:border-black transition-all cursor-pointer shadow-xs"
            >
              <Camera size={16} />
            </button>
          </div>
        </form>
      </div>

      {/* Success Notification Pill */}
      {lastScannedName && (
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1 rounded-full animate-in fade-in duration-150">
          <Sparkles size={13} className="text-emerald-600" />
          Added: <span className="font-black text-black">{lastScannedName}</span> (+1 qty)
        </div>
      )}

      {/* Error Notification Pill */}
      {errorMsg && (
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-800 bg-rose-50 border border-rose-300 px-3 py-1 rounded-full animate-in fade-in duration-150">
          <AlertCircle size={13} className="text-rose-600" />
          {errorMsg}
        </div>
      )}

      {/* Instant Webcam Scanner Modal */}
      {isCameraOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseCamera()
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <div className="bg-[#0A0A0A] rounded-3xl max-w-md w-full border border-[#D4AF37] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-white">
            <div className="px-5 py-4 border-b border-[#D4AF37]/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-[#D4AF37]" />
                <span className="font-black text-sm text-white">Camera Barcode Scanner</span>
              </div>
              <button
                onClick={handleCloseCamera}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col items-center">
              <div className="relative w-full aspect-square max-w-[320px] rounded-2xl overflow-hidden border-2 border-[#D4AF37] bg-black">
                <video ref={videoRef} className="w-full h-full object-cover" />
                {/* Visual Laser Reticle Guide */}
                <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-red-500 shadow-[0_0_12px_red] animate-pulse" />
                <div className="absolute inset-6 border-2 border-dashed border-[#D4AF37]/60 rounded-xl pointer-events-none" />
              </div>

              {/* Camera Switcher if multiple devices */}
              {videoDevices.length > 1 && (
                <div className="mt-3 flex items-center gap-2 w-full max-w-[320px]">
                  <SwitchCamera size={15} className="text-[#D4AF37] shrink-0" />
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-gray-700 text-xs font-bold text-white rounded-lg px-2 py-1.5 outline-none focus:border-[#D4AF37]"
                  >
                    <option value="">Back camera (auto)</option>
                    {videoDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-xs text-[#D4AF37] mt-3 text-center font-bold">
                Align the red line with the barcode sticker on the product
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
