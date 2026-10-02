import * as THREE from 'three'

/** Клавиатура + мышь. Направление движения считается в экранных координатах изометрии. */
export class Input {
  private keys = new Set<string>()
  readonly mouseNdc = new THREE.Vector2(0, 0)
  mouseDown = false
  hasMouse = false
  /** последний ввод был пальцем — целимся автоматически */
  touchMode = false
  /** правый стик атаки: куда тянешь — туда целишься; null — не целимся */
  aimStick: { x: number; y: number } | null = null
  private fireQueue: { aim: { x: number; y: number } | null } | null = null

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return
      if (e.code === 'Space') e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      this.hasMouse = true
    })
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = true
      this.touchMode = e.pointerType !== 'mouse'
    })
    window.addEventListener('keydown', (e) => { if (!isTyping(e)) this.touchMode = false })
    this.setupAttackStick()
    window.addEventListener('pointerup', () => { this.mouseDown = false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    this.setupStick()
  }

  /** Держит атаку: ЛКМ или пробел */
  get attacking(): boolean {
    return this.mouseDown || this.keys.has('Space')
  }

  /** Забрать удар с правого стика: aim = null — короткий тап (автоприцел), иначе направление на экране */
  takeFire(): { aim: { x: number; y: number } | null } | null {
    const f = this.fireQueue
    this.fireQueue = null
    return f
  }

  /** Экранное направление → угол в мире (камера смотрит с юго-востока) */
  static screenToWorldAngle(v: { x: number; y: number }): number {
    const s = Math.SQRT1_2
    return Math.atan2((v.x - v.y) * s, (-v.x - v.y) * s)
  }

  // --- правый стик: кнопка удара, как в Brawl Stars ---
  private setupAttackStick(): void {
    const btn = document.getElementById('btn-attack')
    const knob = document.getElementById('atk-knob')
    if (!btn || !knob) return
    const R = 56, DEAD = 0.3
    let id: number | null = null
    let cx = 0, cy = 0
    let moved = false
    const set = (e: PointerEvent) => {
      let dx = e.clientX - cx, dy = e.clientY - cy
      const d = Math.hypot(dx, dy)
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
      knob.style.transform = `translate(${dx}px, ${dy}px)`
      const m = Math.hypot(dx, dy) / R
      if (m > DEAD) moved = true
      this.aimStick = m > DEAD ? { x: dx / R, y: -dy / R } : moved ? this.aimStick : null
    }
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (id !== null) return
      id = e.pointerId
      this.touchMode = true
      moved = false
      const r = btn.getBoundingClientRect()
      cx = r.left + r.width / 2; cy = r.top + r.height / 2
      try { btn.setPointerCapture(e.pointerId) } catch { /* синтетические события */ }
      btn.classList.add('held')
      set(e)
    })
    btn.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e) })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      id = null
      // отпустил: тянул — удар туда, просто тапнул — удар по ближайшему
      this.fireQueue = { aim: moved && this.aimStick ? { ...this.aimStick } : null }
      this.aimStick = null
      knob.style.transform = ''
      btn.classList.remove('held')
    }
    btn.addEventListener('pointerup', end)
    btn.addEventListener('pointercancel', end)
  }

  // --- сенсорный стик: палец в любом месте экрана = центр стика ---
  private stickId: number | null = null
  private stickOrigin = { x: 0, y: 0 }
  private stick = { x: 0, y: 0 } // -1..1, y вверх по экрану
  get touchActive(): boolean { return this.stickId !== null }

  private setupStick(): void {
    const ui = document.getElementById('stick')!
    const knob = document.getElementById('stick-knob')!
    const R = 50
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.stickId !== null) return
      if (e.clientX > window.innerWidth * 0.6) return // правая часть — для прицела
      this.stickId = e.pointerId
      this.stickOrigin = { x: e.clientX, y: e.clientY }
      ui.style.left = `${e.clientX}px`
      ui.style.top = `${e.clientY}px`
      knob.style.transform = ''
      ui.hidden = false
    })
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return
      let dx = e.clientX - this.stickOrigin.x
      let dy = e.clientY - this.stickOrigin.y
      const d = Math.hypot(dx, dy)
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
      knob.style.transform = `translate(${dx}px, ${dy}px)`
      const dead = 0.15
      const m = Math.hypot(dx, dy) / R
      this.stick = m < dead ? { x: 0, y: 0 } : { x: dx / R, y: -dy / R }
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = null
      this.stick = { x: 0, y: 0 }
      ui.hidden = true
    }
    this.el.addEventListener('pointerup', end)
    this.el.addEventListener('pointercancel', end)
  }

  /**
   * Желаемое направление в мире. Камера смотрит с юго-востока,
   * поэтому «вверх по экрану» = (-1, -1) по XZ.
   */
  moveDir(): { x: number; z: number } {
    const k = this.keys
    let sx = 0, sy = 0
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1
    if (this.stickId !== null) { sx = this.stick.x; sy = this.stick.y }
    const s = Math.SQRT1_2
    return { x: (sx - sy) * s, z: (-sx - sy) * s }
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
}
