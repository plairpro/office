import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { AABB } from '../scene/builder'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'
import { toon, outlineMaterial, addOutlines } from '../scene/style'

const SKIN = [0xffd9c2, 0xf6c3a0, 0xd9a07c, 0xa8704f]
const SCALE = 1.25 // мультяшные пропорции ниже ростом — увеличиваем для читаемости сверху
const OUTLINE = outlineMaterial(0x3d3557, 0.012)

type Mat = THREE.MeshToonMaterial
const mat = (hex: number): Mat => toon({ color: hex })

interface Rig {
  body: THREE.Group
  legL: THREE.Object3D
  legR: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  tinted: Mat[]
  height: number
}

// ---------- примитивы ----------

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = true
  return o
}

const capsule = (r: number, len: number, m: Mat, x = 0, y = 0, z = 0) =>
  mesh(new THREE.CapsuleGeometry(r, len, 5, 14), m, x, y, z)

const rbox = (w: number, h: number, d: number, r: number, m: Mat, x = 0, y = 0, z = 0) =>
  mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), m, x, y, z)

function blob(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.SphereGeometry(1, 24, 16)
  g.scale(rx, ry, rz)
  return mesh(g, m, x, y, z)
}

/** Верх сферы: причёска, кепка */
function dome(r: number, m: Mat, x: number, y: number, z: number, thetaLen = Math.PI * 0.55, sy = 1): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, thetaLen)
  g.scale(1, sy, 1)
  return mesh(g, m, x, y, z)
}

/** Короткая пухлая конечность с опорой сверху */
function limb(r: number, len: number, m: Mat, x: number, y: number, end?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, 0)
  g.add(capsule(r, len, m, 0, -len / 2, 0))
  if (end) { end.position.y -= len + r * 0.6; g.add(end) }
  return g
}

const shoe = (w: number, l: number, m: Mat) => rbox(w, 0.08, l, 0.035, m, 0, 0.02, 0.035)

/** Голова-шар с глазами-бусинками и румянцем */
function head(skinHex: number, y: number, r: number, opts: { blush?: boolean } = {}): THREE.Object3D[] {
  const skin = mat(skinHex)
  const eye = new THREE.MeshBasicMaterial({ color: 0x2d2640 })
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const z = r * 0.9
  const parts: THREE.Object3D[] = [
    capsule(r * 0.32, r * 0.2, skin, 0, y - r * 0.95, 0), // шея
    blob(r, r * 0.95, r * 0.92, skin, 0, y, 0),
  ]
  for (const sx of [-1, 1]) {
    const e = blob(r * 0.11, r * 0.15, r * 0.06, eye, sx * r * 0.36, y + r * 0.02, z)
    e.userData.noOutline = true
    const h = blob(r * 0.04, r * 0.04, r * 0.02, shine, sx * r * 0.36 + r * 0.03, y + r * 0.08, z + r * 0.04)
    h.userData.noOutline = true
    parts.push(e, h)
    if (opts.blush !== false) {
      const b = blob(r * 0.12, r * 0.07, r * 0.03, new THREE.MeshBasicMaterial({ color: 0xffa3b5, transparent: true, opacity: 0.75 }),
        sx * r * 0.55, y - r * 0.2, z * 0.93)
      b.rotation.y = sx * 0.5
      b.userData.noOutline = true
      parts.push(b)
    }
  }
  return parts
}

// ---------- персонажи ----------

/** Бухгалтерша: худая, высокая, седой пучок, огромные очки, юбка-карандаш */
function buildAccountant(color: number, skinHex: number): Rig {
  const cardigan = mat(color)
  const skirt = mat(0x6e6a8f)
  const legs = mat(0xd9b49a)
  const hair = mat(0xdcdbe6)
  const heels = mat(0x5a4250)
  const frame = new THREE.MeshBasicMaterial({ color: 0x3d3557 })
  const body = new THREE.Group()
  const legL = limb(0.045, 0.34, legs, -0.06, 0.46, shoe(0.08, 0.15, heels))
  const legR = limb(0.045, 0.34, legs, 0.06, 0.46, shoe(0.08, 0.15, heels))
  const armL = limb(0.045, 0.3, cardigan, -0.17, 0.86, blob(0.045, 0.05, 0.045, mat(skinHex)))
  const armR = limb(0.045, 0.3, cardigan, 0.17, 0.86, blob(0.045, 0.05, 0.045, mat(skinHex)))
  const glasses = (x: number) => {
    const m = mesh(new THREE.TorusGeometry(0.055, 0.011, 8, 20), frame, x, 1.13, 0.17)
    m.userData.noOutline = true
    return m
  }
  body.add(
    legL, legR, armL, armR,
    mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.26, 20), skirt, 0, 0.5, 0),
    rbox(0.26, 0.36, 0.17, 0.08, cardigan, 0, 0.78, 0),
    rbox(0.09, 0.04, 0.03, 0.015, mat(0xffffff), 0, 0.95, 0.08),
    ...head(skinHex, 1.13, 0.19, { blush: false }),
    dome(0.2, hair, 0, 1.14, -0.01, Math.PI * 0.58, 1.05),
    blob(0.1, 0.09, 0.09, hair, 0, 1.36, -0.08), // пучок
    glasses(-0.07), glasses(0.07),
    blob(0.07, 0.012, 0.012, frame, 0, 1.14, 0.175),
    rbox(0.07, 0.012, 0.01, 0.005, mat(0xb0566a), 0, 1.03, 0.175), // поджатые губы
  )
  return { body, legL, legR, armL, armR, tinted: [cardigan], height: 1.45 }
}

/** Босс: шар в белой рубашке, подтяжки и галстук цвета игрока, лысина, усы */
function buildBoss(color: number, skinHex: number): Rig {
  const shirt = mat(0xfdfcf8)
  const accent = mat(color)
  const pants = mat(0x5b5f80)
  const shoes = mat(0x3d3557)
  const hair = mat(0x8f8aa3)
  const body = new THREE.Group()
  const legL = limb(0.075, 0.2, pants, -0.12, 0.36, shoe(0.13, 0.2, shoes))
  const legR = limb(0.075, 0.2, pants, 0.12, 0.36, shoe(0.13, 0.2, shoes))
  const armL = limb(0.065, 0.26, shirt, -0.33, 0.82, blob(0.06, 0.065, 0.06, mat(skinHex)))
  const armR = limb(0.065, 0.26, shirt, 0.33, 0.82, blob(0.06, 0.065, 0.06, mat(skinHex)))
  // подтяжки идут по груди и спине, повторяя изгиб «шара»
  const strap = (x: number, z: number) => {
    const m = rbox(0.05, 0.3, 0.02, 0.01, accent, x, 0.8, z)
    m.rotation.x = z > 0 ? -0.55 : 0.55
    return m
  }
  body.add(
    legL, legR, armL, armR,
    blob(0.32, 0.33, 0.29, shirt, 0, 0.66, 0), // туловище-шар
    blob(0.3, 0.1, 0.27, pants, 0, 0.42, 0), // пояс брюк
    strap(-0.12, 0.24), strap(0.12, 0.24), strap(-0.12, -0.24), strap(0.12, -0.24),
    rbox(0.07, 0.24, 0.025, 0.012, accent, 0, 0.74, 0.3), // галстук
    ...head(skinHex, 1.13, 0.2),
    // остатки волос по бокам
    blob(0.05, 0.08, 0.12, hair, -0.18, 1.1, -0.03), blob(0.05, 0.08, 0.12, hair, 0.18, 1.1, -0.03),
    blob(0.13, 0.07, 0.05, hair, 0, 1.07, -0.17),
    blob(0.09, 0.025, 0.03, hair, 0, 1.05, 0.19), // усы
  )
  return { body, legL, legR, armL, armR, tinted: [accent], height: 1.42 }
}

/** Секретарша: длинные волосы, платье-трапеция, каблуки */
function buildSecretary(color: number, skinHex: number): Rig {
  const dress = mat(color)
  const skin = mat(skinHex)
  const hair = mat(0x8a5a44)
  const heels = mat(0xd04f78)
  const body = new THREE.Group()
  const legL = limb(0.042, 0.3, skin, -0.065, 0.42, shoe(0.075, 0.15, heels))
  const legR = limb(0.042, 0.3, skin, 0.065, 0.42, shoe(0.075, 0.15, heels))
  const armL = limb(0.04, 0.3, skin, -0.16, 0.84, blob(0.042, 0.048, 0.042, skin))
  const armR = limb(0.04, 0.3, skin, 0.16, 0.84, blob(0.042, 0.048, 0.042, skin))
  body.add(
    legL, legR, armL, armR,
    mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 22), dress, 0, 0.5, 0), // юбка
    rbox(0.24, 0.3, 0.16, 0.08, dress, 0, 0.76, 0), // лиф
    ...head(skinHex, 1.12, 0.19),
    dome(0.205, hair, 0, 1.13, -0.01, Math.PI * 0.6, 1.05),
    rbox(0.34, 0.42, 0.1, 0.05, hair, 0, 0.98, -0.12), // длинные волосы
    rbox(0.07, 0.3, 0.16, 0.035, hair, -0.17, 1.06, -0.02),
    rbox(0.07, 0.3, 0.16, 0.035, hair, 0.17, 1.06, -0.02),
    blob(0.035, 0.016, 0.012, mat(0xe0457b), 0, 1.02, 0.17), // губы
  )
  return { body, legL, legR, armL, armR, tinted: [dress], height: 1.42 }
}

/** Курьер: кепка и поло цвета игрока, джинсы, кеды, коробка пиццы в руке */
function buildCourier(color: number, skinHex: number): Rig {
  const polo = mat(color)
  const jeans = mat(0x7a9cd6)
  const sneaker = mat(0xffffff)
  const hair = mat(0x5a4038)
  const body = new THREE.Group()
  const legL = limb(0.06, 0.32, jeans, -0.09, 0.46, shoe(0.11, 0.2, sneaker))
  const legR = limb(0.06, 0.32, jeans, 0.09, 0.46, shoe(0.11, 0.2, sneaker))
  const armL = limb(0.05, 0.3, polo, -0.2, 0.88, blob(0.05, 0.055, 0.05, mat(skinHex)))
  const pizza = new THREE.Group()
  const lid = rbox(0.32, 0.05, 0.32, 0.015, mat(0xf2d29b), 0, 0, 0.1)
  const logo = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 20), mat(0xe8505b), 0, 0.028, 0.1)
  logo.userData.noOutline = true
  pizza.add(lid, logo)
  pizza.position.set(0, -0.36, 0.06)
  const armR = limb(0.05, 0.3, polo, 0.2, 0.88, blob(0.05, 0.055, 0.05, mat(skinHex)))
  armR.add(pizza)
  const brim = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), polo, 0, 1.24, 0.08)
  body.add(
    legL, legR, armL, armR,
    rbox(0.3, 0.12, 0.2, 0.06, jeans, 0, 0.5, 0),
    rbox(0.32, 0.36, 0.21, 0.09, polo, 0, 0.74, 0),
    rbox(0.12, 0.04, 0.03, 0.015, mat(0xffffff), 0, 0.92, 0.1),
    ...head(skinHex, 1.14, 0.2),
    dome(0.205, hair, 0, 1.14, -0.01, Math.PI * 0.5),
    dome(0.215, polo, 0, 1.18, 0, Math.PI * 0.42, 0.95), // кепка
    brim,
  )
  return { body, legL, legR, armL, armR, tinted: [polo], height: 1.5 }
}

const BUILDERS: Record<CharacterId, (color: number, skin: number) => Rig> = {
  accountant: buildAccountant,
  boss: buildBoss,
  secretary: buildSecretary,
  courier: buildCourier,
}

/** Мультяшный офисный персонаж с обводкой. Анимация ходьбы — покачивание рук и ног. */
export class Avatar {
  readonly root = new THREE.Group()
  private rig: Rig
  private label: THREE.Sprite
  private ring: THREE.Mesh
  private phase = 0

  constructor(name: string, color: number, readonly character: CharacterId, look = 0) {
    this.rig = BUILDERS[character](color, SKIN[look % SKIN.length])
    addOutlines(this.rig.body, OUTLINE)
    this.rig.body.rotation.order = 'YXZ' // сначала поворот, потом наклон вперёд
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
    this.phase += dt * (6 + 8 * moving) * (moving > 0.05 ? 1 : 0)
    const swing = Math.sin(this.phase) * 0.9 * moving
    legL.rotation.x = swing
    legR.rotation.x = -swing
    armL.rotation.x = -swing
    armR.rotation.x = this.character === 'courier' ? -1.3 + swing * 0.15 : swing
    // мультяшная походка: подпрыгивание и покачивание
    body.position.y = Math.abs(Math.sin(this.phase)) * 0.09 * moving
    body.rotation.z = Math.sin(this.phase) * 0.06 * moving
    body.rotation.x = moving * 0.1
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if (o.userData.isOutline) return // геометрия общая с основным мешем
        o.geometry.dispose()
        const m = o.material as THREE.Material & { map?: THREE.Texture | null }
        if (m === OUTLINE) return
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
  ctx.fillStyle = 'rgba(255,250,246,0.92)'
  ctx.beginPath()
  ctx.roundRect((256 - w) / 2, 10, w, 44, 12)
  ctx.fill()
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.fillRect((256 - w) / 2 + 10, 28, 8, 8)
  ctx.fillStyle = '#3d3557'
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
