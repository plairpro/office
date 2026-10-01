import * as THREE from 'three'
import type { AABB } from '../scene/builder'
import { GAME } from '../config/game'

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524]
const HAIR = [0x2b1d14, 0x4a3426, 0xa0522d, 0x1a1a1a, 0xd9b26f]

/** Низкополигональный офисный работник. Анимация ходьбы — покачивание рук и ног. */
export class Avatar {
  readonly root = new THREE.Group()
  private body = new THREE.Group()
  private legL: THREE.Mesh
  private legR: THREE.Mesh
  private armL: THREE.Mesh
  private armR: THREE.Mesh
  private shirtMat: THREE.MeshLambertMaterial
  private label: THREE.Sprite
  private phase = 0

  constructor(name: string, color: number, look = 0) {
    const mat = (hex: number) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
    this.shirtMat = mat(color)
    const pants = mat(0x2f3542)
    const skin = mat(SKIN[look % SKIN.length])
    const hair = mat(HAIR[(look * 3 + 1) % HAIR.length])
    const tie = mat(0x22252b)
    const shoe = mat(0x1b1d22)

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      return mesh
    }

    // ноги: опорная точка у бедра, чтобы качались от него
    const leg = (x: number) => {
      const g = new THREE.BoxGeometry(0.2, 0.7, 0.24)
      g.translate(0, -0.35, 0)
      const m = new THREE.Mesh(g, pants)
      m.position.set(x, 0.78, 0)
      m.castShadow = true
      const foot = box(0.22, 0.1, 0.32, shoe, 0, -0.7, 0.05)
      m.add(foot)
      return m
    }
    this.legL = leg(-0.13)
    this.legR = leg(0.13)

    const arm = (x: number) => {
      const g = new THREE.BoxGeometry(0.16, 0.62, 0.18)
      g.translate(0, -0.29, 0)
      const m = new THREE.Mesh(g, this.shirtMat)
      m.position.set(x, 1.38, 0)
      m.castShadow = true
      const hand = box(0.14, 0.14, 0.14, skin, 0, -0.62, 0)
      m.add(hand)
      return m
    }
    this.armL = arm(-0.38)
    this.armR = arm(0.38)

    this.body.add(
      this.legL, this.legR, this.armL, this.armR,
      box(0.6, 0.66, 0.34, this.shirtMat, 0, 1.08, 0), // торс
      box(0.1, 0.42, 0.02, tie, 0, 1.13, 0.18), // галстук
      box(0.46, 0.44, 0.42, skin, 0, 1.66, 0), // голова-кубик
      box(0.5, 0.14, 0.46, hair, 0, 1.92, -0.02), // причёска
      box(0.06, 0.07, 0.02, mat(0x111111), -0.1, 1.7, 0.21), // глаза
      box(0.06, 0.07, 0.02, mat(0x111111), 0.1, 1.7, 0.21),
    )
    this.root.add(this.body)

    // индикатор направления под ногами
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.58, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    this.root.add(ring)

    this.label = makeLabel(name, color)
    this.label.position.y = 2.5
    this.root.add(this.label)
  }

  setColor(hex: number): void {
    this.shirtMat.color.setHex(hex)
  }

  setName(name: string, color: number): void {
    this.root.remove(this.label)
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
    this.label = makeLabel(name, color)
    this.label.position.y = 2.5
    this.root.add(this.label)
  }

  /** speed — текущая скорость (м/с), facing — угол взгляда */
  animate(dt: number, speed: number, facing: number): void {
    this.body.rotation.y = facing
    const moving = Math.min(speed / GAME.player.speed, 1)
    this.phase += dt * (6 + 6 * moving) * (moving > 0.05 ? 1 : 0)
    const swing = Math.sin(this.phase) * 0.7 * moving
    this.legL.rotation.x = swing
    this.legR.rotation.x = -swing
    this.armL.rotation.x = -swing * 0.8
    this.armR.rotation.x = swing * 0.8
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * moving
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose()
        const m = o.material as THREE.Material & { map?: THREE.Texture | null }
        m.map?.dispose()
        m.dispose()
      }
    })
  }
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 30px system-ui, -apple-system, Segoe UI, sans-serif'
  const w = Math.min(ctx.measureText(text).width + 28, 250)
  ctx.fillStyle = 'rgba(20,22,28,0.72)'
  ctx.beginPath()
  ctx.roundRect((256 - w) / 2, 10, w, 44, 12)
  ctx.fill()
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.fillRect((256 - w) / 2 + 10, 28, 8, 8)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128 + 6, 33, 220)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sprite.scale.set(2.2, 0.55, 1)
  sprite.renderOrder = 10
  return sprite
}

// ---------- движение и столкновения ----------

export interface Body {
  x: number
  z: number
  vx: number
  vz: number
}

/** Двигает тело к желаемому направлению с ускорением и выталкивает из препятствий */
export function stepBody(
  b: Body, dirX: number, dirZ: number, dt: number,
  colliders: AABB[], speedMul = 1,
): void {
  const { speed, accel, radius } = GAME.player
  const len = Math.hypot(dirX, dirZ)
  const tx = len > 0 ? (dirX / len) * speed * speedMul : 0
  const tz = len > 0 ? (dirZ / len) * speed * speedMul : 0
  const k = 1 - Math.exp(-accel * dt / speed)
  b.vx += (tx - b.vx) * k
  b.vz += (tz - b.vz) * k

  // шагаем частями, чтобы не проскакивать тонкие стены
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vz) * dt) / (radius * 0.5)))
  for (let s = 0; s < steps; s++) {
    b.x += (b.vx * dt) / steps
    b.z += (b.vz * dt) / steps
    for (const c of colliders) resolveCircleAABB(b, c, radius)
  }
}

function resolveCircleAABB(b: Body, c: AABB, r: number): void {
  const dx = b.x - c.x
  const dz = b.z - c.z
  const px = Math.max(-c.hw, Math.min(c.hw, dx))
  const pz = Math.max(-c.hd, Math.min(c.hd, dz))
  let ox = dx - px
  let oz = dz - pz
  const d2 = ox * ox + oz * oz
  if (d2 >= r * r) return
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    const push = r - d
    ox /= d
    oz /= d
    b.x += ox * push
    b.z += oz * push
    // гасим скорость в стену, оставляем скольжение вдоль
    const vn = b.vx * ox + b.vz * oz
    if (vn < 0) {
      b.vx -= vn * ox
      b.vz -= vn * oz
    }
  } else {
    // центр внутри прямоугольника — выталкиваем по ближайшей оси
    const ex = c.hw - Math.abs(dx) + r
    const ez = c.hd - Math.abs(dz) + r
    if (ex < ez) b.x += Math.sign(dx || 1) * ex
    else b.z += Math.sign(dz || 1) * ez
  }
}
