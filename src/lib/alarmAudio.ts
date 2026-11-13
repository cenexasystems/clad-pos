/**
 * Synthesized Web Audio API Alarm Sound Manager
 * Provides reliable, zero-latency, cross-platform audio alerts for retail environments.
 * Specifically optimized for iOS Safari, mobile Chrome/Android, and mobile WebViews with:
 * - Resilient user-gesture unlocking
 * - iOS silent-buffer audio pipeline warmup (required by iOS WebKit)
 * - Autoplay block detection and reactive state subscription
 * - Dual-engine fallback via synthesized in-memory WAV chime
 */

function createBeepWavDataUri(freq: number = 880, durationMs: number = 220): string {
  if (typeof window === 'undefined') return ''
  try {
    const sampleRate = 8000
    const numSamples = Math.floor((sampleRate * durationMs) / 1000)
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)

    // RIFF identifier
    view.setUint32(0, 0x52494646, false) // 'RIFF'
    view.setUint32(4, 36 + numSamples * 2, true)
    view.setUint32(8, 0x57415645, false) // 'WAVE'
    view.setUint32(12, 0x666d7420, false) // 'fmt '
    view.setUint32(16, 16, true) // Subchunk1Size
    view.setUint16(20, 1, true) // PCM format
    view.setUint16(22, 1, true) // 1 channel mono
    view.setUint32(24, sampleRate, true) // SampleRate
    view.setUint32(28, sampleRate * 2, true) // ByteRate
    view.setUint16(32, 2, true) // BlockAlign
    view.setUint16(34, 16, true) // BitsPerSample
    view.setUint32(36, 0x64617461, false) // 'data'
    view.setUint32(40, numSamples * 2, true)

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate
      const envelope = Math.max(0, 1 - i / numSamples)
      const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.75 * 32767
      view.setInt16(44 + i * 2, Math.floor(sample), true)
    }

    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return 'data:audio/wav;base64,' + btoa(binary)
  } catch {
    return ''
  }
}

class AlarmSoundManager {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private intervalId: number | null = null
  private isAlarmPlaying: boolean = false
  private activeOscillators: OscillatorNode[] = []
  private fallbackAudio: HTMLAudioElement | null = null
  private subscribers: Set<() => void> = new Set()
  private listenersAttached: boolean = false

  constructor() {
    this.attachGlobalListeners()
  }

  /**
   * Subscribe to audio state changes (e.g. when context is resumed or suspended)
   */
  public subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  private notify() {
    this.subscribers.forEach((cb) => {
      try {
        cb()
      } catch {
        // ignore subscriber errors
      }
    })
  }

  /**
   * Check if the alarm is triggered but audio is currently blocked/suspended by browser policies (e.g. iOS Safari)
   */
  public isBlocked(): boolean {
    if (!this.isAlarmPlaying) return false
    if (!this.ctx) return true
    return this.ctx.state !== 'running'
  }

  public isPlaying(): boolean {
    return this.isAlarmPlaying
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          this.ctx = new AudioCtx()
          this.ctx.onstatechange = () => {
            this.notify()
          }
        }
      } catch {
        return null
      }
    }
    if (this.ctx && !this.masterGain) {
      try {
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.setValueAtTime(1, this.ctx.currentTime)
        this.masterGain.connect(this.ctx.destination)
      } catch {
        // ignore
      }
    }
    return this.ctx
  }

  /**
   * Explicitly unlock audio context on a user gesture (touch/click/key)
   * Plays a silent buffer required by iOS Safari to wake the audio hardware.
   */
  public unlock = async (): Promise<boolean> => {
    try {
      const ctx = this.getContext()
      if (ctx) {
        if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
          await ctx.resume().catch(() => {})
        }

        // iOS Safari silent buffer warmup: required to connect Web Audio pipeline to speakers
        if (ctx.state === 'running') {
          try {
            const buffer = ctx.createBuffer(1, 1, 22050)
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(ctx.destination)
            source.start(0)
          } catch {
            // ignore
          }
        }
      }

      // Pre-warm fallback HTML5 audio for iOS
      this.warmupFallbackAudio()

      this.notify()

      // If alarm is already flagged to play, immediately output sound on this gesture
      if (this.isAlarmPlaying) {
        this.playBeep()
      }

      return this.ctx?.state === 'running'
    } catch {
      return false
    }
  }

  private warmupFallbackAudio() {
    if (typeof window === 'undefined') return
    if (!this.fallbackAudio) {
      const uri = createBeepWavDataUri(880, 180)
      if (uri) {
        this.fallbackAudio = new Audio(uri)
        this.fallbackAudio.volume = 1.0
      }
    }
  }

  private playFallbackBeep() {
    this.warmupFallbackAudio()
    if (!this.fallbackAudio) return
    try {
      this.fallbackAudio.currentTime = 0
      const promise = this.fallbackAudio.play()
      if (promise && typeof promise.then === 'function') {
        promise.catch(() => {})
      }
    } catch {
      // ignore
    }
  }

  private attachGlobalListeners() {
    if (typeof window === 'undefined' || this.listenersAttached) return
    this.listenersAttached = true

    const handleGesture = () => {
      // If audio is not yet running or an alarm is active, trigger unlock
      if (!this.ctx || this.ctx.state !== 'running' || this.isAlarmPlaying) {
        void this.unlock()
      }
    }

    const events = ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown']
    events.forEach((evt) => {
      window.addEventListener(evt, handleGesture, { passive: true })
    })

    // Handle mobile tab switching / phone screen wake-up
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.isAlarmPlaying) {
          void this.unlock()
        }
      }
    })

    window.addEventListener('pageshow', () => {
      if (this.isAlarmPlaying) {
        void this.unlock()
      }
    })
  }

  // Dual-tone urgent alert pulse (A5 880 Hz -> E5 660 Hz)
  private playBeep() {
    if (!this.isAlarmPlaying) return
    const ctx = this.getContext()

    // If context is still suspended, attempt resume and trigger fallback audio
    if (!ctx || ctx.state !== 'running') {
      if (ctx && ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => {
            this.notify()
            if (this.isAlarmPlaying && ctx.state === 'running') {
              this.playBeep()
            }
          })
          .catch(() => {})
      }
      // Attempt HTML5 fallback chime on iOS / mobile
      this.playFallbackBeep()
      this.notify()
      return
    }

    if (!this.masterGain) return

    try {
      const now = ctx.currentTime

      // Double-pulse urgent beep: Pulse 1 at now, Pulse 2 at now + 0.18s
      const scheduleTone = (timeOffset: number, f1: number, f2: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(f1, now + timeOffset)
        osc.frequency.setValueAtTime(f2, now + timeOffset + 0.08)

        gain.gain.setValueAtTime(0.35, now + timeOffset)
        gain.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + 0.16)

        osc.connect(gain)
        if (this.masterGain) {
          gain.connect(this.masterGain)
        }

        this.activeOscillators.push(osc)
        osc.onended = () => {
          const idx = this.activeOscillators.indexOf(osc)
          if (idx !== -1) this.activeOscillators.splice(idx, 1)
        }

        osc.start(now + timeOffset)
        osc.stop(now + timeOffset + 0.17)
      }

      // First beep pulse (880Hz -> 660Hz)
      scheduleTone(0, 880, 660)
      // Second beep pulse (880Hz -> 660Hz)
      scheduleTone(0.18, 880, 660)

      this.notify()
    } catch {
      // If Web Audio fails during scheduling, try fallback
      this.playFallbackBeep()
    }
  }

  /** Settings > Stock alerts: when false, startAlert() stays silent (the Test sound button passes force). */
  public allowed = true

  public startAlert(force = false) {
    if (!this.allowed && !force) return
    if (this.isAlarmPlaying) return
    this.stopAlert() // Clear any existing intervals / state

    this.isAlarmPlaying = true
    const ctx = this.getContext()
    if (ctx) {
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        ctx.resume().catch(() => {})
      }
      if (this.masterGain) {
        try {
          this.masterGain.gain.setValueAtTime(1, ctx.currentTime)
        } catch {
          // ignore
        }
      }
    }

    // Attempt initial beep
    this.playBeep()

    // Repeat alert pulse every 1.4 seconds until silenced
    this.intervalId = window.setInterval(() => {
      if (this.isAlarmPlaying) {
        this.playBeep()
      } else if (this.intervalId) {
        clearInterval(this.intervalId)
        this.intervalId = null
      }
    }, 1400)

    this.notify()
  }

  public stopAlert() {
    this.isAlarmPlaying = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    // Immediately silence master gain
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime)
      } catch {
        // ignore
      }
    }

    // Stop and disconnect any currently sounding oscillators
    for (const osc of this.activeOscillators) {
      try {
        osc.stop()
        osc.disconnect()
      } catch {
        // ignore
      }
    }
    this.activeOscillators = []

    // Silence fallback audio if currently playing
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.pause()
        this.fallbackAudio.currentTime = 0
      } catch {
        // ignore
      }
    }

    this.notify()
  }
}

export const alarmSound = new AlarmSoundManager()
