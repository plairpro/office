import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { AABB } from '../scene/builder'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'

const SKIN = [0xf0c8a5, 0xe2b18c, 0xc68e66, 0x8d5a3b]
const SCALE = 1.12 // чуть крупнее реальных — лучше читаются сверху

type Mat = THREE.MeshStandardMaterial
const mat = (hex: number, roughness = 0.8, metalness = 0): Mat =>
  new THREE.MeshStandardMaterial({ color: hex, roughness, metalness })

interface Rig {
  body: THREE.Group
  legL: THREE.Object3D
  legR: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  tinted: Mat[] // перекрашиваются в цвет игрока
  height: number
}

// ---------- примитивы ----------

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = true
  o.receiveShadow = true
  return o
}

const capsule = (r: number, len: number, m: Mat, x = 0, y = 0, z = 0) =>
  mesh(new THREE.CapsuleGeometry(r, len, 4, 12), m, x, y, z)

const rbox = (w: number, h: number, d: number, r: number, m: Mat, x = 0, y = 0, z = 0) =>
  mesh(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y, z)

function ellipsoid(rx: number, ry: number, rz: number, m: Mat, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.SphereGeometry(1, 20, 14)
  g.scale(rx, ry, rz)
  return mesh(g, m, x, y, z)
}

/** Шапочка/причёска: верхняя часть сферы */
function cap(r: number, m: Mat, x: number, y: number, z: number, thetaLen = Math.PI * 0.55, sy = 1): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, thetaLen)
  g.scale(1, sy, 1)
  return mesh(g, m, x, y, z)
}

/** Конечность с опорной точкой сверху — качается от плеча/бедра */
function limb(r: number, len: number, m: Mat, x: number, y: number, end?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, 0)
  g.add(capsule(r, len, m, 0, -len / 2 - r * 0.3, 0))
  if (end) { end.position.y -= len + r; g.add(end) }
  return g
}

function shoe(w: number, l: number, m: Mat): THREE.Mesh {
  return rbox(w, 0.07, l, 0.03, m, 0, 0.02, 0.04)
}

function face(y: number, z: number, spread: number, extra: THREE.Object3D[] = []): THREE.Object3D[] {
  const eye = mat(0x16181c, 0.3)
  return [
    ellipsoid(0.014, 0.018, 0.01, eye, -spread, y, z),
    ellipsoid(0.014, 0.018, 0.01, eye, spread, y, z),
    ...extra,
  ]
}

function head(skin: Mat, y: number, r = 0.105): THREE.Mesh[] {
  return [
    capsule(0.045, 0.06, skin, 0, y - r - 0.02, 0), // шея
    ellipsoid(r * 0.92, r * 1.12, r, skin, 0, y, 0),
  ]
}

// ---------- персонажи ----------

function buildAccountant(color: number, skinHex: number): Rig {
  const cardigan = mat(color, 0.9)
  const skin = mat(skinHex, 0.6)
  const skirt = mat(0x3f434c, 0.85)
  const tights = mat(0xc9a68a, 0.55)
  const hair = mat(0xc4c6ca, 0.7)
  const heels = mat(0x2a1f1a, 0.4)
  const frame = mat(0x151515, 0.3, 0.5)
  const body = new THREE.Group()
  const legL = limb(0.045, 0.66, tights, -0.07, 0.8, shoe(0.07, 0.17, heels))
  const legR = limb(0.045, 0.66, tights, 0.07, 0.8, shoe(0.07, 0.17, heels))
  const armL = limb(0.04, 0.46, cardigan, -0.2, 1.3, ellipsoid(0.035, 0.045, 0.03, skin))
  const armR = limb(0.04, 0.46, cardigan, 0.2, 1.3, ellipsoid(0.035, 0.045, 0.03, skin))
  // очки: две оправы и перемычка
  const lens = (x: number) => mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 16), frame, x, 1.53, 0.098)
  body.add(
    legL, legR, armL, armR,
    mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.34, 18), skirt, 0, 0.72, 0), // юбка-карандаш
    rbox(0.3, 0.48, 0.17, 0.07, cardigan, 0, 1.1, 0), // кардиган
    rbox(0.1, 0.05, 0.02, 0.01, mat(0xf2efe8), 0, 1.32, 0.085), // воротничок блузки
    ...head(skin, 1.52, 0.1),
    cap(0.108, hair, 0, 1.53, -0.005, Math.PI * 0.6, 1.08),
    ellipsoid(0.06, 0.055, 0.05, hair, 0, 1.66, -0.08), // пучок
    lens(-0.038), lens(0.038),
    mesh(new THREE.BoxGeometry(0.025, 0.005, 0.005), frame, 0, 1.535, 0.1),
    ...face(1.53, 0.094, 0.038, [rbox(0.04, 0.006, 0.006, 0.002, mat(0x8b3a3a), 0, 1.46, 0.093)]),
  )
  return { body, legL, legR, armL, armR, tinted: [cardigan], height: 1.75 }
}

function buildBoss(color: number, skinHex: number): Rig {
  const shirt = mat(0xf6f6f2, 0.75)
  const accent = mat(color, 0.6)
  const skin = mat(skinHex, 0.55)
  const pants = mat(0x30343d, 0.8)
  const shoes = mat(0x1a1b1f, 0.35)
  const hair = mat(0x6b6b6b, 0.8)
  const body = new THREE.Group()
  const legL = limb(0.085, 0.58, pants, -0.12, 0.72, shoe(0.11, 0.24, shoes))
  const legR = limb(0.085, 0.58, pants, 0.12, 0.72, shoe(0.11, 0.24, shoes))
  const armL = limb(0.065, 0.46, shirt, -0.33, 1.32, ellipsoid(0.05, 0.06, 0.045, skin))
  const armR = limb(0.065, 0.46, shirt, 0.33, 1.32, ellipsoid(0.05, 0.06, 0.045, skin))
  const strap = (x: number, z: number, tilt: number) => {
    const m = mesh(new THREE.BoxGeometry(0.035, 0.5, 0.012), accent, x, 1.1, z)
    m.rotation.x = tilt
    return m
  }
  body.add(
    legL, legR, armL, armR,
    ellipsoid(0.27, 0.13, 0.22, pants, 0, 0.78, 0), // таз
    ellipsoid(0.29, 0.36, 0.24, shirt, 0, 1.06, 0), // торс
    ellipsoid(0.24, 0.22, 0.2, shirt, 0, 0.94, 0.08), // живот
    strap(-0.12, 0.215, -0.18), strap(0.12, 0.215, -0.18),
    strap(-0.1, -0.215, 0.12), strap(0.1, -0.215, 0.12),
    mesh(new THREE.BoxGeometry(0.06, 0.26, 0.012), accent, 0, 1.2, 0.235), // галстук
    ...head(skin, 1.56, 0.12),
    ellipsoid(0.11, 0.05, 0.1, skin, 0, 1.43, 0.03), // второй подбородок
    // остатки волос подковой
    mesh(new THREE.TorusGeometry(0.105, 0.025, 8, 20, Math.PI * 1.1), hair, 0, 1.55, -0.01).rotateX(Math.PI / 2).rotateZ(Math.PI * 0.95),
    rbox(0.08, 0.018, 0.02, 0.008, hair, 0, 1.51, 0.112), // усы
    ...face(1.58, 0.11, 0.042),
  )
  return { body, legL, legR, armL, armR, tinted: [accent], height: 1.8 }
}

function buildSecretary(color: number, skinHex: number): Rig {
  const dress = mat(color, 0.6)
  const skin = mat(skinHex, 0.55)
  const hair = mat(0x4a2c1c, 0.5)
  const heels = mat(0x111111, 0.3)
  const body = new THREE.Group()
  const legL = limb(0.045, 0.7, skin, -0.07, 0.84, shoe(0.065, 0.17, heels))
  const legR = limb(0.045, 0.7, skin, 0.07, 0.84, shoe(0.065, 0.17, heels))
  const armL = limb(0.035, 0.48, skin, -0.19, 1.34, ellipsoid(0.032, 0.042, 0.028, skin))
  const armR = limb(0.035, 0.48, skin, 0.19, 1.34, ellipsoid(0.032, 0.042, 0.028, skin))
  body.add(
    legL, legR, armL, armR,
    mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.36, 18), dress, 0, 0.76, 0), // юбка-трапеция
    rbox(0.27, 0.46, 0.16, 0.07, dress, 0, 1.13, 0), // лиф
    ...head(skin, 1.55, 0.098),
    cap(0.106, hair, 0, 1.56, -0.005, Math.PI * 0.62, 1.08),
    rbox(0.21, 0.4, 0.06, 0.03, hair, 0, 1.4, -0.08), // длинные волосы
    rbox(0.05, 0.22, 0.12, 0.02, hair, -0.09, 1.5, -0.02),
    rbox(0.05, 0.22, 0.12, 0.02, hair, 0.09, 1.5, -0.02),
    ...face(1.56, 0.092, 0.036, [ellipsoid(0.022, 0.008, 0.008, mat(0xc2185b, 0.4), 0, 1.485, 0.09)]),
  )
  return { body, legL, legR, armL, armR, tinted: [dress], height: 1.75 }
}

function buildCourier(color: number, skinHex: number): Rig {
  const polo = mat(color, 0.85)
  const skin = mat(skinHex, 0.55)
  const jeans = mat(0x3b5b8c, 0.9)
  const sneaker = mat(0xf2f2f2, 0.5)
  const hair = mat(0x2b1d14, 0.7)
  const body = new THREE.Group()
  const legL = limb(0.065, 0.72, jeans, -0.1, 0.86, shoe(0.1, 0.23, sneaker))
  const legR = limb(0.065, 0.72, jeans, 0.1, 0.86, shoe(0.1, 0.23, sneaker))
  const armL = limb(0.05, 0.48, polo, -0.25, 1.38, ellipsoid(0.042, 0.05, 0.035, skin))
  // правая рука держит коробку с пиццей
  const pizza = new THREE.Group()
  pizza.add(
    rbox(0.36, 0.05, 0.36, 0.01, mat(0xd9b77e, 0.9), 0, 0, 0.12),
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.004, 16), mat(0xc0392b, 0.6), 0, 0.027, 0.12),
  )
  pizza.position.set(0, -0.5, 0.05)
  const armR = limb(0.05, 0.48, polo, 0.25, 1.38, ellipsoid(0.042, 0.05, 0.035, skin))
  armR.add(pizza)
  const brimG = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI)
  body.add(
    legL, legR, armL, armR,
    rbox(0.32, 0.14, 0.2, 0.06, jeans, 0, 0.9, 0), // таз
    rbox(0.38, 0.5, 0.21, 0.08, polo, 0, 1.18, 0),
    rbox(0.12, 0.04, 0.02, 0.01, mat(0xffffff), 0, 1.41, 0.105), // воротник
    ...head(skin, 1.6, 0.105),
    cap(0.108, hair, 0, 1.6, -0.005, Math.PI * 0.5),
    cap(0.115, polo, 0, 1.63, 0, Math.PI * 0.42, 0.9), // кепка
    mesh(brimG, polo, 0, 1.655, 0.06),
    ...face(1.6, 0.1, 0.04),
  )
  return { body, legL, legR, armL, armR, tinted: [polo], height: 1.85 }
}

const BUILDERS: Record<CharacterId, (color: number, skin: number) => Rig> = {
  accountant: buildAccountant,
  boss: buildBoss,
  secretary: buildSecretary,
  courier: buildCourier,
}

/** Офисный персонаж. Анимация ходьбы — покачивание рук и ног. */
export class Avatar {
  readonly root = new THREE.Group()
  private rig: Rig
  private label: THREE.Sprite
  private ring: THREE.Mesh
  private phase = 0

  constructor(name: string, color: number, readonly character: CharacterId, look = 0) {
    this.rig = BUILDERS[character](color, SKIN[look % SKIN.length])
    this.rig.body.scale.setScalar(SCALE)
    this.root.add(this.rig.body)

    const r = CHARACTERS[character].radius
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(r + 0.04, r + 0.12, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.025
    this.root.add(this.ring)

    this.label = makeLabel(name, color)
    this.label.position.y = this.rig.height * SCALE + 0.35
    this.root.add(this.label)
  }

  setColor(hex: number): void {
    this.rig.tinted.forEach((m) => m.color.setHex(hex))
    ;(this.ring.material as THREE.MeshBasicMaterial).color.setHex(hex)
  }

  setName(name: string, color: number): void {
    this.root.remove(this.label)
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
    this.label = makeLabel(name, color)
    this.label.position.y = this.rig.height * SCALE + 0.35
    this.root.add(this.label)
  }

  /** speed — текущая скорость (м/с), facing — угол взгляда */
  animate(dt: number, speed: number, facing: number): void {
    const { body, legL, legR, armL, armR } = this.rig
    body.rotation.y = facing
    const moving = Math.min(speed / GAME.player.speed, 1)
    this.phase += dt * (5 + 7 * moving) * (moving > 0.05 ? 1 : 0)
    const swing = Math.sin(this.phase) * 0.75 * moving
    legL.rotation.x = swing
    legR.rotation.x = -swing
    armL.rotation.x = -swing * 0.8
    armR.rotation.x = this.character === 'courier' ? -1.1 + swing * 0.15 : swing * 0.8
    body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * moving
    body.rotation.x = moving * 0.08 // наклон вперёд на бегу
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
  colliders: AABB[], speedMul = 1, radius: number = GAME.player.radius,
): void {
  const { speed, accel } = GAME.player
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
