import * as THREE from 'three'

/** Клавиатура + мышь. Направление движения считается в экранных координатах изометрии. */
export class Input {
  private keys = new Set<string>()
  readonly mouseNdc = new THREE.Vector2(0, 0)
  mouseDown = false
  hasMouse = false

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return
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
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.mouseDown = true })
    window.addEventListener('pointerup', () => { this.mouseDown = false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    this.setupStick()
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
