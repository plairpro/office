import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AABB } from '../scene/builder'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'
import { getAssets, type BaseChar } from '../assets'
import { weaponMesh } from './weapons3d'
import type { WeaponId } from '../config/game'

// ======================================================================
// Офисные персонажи на базе CC0-героев KayKit: та же модель и 27 анимаций,
// но одежда перекрашена в атласе (отдельно для торса, рук и ног), оружие и
// доспехи убраны, добавлены аксессуары на костях (очки, кепка, пицца, галстук).
// ======================================================================

const HEIGHT = 1.85 // рост в метрах после масштабирования

type Group = 'Body' | 'Arm' | 'Leg' | 'Head'
/** Прямоугольник ячеек атласа 64×64 (включительно) → новый цвет. 'P' = цвет игрока */
type Rule = [x0: number, y0: number, x1: number, y1: number, color: number | 'P' | 'P+']
type Part = 'Body' | 'Arm' | 'Leg'
/**
 * Одежда: цвет ячейки атласа по тому, где она на теле.
 * h — высота от пола (0 — подошвы, 1 — макушка), side — насколько далеко от оси тела (1 — кончики рук).
 * Цвет игрока на одежду не идёт — он только на аксессуарах (галстук, кепка, бейдж) и на подписи.
 */
type Paint = (part: Part, h: number, side: number) => number
type Look = { base: BaseChar; paint: Paint; head?: Rule[]; accessories: (rig: Rig, color: number) => void }

const SKIN = 0xf5c4a0
const HIPS = 0.26 // ниже — брюки или юбка
const SHOES = 0.095 // ниже — обувь
const HANDS = 0.8 // дальше от оси — кисти

const LOOKS: Record<CharacterId, Look> = {
  // Курьер ← рыцарь: куртка доставки, джинсы, белые кроссовки, кепка цвета игрока, коробка пиццы
  courier: {
    base: 'knight',
    paint: (p, h, side) =>
      p === 'Arm' ? (side > HANDS ? SKIN : 0xf2b13f)
        : p === 'Leg' ? (h < SHOES ? 0xf4f3f7 : 0x5f7fae)
          : h < HIPS ? 0x5f7fae : 0xf2b13f,
    accessories: (rig, color) => { cap(rig, color); pizza(rig); badge(rig, color) },
  },
  // Босс ← варвар: белая рубашка, бежевые брюки, коричневые ботинки, галстук цвета игрока
  boss: {
    base: 'barbarian',
    paint: (p, h, side) =>
      p === 'Arm' ? (side > HANDS ? SKIN : 0xfbfaf6)
        : p === 'Leg' ? (h < SHOES ? 0x7a4d30 : 0xd8c3a0)
          : h < HIPS ? 0xd8c3a0 : 0xfbfaf6,
    accessories: (rig, color) => tie(rig, color),
  },
  // Бухгалтерша ← маг: седое каре, серо-сиреневый кардиган, коричневая юбка, телесные колготки, огромные очки
  accountant: {
    base: 'mage',
    paint: (p, h, side) =>
      p === 'Arm' ? (side > HANDS ? SKIN : 0x9c93b8)
        : p === 'Leg' ? (h < SHOES ? 0x4b3e48 : h > 0.17 ? 0x6e5257 : 0xe2c2a8)
          : h < HIPS ? 0x6e5257 : 0x9c93b8,
    head: [[2, 0, 3, 2, 0xdcdae6]],
    accessories: (rig, color) => { glasses(rig); badge(rig, color) },
  },
  // Секретарша ← разбойница: белая блузка, тёмная юбка-карандаш, колготки, чёрные туфли
  secretary: {
    base: 'rogue',
    paint: (p, h, side) =>
      p === 'Arm' ? (side > HANDS ? SKIN : 0xfdfaf4)
        : p === 'Leg' ? (h < SHOES ? 0x2f2d3d : h > 0.17 ? 0x3e3b60 : 0xeec6aa)
          : h < HIPS ? 0x3e3b60 : 0xfdfaf4,
    accessories: (rig, color) => badge(rig, color),
  },
}

/** Похоже на кожу (лицо, руки) — такие ячейки не перекрашиваем */
function isSkin(r: number, g: number, b: number): boolean {
  return r > 200 && g > 160 && b > 140 && r >= g && g >= b && r - b > 25
}

/** Для каждой ячейки атласа: средняя высота и удалённость от оси у вершин этой части тела */
const statsCache = new Map<string, Map<string, { h: number; side: number }>>()
function cellStats(base: BaseChar, model: THREE.Object3D, part: Part): Map<string, { h: number; side: number }> {
  const key = `${base}:${part}`
  const hit = statsCache.get(key)
  if (hit) return hit
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const H = box.max.y - box.min.y
  const acc = new Map<string, { h: number; side: number; n: number }>()
  const meshes: THREE.SkinnedMesh[] = []
  model.traverse((o) => { if (o instanceof THREE.SkinnedMesh && groupOf(o.name) === part) meshes.push(o) })
  const v = new THREE.Vector3()
  let maxSide = 1e-3
  const pts: [string, number, number][] = []
  for (const m of meshes) {
    const uv = m.geometry.attributes.uv
    const n = m.geometry.attributes.position.count
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, v)
      v.applyMatrix4(m.matrixWorld)
      const cx = Math.floor(uv.getX(i) * 16), cy = Math.floor(uv.getY(i) * 16)
      const side = Math.abs(v.x)
      maxSide = Math.max(maxSide, side)
      pts.push([`${cx},${cy}`, (v.y - box.min.y) / H, side])
    }
  }
  for (const [k, h, side] of pts) {
    const a = acc.get(k) ?? { h: 0, side: 0, n: 0 }
    a.h += h; a.side += side / maxSide; a.n++
    acc.set(k, a)
  }
  const out = new Map<string, { h: number; side: number }>()
  for (const [k, a] of acc) out.set(k, { h: a.h / a.n, side: a.side / a.n })
  statsCache.set(key, out)
  return out
}

/** Правила перекраски одежды для части тела */
function outfitRules(look: Look, model: THREE.Object3D, part: Part, src: THREE.Texture): Rule[] {
  const img = src.image as CanvasImageSource & { width: number; height: number }
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, 16, 16) // по пикселю на ячейку — средний цвет
  const px = g.getImageData(0, 0, 16, 16).data
  const rules: Rule[] = []
  for (const [k, st] of cellStats(look.base, model, part)) {
    const [x, y] = k.split(',').map(Number)
    if (x < 0 || y < 0 || x > 15 || y > 15) continue
    const i = (y * 16 + x) * 4
    if (isSkin(px[i], px[i + 1], px[i + 2])) continue
    rules.push([x, y, x, y, look.paint(part, st.h, st.side)])
  }
  return rules
}

// ---------- перекраска атласа ----------

function lighten(hex: number, k: number): number {
  const c = new THREE.Color(hex)
  c.lerp(new THREE.Color(0xffffff), k)
  return c.getHex()
}

/** Перекрашивает области атласа, сохраняя градиент объёма внутри ячеек */
function recolor(src: THREE.Texture, rules: Rule[], player: number): THREE.Texture {
  const img = src.image as ImageBitmap | HTMLImageElement | HTMLCanvasElement
  const S = 512 // атлас из плоских ячеек — половинного размера хватает
  const k = S / 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, S, S)
  const data = g.getImageData(0, 0, S, S)
  const px = data.data
  const tmp = new THREE.Color()
  for (const [x0, y0, x1, y1, col] of rules) {
    // одежда чуть светлее чистого цвета игрока — насыщенный красный оставляем только крови
    const hex = col === 'P' ? lighten(player, 0.2) : col === 'P+' ? lighten(player, 0.45) : col
    tmp.setHex(hex)
    const tr = tmp.r * 255, tg = tmp.g * 255, tb = tmp.b * 255
    const X0 = x0 * 64 * k, Y0 = y0 * 64 * k, X1 = (x1 + 1) * 64 * k, Y1 = (y1 + 1) * 64 * k
    // средняя яркость области — опорная
    let sum = 0, n = 0
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = (y * S + x) * 4
      sum += 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]; n++
    }
    const mean = Math.max(sum / n, 1)
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = (y * S + x) * 4
      const l = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / mean
      const f = 0.55 + 0.45 * l // смягчаем перепад: пастель, а не контраст
      px[i] = Math.min(255, tr * f)
      px[i + 1] = Math.min(255, tg * f)
      px[i + 2] = Math.min(255, tb * f)
    }
  }
  g.putImageData(data, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.flipY = src.flipY
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter // ячейки атласа не должны размываться на швах
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

function groupOf(meshName: string): Group {
  if (/Arm/.test(meshName)) return 'Arm'
  if (/Leg/.test(meshName)) return 'Leg'
  if (/Head/.test(meshName)) return 'Head'
  return 'Body'
}

// ---------- аксессуары ----------

interface Rig {
  /** габариты части тела в пространстве модели (поза покоя, до масштабирования) */
  box(part: string): THREE.Box3
  /** крепит объект к кости; position — точка в пространстве модели, объект смотрит вперёд модели */
  attach(boneName: string, o: THREE.Object3D, position: THREE.Vector3): void
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[]
}

const mat = (hex: number, rig: Rig) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75 })
  rig.disposables.push(m)
  return m
}
const geo = <G extends THREE.BufferGeometry>(g: G, rig: Rig): G => { rig.disposables.push(g); return g }

function glasses(rig: Rig): void {
  const b = rig.box('Head')
  const w = b.max.x - b.min.x
  const frame = mat(0x3d3557, rig)
  const lens = new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.35, roughness: 0.1 })
  rig.disposables.push(lens)
  const g = new THREE.Group()
  const r = w * 0.15
  const ring = geo(new THREE.TorusGeometry(r, r * 0.16, 8, 24), rig)
  const disc = geo(new THREE.CircleGeometry(r, 24), rig)
  for (const sx of [-1, 1]) {
    const o = new THREE.Mesh(ring, frame); o.position.x = sx * r * 1.15; g.add(o)
    const l = new THREE.Mesh(disc, lens); l.position.x = sx * r * 1.15; g.add(l)
  }
  const bridge = new THREE.Mesh(geo(new THREE.BoxGeometry(r * 0.5, r * 0.15, r * 0.15), rig), frame)
  g.add(bridge)
  rig.attach('head', g, new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * 0.45, b.max.z + r * 0.1))
}

function cap(rig: Rig, color: number): void {
  const b = rig.box('Head')
  const w = (b.max.x - b.min.x) * 0.5
  const m = mat(color, rig)
  const g = new THREE.Group()
  const domeGeo = geo(new THREE.SphereGeometry(w, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), rig)
  domeGeo.scale(1, 0.62, 1.04)
  const dome = new THREE.Mesh(domeGeo, m)
  const brimGeo = geo(new THREE.CylinderGeometry(w * 0.95, w * 0.95, w * 0.06, 24, 1, false, -Math.PI / 2, Math.PI), rig)
  const brim = new THREE.Mesh(brimGeo, m)
  brim.position.set(0, w * 0.02, w * 0.38)
  const button = new THREE.Mesh(geo(new THREE.SphereGeometry(w * 0.08, 8, 6), rig), mat(0xffffff, rig))
  button.position.y = w * 0.62
  g.add(dome, brim, button)
  g.name = 'cap'
  rig.attach('head', g, new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * 0.74, (b.min.z + b.max.z) / 2))
}

function pizza(rig: Rig): void {
  const box = new THREE.Group()
  const s = 0.42
  const lid = new THREE.Mesh(geo(new THREE.BoxGeometry(s, s * 0.14, s), rig), mat(0xf2d29b, rig))
  const logo = new THREE.Mesh(geo(new THREE.CylinderGeometry(s * 0.2, s * 0.2, 0.01, 20), rig), mat(0xe8505b, rig))
  logo.position.y = s * 0.075
  box.add(lid, logo)
  const hand = rig.box('ArmLeft')
  rig.attach('handslot.l', box, new THREE.Vector3(hand.max.x + s * 0.1, hand.min.y + s * 0.15, s * 0.35))
}

function tie(rig: Rig, color: number): void {
  const b = rig.box('Body')
  const h = (b.max.y - b.min.y) * 0.5
  const g = new THREE.Group()
  const m = mat(color, rig)
  const knot = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.18, h * 0.14, h * 0.08), rig), m)
  const blade = new THREE.Mesh(geo(new THREE.CylinderGeometry(h * 0.12, h * 0.04, h * 0.75, 4), rig), m)
  blade.rotation.y = Math.PI / 4
  blade.scale.z = 0.35
  blade.position.y = -h * 0.42
  g.add(knot, blade)
  g.name = 'tie'
  rig.attach('chest', g, new THREE.Vector3(0, b.max.y - h * 0.3, b.max.z + 0.01))
}

/** Офисный бейдж на шнурке цвета игрока — чтобы в драке отличать своих от чужих */
function badge(rig: Rig, color: number): void {
  const b = rig.box('Body')
  const h = (b.max.y - b.min.y) * 0.5
  const g = new THREE.Group()
  const m = mat(color, rig)
  const card = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.32, h * 0.42, h * 0.03), rig), m)
  card.position.y = -h * 0.45
  const photo = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.14, h * 0.16, h * 0.01), rig), mat(0xfbf7f1, rig))
  photo.position.set(0, -h * 0.39, h * 0.02)
  photo.userData.keep = true
  for (const sx of [-1, 1]) {
    const cord = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.03, h * 0.5, h * 0.02), rig), m)
    cord.position.set(sx * h * 0.12, -h * 0.05, -h * 0.01)
    cord.rotation.z = sx * 0.35
    g.add(cord)
  }
  g.add(card, photo)
  g.name = 'badge'
  rig.attach('chest', g, new THREE.Vector3(0, b.max.y - h * 0.2, b.max.z + 0.015))
}

// ---------- аватар ----------

/** Какие клипы играть. Названия — из пака KayKit */
const CLIP = {
  idle: 'Idle',
  run: 'Running_A',
  walk: 'Walking_A',
  hit: 'Hit_A',
  death: 'Death_A',
  cheer: 'Cheer',
}

export class Avatar {
  readonly root = new THREE.Group()
  private model: THREE.Object3D
  private mixer: THREE.AnimationMixer
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private label: THREE.Sprite
  private ring: THREE.Mesh
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private height = HEIGHT
  private socket = new THREE.Group() // правая рука: сюда вешается оружие (единицы — метры)
  private weaponObj: THREE.Object3D | null = null
  private weaponId: WeaponId | null = null
  private tmpQ = new THREE.Quaternion()
  private tmpQ2 = new THREE.Quaternion()
  private head: THREE.Object3D | null = null
  private mats: THREE.MeshStandardMaterial[] = []
  private flashT = 0
  private flashColor = new THREE.Color()
  private oneShot: THREE.AnimationAction | null = null
  private deathAction: THREE.AnimationAction | null = null
  dead = false
  readonly skin = SKIN
  headSize = 0.4
  private hpBg: THREE.Sprite
  private hpFg: THREE.Sprite

  constructor(name: string, private color: number, readonly character: CharacterId, _look = 0) {
    const look = LOOKS[character]
    const a = getAssets()
    this.model = SkeletonUtils.clone(a.chars[look.base].scene)

    // перекраска по группам мешей
    const cache = new Map<Group, THREE.Material>()
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.frustumCulled = false // кости двигают вершины за пределы исходных габаритов
      const grp = groupOf(o.name)
      let m = cache.get(grp)
      if (!m) {
        const src = o.material as THREE.MeshStandardMaterial
        const nm = src.clone()
        nm.roughness = 0.8
        nm.metalness = 0
        const rules = !src.map ? null : grp === 'Head' ? look.head ?? null : outfitRules(look, this.model, grp, src.map)
        if (rules && rules.length && src.map) {
          nm.map = recolor(src.map, rules, color)
          this.disposables.push(nm.map)
        }
        this.disposables.push(nm)
        cache.set(grp, nm)
        m = nm
      }
      o.material = m
    })

    // аксессуары — в позе покоя, пока модель без масштаба
    const model = this.model
    model.updateMatrixWorld(true)
    const tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3()
    const rig: Rig = {
      box: (part) => {
        let mesh: THREE.SkinnedMesh | null = null
        model.traverse((o) => { if (!mesh && o instanceof THREE.SkinnedMesh && o.name.endsWith(part)) mesh = o })
        const m = mesh as THREE.SkinnedMesh | null
        if (!m) return new THREE.Box3(new THREE.Vector3(-0.3, 1, -0.3), new THREE.Vector3(0.3, 1.6, 0.3))
        // вершины сжаты (KHR_mesh_quantization), распаковка спрятана в костях —
        // поэтому габариты считаем по реально скиннутым вершинам
        m.computeBoundingBox()
        return m.boundingBox!.clone().applyMatrix4(m.matrixWorld)
      },
      attach: (boneName, o, pos) => {
        // GLTFLoader убирает точки из имён: handslot.r → handslotr
        const bone = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(boneName))
        if (!bone) return
        o.traverse((x) => { if (x instanceof THREE.Mesh) x.castShadow = true })
        bone.matrixWorld.decompose(tv, tq, ts)
        o.quaternion.copy(tq).invert()
        o.scale.divide(ts)
        o.position.copy(bone.worldToLocal(pos.clone()))
        bone.add(o)
      },
      disposables: this.disposables,
    }
    look.accessories(rig, color)
    // гнездо для оружия в правой руке, оси — как у модели (вперёд = +Z)
    const hand = rig.box('ArmRight')
    rig.attach('handslot.r', this.socket, new THREE.Vector3(hand.min.x + 0.05, hand.min.y + 0.12, (hand.min.z + hand.max.z) / 2))
    // как в паке KayKit: оружие крепится к слоту руки без поворота, «вперёд» оружия = ось Y слота
    this.socket.position.set(0, 0, 0)
    this.socket.quaternion.identity()
    this.socket.rotation.x = -Math.PI / 2
    this.head = model.getObjectByName('head') ?? null

    // масштаб под рост и опора на пол
    const box = new THREE.Box3().setFromObject(this.model)
    const k = HEIGHT / Math.max(box.max.y - box.min.y, 0.1)
    this.model.scale.setScalar(k)
    this.model.position.y = -box.min.y * k
    this.socket.scale.multiplyScalar(1 / k)
    const hb = rig.box('Head')
    this.headSize = Math.max(hb.max.y - hb.min.y, hb.max.x - hb.min.x) * k
    cache.forEach((m) => this.mats.push(m as THREE.MeshStandardMaterial))

    this.mixer = new THREE.AnimationMixer(this.model)
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot) {
        this.oneShot.fadeOut(0.15)
        this.oneShot = null
      }
    })

    this.root.add(this.model)

    // анимации
    for (const [key, clipName] of Object.entries(CLIP)) {
      const clip = a.clips.get(clipName)
      if (clip) this.actions.set(key, this.mixer.clipAction(clip))
    }
    this.play('idle', 0)

    // мягкая тень под ногами: солнце в офисе закрыто потолком, поэтому контактная тень рисуется отдельно
    const r = CHARACTERS[character].radius
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 4, r * 3.4),
      new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x2f2d55, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    // чуть сдвинута от солнца — читается как настоящая тень
    this.ring.position.set(0.12, 0.03, 0.16)
    this.ring.renderOrder = 2
    this.root.add(this.ring)

    this.label = makeLabel(name, color)
    this.label.position.y = this.height + 0.5
    this.root.add(this.label)

    // полоска здоровья над головой
    const bar = (hex: number, opacity: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: hex, depthTest: false, transparent: true, opacity }))
      sp.renderOrder = 11
      sp.position.y = this.height + 0.18
      sp.scale.set(0.9, 0.07, 1)
      this.root.add(sp)
      return sp
    }
    this.hpBg = bar(0x3d3557, 0.35)
    this.hpFg = bar(0xd3122a, 0.95)
    this.hpBg.visible = this.hpFg.visible = false
  }

  /** Подпись с именем над головой (в меню прячем) */
  showLabel(v: boolean): void { this.label.visible = v }

  /** Здоровье 0..1 над головой; null — скрыть */
  setHp(frac: number | null): void {
    const show = frac !== null && !this.dead
    this.hpBg.visible = this.hpFg.visible = show && frac > 0
    if (!show || frac <= 0) return
    const f = Math.min(1, frac)
    this.hpFg.scale.x = 0.9 * f
    this.hpFg.center.set(0.5 / f, 0.5)
  }

  private play(key: string, fade = 0.2): void {
    const next = this.actions.get(key)
    if (!next || next === this.current) return
    next.reset().play()
    if (this.current) next.crossFadeFrom(this.current, fade, true)
    else next.fadeIn(fade)
    this.current = next
  }

  /** Разовая анимация поверх бега: удар, выстрел, получение урона */
  action(clipName: string, speed = 1): void {
    if (this.dead) return
    const clip = getAssets().clips.get(clipName)
    if (!clip) return
    const a = this.mixer.clipAction(clip)
    a.reset()
    a.setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = false
    a.timeScale = speed
    a.setEffectiveWeight(1)
    a.fadeIn(0.05).play()
    if (this.current) { this.current.fadeOut(0.05); this.current = null }
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.05)
    this.oneShot = a
  }

  /** Оружие в правой руке */
  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return
    this.weaponId = id
    if (this.weaponObj) {
      this.socket.remove(this.weaponObj)
      this.weaponObj.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
      })
    }
    this.weaponObj = weaponMesh(id)
    // мультяшные руки крупнее настоящих — оружие тоже чуть увеличиваем, чтобы читалось сверху
    this.weaponObj.scale.setScalar(id === 'mop' ? 1.15 : id === 'lamp' ? 2 : 2.5)
    this.socket.add(this.weaponObj)
  }

  /** Вспышка при попадании */
  flash(hex = 0xff2a3d): void {
    this.flashT = 0.18
    this.flashColor.setHex(hex)
  }

  /** Мигание при неуязвимости после респа */
  blink(visible: boolean): void {
    this.model.visible = visible
  }

  /** Смерть: анимация падения, голова отлетает отдельно — возвращает её мировую позицию */
  die(withHead = true): THREE.Vector3 | null {
    if (this.dead) return null
    this.dead = true
    this.oneShot?.fadeOut(0.05)
    this.oneShot = null
    this.current?.fadeOut(0.1)
    this.current = null
    const clip = getAssets().clips.get('Death_A')
    if (clip) {
      this.deathAction = this.mixer.clipAction(clip)
      this.deathAction.reset()
      this.deathAction.setLoop(THREE.LoopOnce, 1)
      this.deathAction.clampWhenFinished = true
      this.deathAction.timeScale = 1.4
      this.deathAction.fadeIn(0.05).play()
    }
    this.hpBg.visible = this.hpFg.visible = false
    if (!withHead || !this.head) return null
    this.model.updateMatrixWorld(true)
    const p = new THREE.Vector3()
    this.head.getWorldPosition(p)
    this.head.scale.setScalar(0.001) // вместе с головой исчезают очки, кепка, причёска
    return p
  }

  /** Точка шеи — для фонтана */
  neck(): THREE.Vector3 | null {
    if (!this.head) return null
    const p = new THREE.Vector3()
    this.head.getWorldPosition(p)
    return p
  }

  revive(): void {
    this.dead = false
    this.deathAction?.stop()
    this.deathAction = null
    this.head?.scale.setScalar(1)
    this.ring.visible = true
    this.model.visible = true
    this.current = null
    this.play('idle', 0.05)
  }

  /** Цвет игрока зависит от порядка входа — при смене пересобираем перекраску */
  setColor(hex: number): void {
    if (hex === this.color) return
    this.color = hex
    // одежда от цвета игрока не зависит — перекрашиваем только аксессуары
    this.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) && o instanceof THREE.Mesh && /cap|tie|badge/.test(o.parent?.name ?? '') && !o.userData.keep) {
        (o.material as THREE.MeshStandardMaterial).color.setHex(hex)
      }
    })
  }

  setName(name: string, color: number): void {
    this.root.remove(this.label)
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
    this.label = makeLabel(name, color)
    this.label.position.y = this.height + 0.5
    this.root.add(this.label)
  }

  /** speed — текущая скорость (м/с), facing — угол взгляда */
  animate(dt: number, speed: number, facing: number): void {
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt)
      const f = (this.flashT / 0.18) * 0.9
      for (const m of this.mats) m.emissive.copy(this.flashColor).multiplyScalar(f)
    }
    if (this.dead) { this.mixer.update(dt); return }
    this.model.rotation.y = facing
    const k = speed / GAME.player.speed
    if (this.oneShot) { /* удар/выстрел доигрывает поверх */ }
    else if (k > 0.55) this.play('run')
    else if (k > 0.12) this.play('walk')
    else this.play('idle')
    const run = this.actions.get('run')
    if (run && this.current === run) run.timeScale = 0.75 + k * 0.45
    this.mixer.update(dt)
    // степлер и деньгомёт всегда смотрят туда же, куда персонаж — так понятно, куда полетит
    if (this.weaponObj && (this.weaponId === 'stapler' || this.weaponId === 'moneygun')) {
      this.socket.updateWorldMatrix(true, false)
      this.socket.getWorldQuaternion(this.tmpQ).invert()
      this.model.getWorldQuaternion(this.tmpQ2)
      this.weaponObj.quaternion.multiplyQuaternions(this.tmpQ, this.tmpQ2)
    } else if (this.weaponObj) this.weaponObj.quaternion.identity()
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.weaponObj?.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
    this.disposables.forEach((d) => d.dispose())
    for (const sp of [this.hpBg, this.hpFg]) sp.material.dispose()
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
  }
}

function makeLabel(text: string, color: number): THREE.Sprite {
  // без плашки: тонкий белый текст с мягкой тенью и цветная точка игрока с отступом
  const S = 2 // запас по разрешению — чтобы тонкий шрифт не мылился
  const canvas = document.createElement('canvas')
  canvas.width = 256 * S
  canvas.height = 48 * S
  const ctx = canvas.getContext('2d')!
  ctx.scale(S, S)
  ctx.font = '500 22px system-ui, -apple-system, "Segoe UI", sans-serif'
  const tw = Math.min(ctx.measureText(text).width, 200)
  const dot = 7, gap = 9
  const x0 = (256 - (tw + dot * 2 + gap)) / 2
  ctx.shadowColor = 'rgba(30, 25, 55, 0.9)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1.5
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.beginPath()
  ctx.arc(x0 + dot, 24, dot - 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // тонкая тёмная обводка + тень: белый текст читается и на светлом полу
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(40, 34, 70, 0.45)'
  ctx.strokeText(text, x0 + dot * 2 + gap, 25, 200)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x0 + dot * 2 + gap, 25, 200)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sprite.scale.set(1.9, 0.36, 1)
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

let blobTex: THREE.Texture | null = null
/** Круглое мягкое пятно: тёмный центр, прозрачный край */
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 31)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.45, 'rgba(255,255,255,0.75)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}
