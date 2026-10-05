/**
 * Звуки — синтез на Web Audio, без единого файла: мягкая «лифтовая» музыка и очень мясные удары.
 * Громкость и стерео зависят от того, где звук относительно своего игрока.
 */

export type SoundName =
  | 'swing' | 'swingHeavy' | 'staple' | 'money'
  | 'hitCut' | 'hitStaple' | 'hitBroom' | 'hitLamp' | 'hitMoney'
  | 'death' | 'headBounce' | 'dodge' | 'pickup' | 'coffee' | 'respawn' | 'kill' | 'win' | 'empty' | 'party'

class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private listener = { x: 0, z: 0 }
  private musicTimer = 0
  private musicStep = 0
  muted = false

  /** Браузер разрешает звук только после действия пользователя */
  unlock(): void {
    // iPhone: без этого Web Audio молчит, когда на телефоне включён беззвучный режим
    const nav = navigator as unknown as { audioSession?: { type: string } }
    if (nav.audioSession && nav.audioSession.type !== 'playback') try { nav.audioSession.type = 'playback' } catch { /* старый Safari */ }
    if (this.ctx) {
      // iOS «приостанавливает» звук при сворачивании, звонке, блокировке — будим на каждом касании
      if (this.ctx.state !== 'running') { void this.ctx.resume(); this.blip() }
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    // лёгкий компрессор: мясо громкое, но уши целы
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(this.ctx.destination)
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = 0.16
    this.musicGain.connect(this.master)
    const n = this.ctx.sampleRate
    this.noiseBuf = this.ctx.createBuffer(1, n, n)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    void this.ctx.resume()
    this.blip()
    this.silentTag()
  }

  /** Неслышный звук внутри касания — iOS разблокирует аудио только так */
  private blip(): void {
    const ctx = this.ctx
    if (!ctx) return
    const src = ctx.createBufferSource()
    src.buffer = ctx.createBuffer(1, 1, 22050)
    src.connect(ctx.destination)
    src.start(0)
  }

  /** Тихий <audio> в цикле: переводит iPhone в режим «медиа», и звук слышно даже с выключенным рингером (старые iOS) */
  private silentTag(): void {
    if (!/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return
    const a = document.createElement('audio')
    a.setAttribute('x-webkit-airplay', 'deny')
    a.loop = true
    a.preload = 'auto'
    // 0.1 с тишины, WAV 8 кГц
    const n = 800, buf = new Uint8Array(44 + n)
    const dv = new DataView(buf.buffer)
    const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i) }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true)
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true)
    dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true)
    buf.fill(128, 44)
    a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
    void a.play().catch(() => {})
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void a.play().catch(() => {}) })
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  setListener(x: number, z: number): void { this.listener.x = x; this.listener.z = z }

  /** Звук в точке мира (или «в ушах», если точка не задана) */
  play(name: SoundName, x?: number, z?: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return
    let gain = 1, pan = 0
    if (x !== undefined && z !== undefined) {
      const dx = x - this.listener.x, dz = z - this.listener.z
      const d = Math.hypot(dx, dz)
      if (d > 28) return
      gain = 1 / (1 + d / 7)
      // камера смотрит с юго-востока: «вправо по экрану» = (1, 0, -1)
      pan = Math.max(-0.8, Math.min(0.8, ((dx - dz) * Math.SQRT1_2) / 9))
    }
    const out = ctx.createGain()
    out.gain.value = gain
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    out.connect(p).connect(this.master)
    const t = ctx.currentTime + 0.005
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    switch (name) {
      case 'swing': this.whoosh(out, t, 0.16, r(900, 1300), 0.35); break
      case 'swingHeavy': this.whoosh(out, t, 0.32, r(400, 600), 0.5); break
      case 'staple':
        this.noise(out, t, 0.03, 'highpass', 3000, 0.5)
        this.tone(out, t, 0.04, 'square', r(1700, 1900), 900, 0.12)
        this.tone(out, t + 0.02, 0.05, 'triangle', 220, 120, 0.25)
        break
      case 'money':
        for (let i = 0; i < 6; i++) this.noise(out, t + i * 0.025, 0.03, 'bandpass', r(2500, 4000), 0.25)
        this.tone(out, t, 0.08, 'triangle', 180, 90, 0.35)
        break
      case 'hitCut': this.squelch(out, t, 1); this.noise(out, t, 0.05, 'highpass', 4000, 0.2); break
      case 'hitStaple': this.squelch(out, t, 0.6); this.tone(out, t, 0.03, 'square', 2400, 2000, 0.06); break
      case 'hitBroom': this.thud(out, t, 0.7, 140); this.noise(out, t, 0.12, 'bandpass', 2200, 0.3); break
      case 'hitLamp':
        this.thud(out, t, 1.3, 90)
        this.squelch(out, t + 0.01, 1.2)
        for (let i = 0; i < 4; i++) this.tone(out, t + 0.02 + i * 0.03, 0.25, 'sine', r(2600, 4200), r(2500, 4000), 0.06)
        break
      case 'hitMoney': this.squelch(out, t, 0.4); this.noise(out, t, 0.08, 'bandpass', 3000, 0.25); break
      case 'death':
        this.squelch(out, t, 1.6)
        this.squelch(out, t + 0.07, 1.2)
        this.thud(out, t + 0.05, 1.1, 70)
        this.tone(out, t + 0.02, 0.09, 'sine', 900, 300, 0.25) // «чпок» — голова
        this.gurgle(out, t + 0.12, 1.3)
        break
      case 'party': // хлопушка с конфетти — вместо смерти в детском режиме
        this.noise(out, t, 0.08, 'highpass', 1200, 0.6)
        this.thud(out, t, 0.6, 220)
        ;[1568, 2093, 2637].forEach((f, i) => this.bell(out, t + 0.05 + i * 0.07, f, 0.18))
        break
      case 'headBounce': this.thud(out, t, 0.35, 180); break
      case 'dodge': this.whoosh(out, t, 0.22, 2000, 0.3); break
      case 'empty': this.tone(out, t, 0.04, 'square', 300, 250, 0.1); break
      case 'pickup':
        this.tone(out, t, 0.08, 'triangle', 660, 660, 0.25)
        this.tone(out, t + 0.07, 0.14, 'triangle', 990, 990, 0.25)
        break
      case 'coffee':
        this.slurp(out, t)
        this.tone(out, t + 0.28, 0.12, 'sine', 784, 784, 0.25)
        this.tone(out, t + 0.36, 0.2, 'sine', 1175, 1175, 0.25)
        break
      case 'respawn': // «дзынь» лифта
        this.bell(out, t, 1319, 0.35)
        this.bell(out, t + 0.22, 1047, 0.35)
        break
      case 'kill': // касса: премия за убийство
        this.noise(out, t, 0.05, 'bandpass', 1800, 0.4)
        this.bell(out, t + 0.06, 2093, 0.3)
        this.bell(out, t + 0.06, 2637, 0.2)
        break
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.bell(out, t + i * 0.13, f, 0.3))
        break
    }
  }

  private musicMode: 'lobby' | 'fight' = 'lobby'

  /**
   * Музыка. В лобби — мягкая лифтовая босса-нова, в бою — та же минималистичная «глухая» палитра
   * (синусы, приглушённые щипки, бочка-«тук»), но вдвое резвее: ровная бочка, пульсирующий бас шестнадцатыми.
   */
  updateMusic(dt: number, on: boolean, mode: 'lobby' | 'fight' = 'lobby'): void {
    const ctx = this.ctx
    if (!ctx || !this.musicGain || ctx.state !== 'running') return
    // в бою громче: там много своих звуков, тихую музыку не слышно
    this.musicGain.gain.setTargetAtTime(on && !this.muted ? (mode === 'fight' ? 0.3 : 0.16) : 0, ctx.currentTime, 0.4)
    if (!on) return
    if (mode !== this.musicMode) { this.musicMode = mode; this.musicStep = 0; this.musicTimer = 0.05 }
    this.musicTimer -= dt
    if (this.musicTimer > 0) return
    if (mode === 'fight') this.fightStep()
    else this.lobbyStep()
  }

  /** Лобби: босса-нова на четырёх аккордах */
  private lobbyStep(): void {
    const ctx = this.ctx!, out = this.musicGain!
    const beat = 0.26
    this.musicTimer += beat
    const chords = [[57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71]] // Am7 Dm7 G7 Cmaj7
    const s = this.musicStep++
    const ch = chords[Math.floor(s / 8) % 4]
    const t = ctx.currentTime + 0.02
    const pattern = [1, 0, 0, 1, 0, 0, 1, 0]
    if (s % 8 === 0) this.tone(out, t, beat * 1.6, 'sine', hz(ch[0] - 12), hz(ch[0] - 12), 0.5) // бас
    if (s % 8 === 4) this.tone(out, t, beat * 1.2, 'sine', hz(ch[0] - 5), hz(ch[0] - 5), 0.35)
    if (pattern[s % 8]) for (const m of ch.slice(1)) this.tone(out, t, beat * 0.9, 'triangle', hz(m), hz(m), 0.09)
    if (s % 2 === 1) this.noise(out, t, 0.03, 'highpass', 7000, 0.12) // шейкер
  }

  /** Бой: 132 удара в минуту, шестнадцатые. Am – F – C – G, всё глухое и короткое */
  private fightStep(): void {
    const ctx = this.ctx!, out = this.musicGain!
    const step = 60 / 132 / 4
    this.musicTimer += step
    const s = this.musicStep++
    const bar = Math.floor(s / 16) % 4
    const i = s % 16
    const t = ctx.currentTime + 0.02
    const roots = [45, 41, 48, 43] // A F C G
    const r = roots[bar]
    // бочка-«тук» на каждую долю
    if (i % 4 === 0) { this.tone(out, t, 0.12, 'sine', 120, 45, 0.45); this.noise(out, t, 0.02, 'lowpass', 400, 0.15) }
    // приглушённый хлопок на 2 и 4
    if (i === 4 || i === 12) this.noise(out, t, 0.07, 'bandpass', 1100, 0.18, 700, 1.2)
    // бас шестнадцатыми, «отскок» на слабых
    const bassPat = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1]
    if (bassPat[i]) this.tone(out, t, step * 0.85, 'triangle', hz(r - 12 + (i % 8 === 6 ? 7 : 0)), hz(r - 12 + (i % 8 === 6 ? 7 : 0)), 0.26)
    // приглушённый «щипок» аккорда (как через стенку)
    const stab = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0]
    if (stab[i]) {
      const minor = bar === 0
      for (const iv of [12, minor ? 15 : 16, 19]) this.pluck(out, t, 0.12, hz(r + iv), 0.07)
    }
    // короткая мелодия-ответ во второй половине каждых двух тактов
    if ((s % 32) >= 24 && i % 2 === 0) {
      const mel = [0, 3, 7, 3]
      this.pluck(out, t, 0.1, hz(r + 24 + mel[((s % 32) - 24) / 2]), 0.05)
    }
    // тихий закрытый хэт на слабые шестнадцатые
    if (i % 2 === 1) this.noise(out, t, 0.02, 'highpass', 6000, i % 4 === 3 ? 0.08 : 0.04)
  }

  /** Глухой щипок: треугольник через низкочастотный фильтр */
  private pluck(out: AudioNode, t: number, dur: number, f: number, vol: number): void {
    const ctx = this.ctx!
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1400, t)
    lp.frequency.exponentialRampToValueAtTime(500, t + dur)
    lp.connect(out)
    this.tone(lp, t, dur, 'triangle', f, f, vol)
  }

  // ---------- кирпичики ----------

  private tone(out: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noise(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, freqEnd?: number, q = 1): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(freq, t)
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(out)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.02)
  }

  private whoosh(out: AudioNode, t: number, dur: number, freq: number, vol: number): void {
    this.noise(out, t, dur, 'bandpass', freq * 0.6, vol, freq * 1.8, 1.5)
  }

  private thud(out: AudioNode, t: number, vol: number, f: number): void {
    this.tone(out, t, 0.18, 'sine', f * 1.8, f * 0.5, 0.6 * vol)
    this.noise(out, t, 0.06, 'lowpass', 600, 0.4 * vol)
  }

  /** Мокрый удар: низкий шлепок + «хлюп» с бегущим фильтром */
  private squelch(out: AudioNode, t: number, vol: number): void {
    this.noise(out, t, 0.14, 'lowpass', 2200, 0.55 * vol, 260, 4)
    this.noise(out, t + 0.02, 0.1, 'bandpass', 700, 0.35 * vol, 1500, 6)
    this.tone(out, t, 0.1, 'sine', 160, 60, 0.45 * vol)
  }

  /** Бульканье: несколько коротких «пузырей» — для фонтана из шеи */
  private gurgle(out: AudioNode, t: number, dur: number): void {
    for (let i = 0; i < 12; i++) {
      const tt = t + (i / 12) * dur + Math.random() * 0.05
      const f = 300 + Math.random() * 500
      this.tone(out, tt, 0.06, 'sine', f, f * 1.8, 0.12 * (1 - i / 14))
    }
    this.noise(out, t, dur, 'lowpass', 900, 0.18, 200, 3)
  }

  private slurp(out: AudioNode, t: number): void {
    this.noise(out, t, 0.25, 'bandpass', 800, 0.35, 2500, 5)
    this.noise(out, t + 0.12, 0.12, 'bandpass', 1200, 0.25, 600, 5)
  }

  private bell(out: AudioNode, t: number, f: number, vol: number): void {
    this.tone(out, t, 0.9, 'sine', f, f, vol)
    this.tone(out, t, 0.5, 'sine', f * 2.76, f * 2.76, vol * 0.25)
  }
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export const sfx = new Sfx()
