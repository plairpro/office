import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MV } from '../scene/palette'
import type { WeaponId } from '../config/game'

/**
 * Модели оружия — процедурные, по фото настоящих вещей, но в мягкой палитре.
 * Единицы — метры, «вперёд» = +Z (куда смотрит персонаж), +Y — вверх, рукоять в начале координат.
 * Одни и те же модели — в руке и на полу. Детали склеиваются по материалам: 3–6 вызовов отрисовки на предмет.
 */

type MatKey = 'yellow' | 'yellowDark' | 'black' | 'steel' | 'chrome' | 'blue' | 'grey' | 'teal' | 'white' | 'mint'
  | 'sage' | 'led' | 'gold' | 'bill' | 'billDark' | 'body' | 'grip' | 'cup' | 'lid' | 'sleeve' | 'red'

const MAT: Record<MatKey, THREE.MeshStandardMaterialParameters> = {
  yellow: { color: 0xf3c94f, roughness: 0.45 },
  yellowDark: { color: 0xd9a92e, roughness: 0.5 },
  black: { color: 0x2f2d3d, roughness: 0.55 },
  steel: { color: 0xf2f6fa, roughness: 0.25, metalness: 0.55 },
  chrome: { color: 0xe6ebf2, roughness: 0.28, metalness: 0.45 },
  blue: { color: 0x3f7fc4, roughness: 0.5 },
  grey: { color: 0xc9cfd6, roughness: 0.35, metalness: 0.35 },
  teal: { color: 0x2f9a93, roughness: 0.4 },
  white: { color: 0xfbf7f1, roughness: 0.9 },
  mint: { color: 0x8fd6c8, roughness: 0.9 },
  sage: { color: 0x7f9b7e, roughness: 0.6, metalness: 0.15 },
  led: { color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.6, roughness: 0.3 },
  gold: { color: MV.mustard, roughness: 0.3, metalness: 0.6 },
  bill: { color: 0xa6dcae, roughness: 0.8 },
  billDark: { color: 0x5fae7a, roughness: 0.8 },
  body: { color: MV.coral, roughness: 0.4 },
  grip: { color: MV.indigo, roughness: 0.6 },
  cup: { color: MV.white, roughness: 0.6 },
  lid: { color: MV.coral, roughness: 0.4 },
  sleeve: { color: MV.peach, roughness: 0.85 },
  red: { color: 0xd3122a, roughness: 0.5 },
}

/** Набор деталей: копим геометрию по материалам, в конце склеиваем */
class Kit {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()

  add(g: THREE.BufferGeometry, mat: MatKey, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): this {
    this.e.set(rx, ry, rz)
    this.q.setFromEuler(this.e)
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(...s))
    const geo = g.index ? g.toNonIndexed() : g
    if (geo !== g) g.dispose()
    geo.deleteAttribute('uv')
    geo.applyMatrix4(this.m)
    const list = this.parts.get(mat) ?? []
    list.push(geo)
    this.parts.set(mat, list)
    return this
  }

  box(w: number, h: number, d: number, mat: MatKey, x = 0, y = 0, z = 0, r = 0, rx = 0, ry = 0, rz = 0): this {
    const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
    const g = rr > 0 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d)
    return this.add(g, mat, x, y, z, rx, ry, rz)
  }

  /** цилиндр вдоль Z */
  cylZ(r0: number, r1: number, len: number, mat: MatKey, x = 0, y = 0, z = 0, seg = 16): this {
    return this.add(new THREE.CylinderGeometry(r1, r0, len, seg), mat, x, y, z, Math.PI / 2)
  }

  /** тело вращения вокруг Z: точки [радиус, z] */
  latheZ(pts: [number, number][], mat: MatKey, x = 0, y = 0, z = 0, seg = 24): this {
    const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg)
    return this.add(g, mat, x, y, z, Math.PI / 2)
  }

  /** профиль сбоку (u = z, v = y), выдавленный по X толщиной depth, с фаской */
  side(shape: THREE.Shape, depth: number, mat: MatKey, x = 0, bevel = 0.003): this {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 })
    g.translate(0, 0, -depth / 2)
    // x формы → z мира, выдавливание → x мира
    return this.add(g, mat, x, 0, 0, 0, -Math.PI / 2, 0)
  }

  build(): THREE.Group {
    const g = new THREE.Group()
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ ...MAT[key], flatShading: false }))
      mesh.castShadow = true
      g.add(mesh)
    }
    return g
  }
}

/** скруглённый прямоугольник в плоскости (u, v) */
function rrect(u0: number, v0: number, u1: number, v1: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(u0 + r, v0)
  s.lineTo(u1 - r, v0); s.quadraticCurveTo(u1, v0, u1, v0 + r)
  s.lineTo(u1, v1 - r); s.quadraticCurveTo(u1, v1, u1 - r, v1)
  s.lineTo(u0 + r, v1); s.quadraticCurveTo(u0, v1, u0, v1 - r)
  s.lineTo(u0, v0 + r); s.quadraticCurveTo(u0, v0, u0 + r, v0)
  return s
}

function poly(pts: [number, number][]): THREE.Shape {
  return new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)))
}

// ---------- канцелярский нож: жёлтый корпус с рёбрами, чёрный фиксатор-колёсико, сегментное лезвие ----------
function cutter(): THREE.Group {
  const k = new Kit()
  // корпус: обтекаемый, нос чуть сужается
  const body = new THREE.Shape()
  body.moveTo(-0.07, -0.012)
  body.lineTo(0.07, -0.012)
  body.quadraticCurveTo(0.085, -0.01, 0.088, 0.0)
  body.lineTo(0.088, 0.012)
  body.lineTo(-0.055, 0.017)
  body.quadraticCurveTo(-0.075, 0.017, -0.077, 0.004)
  body.quadraticCurveTo(-0.078, -0.012, -0.07, -0.012)
  k.side(body, 0.022, 'yellow', 0, 0.004)
  // рифлёные вставки на рукояти
  for (let i = 0; i < 6; i++) k.box(0.028, 0.0045, 0.006, 'yellowDark', 0, -0.004 + (i % 2) * 0.0015, -0.062 + i * 0.011, 0.002)
  // металлический жёлоб сверху и ползунок
  k.box(0.012, 0.004, 0.12, 'grey', 0, 0.016, 0.02, 0.0015)
  k.box(0.016, 0.009, 0.026, 'black', 0, 0.021, -0.045, 0.003)
  for (let i = 0; i < 4; i++) k.box(0.017, 0.002, 0.002, 'grey', 0, 0.026, -0.054 + i * 0.006)
  // колёсико-фиксатор сбоку
  k.add(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 14), 'black', 0.015, 0.004, -0.005, 0, 0, Math.PI / 2)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    k.box(0.009, 0.003, 0.003, 'black', 0.015, 0.004 + Math.sin(a) * 0.011, -0.005 + Math.cos(a) * 0.011, 0, a)
  }
  k.add(new THREE.CylinderGeometry(0.004, 0.004, 0.01, 10), 'grey', 0.017, 0.004, -0.005, 0, 0, Math.PI / 2)
  // лезвие: со скошенным концом и насечками сегментов
  k.side(poly([[0.08, -0.008], [0.15, -0.008], [0.172, 0.009], [0.08, 0.009]]), 0.0016, 'steel', 0, 0.0004)
  for (let i = 0; i < 4; i++) {
    const u = 0.1 + i * 0.016
    k.side(poly([[u, -0.008], [u + 0.0012, -0.008], [u + 0.0012 + 0.016, 0.009], [u + 0.016, 0.009]]), 0.0022, 'grey', 0, 0)
  }
  return k.build()
}

// ---------- строительный степлер: хромированная рама, синяя ручка, винт сверху ----------
function stapler(): THREE.Group {
  const k = new Kit()
  // рукоять у начала координат; нос (откуда вылетают скобы) — впереди по +Z, головка ниже
  const oy = -0.045
  // головка: вертикальный блок спереди
  k.side(rrect(0.06, oy - 0.05, 0.1, oy + 0.06, 0.006), 0.034, 'chrome', 0, 0.003)
  // магазин снизу во всю длину
  k.side(rrect(-0.09, oy - 0.05, 0.1, oy - 0.03, 0.006), 0.028, 'chrome', 0, 0.002)
  // боковые щёчки рамы (с вырезом под руку)
  const cheek = new THREE.Shape()
  cheek.moveTo(-0.09, oy - 0.03); cheek.lineTo(0.06, oy - 0.03); cheek.lineTo(0.06, oy + 0.05)
  cheek.lineTo(0.03, oy + 0.06); cheek.lineTo(0.0, oy + 0.035); cheek.lineTo(-0.06, oy + 0.02)
  cheek.lineTo(-0.09, oy - 0.01); cheek.closePath()
  const hole = rrect(-0.055, oy - 0.018, 0.035, oy + 0.012, 0.01)
  cheek.holes.push(hole)
  for (const sx of [-1, 1]) k.side(cheek, 0.004, 'chrome', sx * 0.015, 0.001)
  // поперечные стержни и заклёпки
  k.add(new THREE.CylinderGeometry(0.004, 0.004, 0.036, 10), 'steel', 0, oy + 0.022, 0.035, 0, 0, Math.PI / 2)
  k.add(new THREE.CylinderGeometry(0.004, 0.004, 0.036, 10), 'steel', 0, oy - 0.022, -0.075, 0, 0, Math.PI / 2)
  for (const sx of [-1, 1]) for (const [y, z] of [[oy + 0.03, 0.075], [oy - 0.015, 0.075], [oy + 0.022, 0.035]] as const) {
    k.add(new THREE.SphereGeometry(0.004, 8, 6), 'steel', sx * 0.019, y, z)
  }
  // рычаг-ручка: хромированный под синей резиновой накладкой
  k.side(poly([[-0.1, 0.0], [0.07, oy + 0.05], [0.07, oy + 0.062], [-0.1, 0.012]]), 0.02, 'chrome', 0, 0.002)
  k.add(new RoundedBoxGeometry(0.03, 0.026, 0.12, 3, 0.012), 'blue', 0, 0.018, -0.04, -0.17)
  // проволочная скоба-фиксатор
  const loop = new THREE.TorusGeometry(0.022, 0.0018, 6, 16, Math.PI)
  k.add(loop, 'steel', 0, 0.02, -0.07, 0, Math.PI / 2, 0)
  // винт регулировки сверху головки с накаткой
  k.cylZ(0.004, 0.004, 0.02, 'steel', 0, oy + 0.075, 0.08)
  const knob = new THREE.CylinderGeometry(0.012, 0.012, 0.014, 18)
  k.add(knob, 'grey', 0, oy + 0.09, 0.08)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    k.box(0.002, 0.013, 0.002, 'steel', Math.cos(a) * 0.0122, oy + 0.09, 0.08 + Math.sin(a) * 0.0122)
  }
  k.add(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), 'steel', 0, oy + 0.071, 0.08)
  // прорезь, откуда вылетает скоба
  k.box(0.022, 0.003, 0.006, 'black', 0, oy - 0.052, 0.085)
  return k.build()
}

// ---------- швабра: серая ручка, бирюзовые наконечник и муфта, пышная бахрома ----------
function mop(): THREE.Group {
  const k = new Kit()
  k.cylZ(0.014, 0.014, 1.32, 'grey', 0, 0, 0.42, 14)
  k.latheZ([[0, -0.29], [0.016, -0.29], [0.017, -0.27], [0.016, -0.22], [0.0145, -0.215], [0, -0.215]], 'teal', 0, 0, 0)
  k.cylZ(0.013, 0.013, 0.03, 'teal', 0, 0, -0.185, 14)
  // муфта: расширяется к бахроме
  k.latheZ([[0.0145, 1.07], [0.02, 1.08], [0.024, 1.12], [0.04, 1.14], [0.046, 1.16], [0.03, 1.165], [0, 1.165]], 'teal', 0, 0, 0)
  // бахрома: две юбки полосок, раскрываются конусом и свисают
  const strip = (len: number) => new THREE.BoxGeometry(0.042, 0.005, len)
  const N = 24
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + ring * 0.13
      const len = 0.34 + ((i * 7) % 5) * 0.018 - ring * 0.04
      const spread = 0.45 + ring * 0.3 + ((i * 3) % 4) * 0.06
      const g = strip(len)
      g.translate(0, 0, len / 2)
      // наклон полоски наружу от оси, затем поворот вокруг оси
      g.rotateX(-spread)
      g.rotateZ(a)
      k.add(g, i % 3 === 0 ? 'mint' : 'white', 0, 0, 1.15)
    }
  }
  // крапинки на полосках — как на фото
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39, r = 0.08 + (i % 5) * 0.035
    k.box(0.014, 0.008, 0.014, 'teal', Math.cos(a) * r, Math.sin(a) * r, 1.22 + (i % 4) * 0.04, 0.003)
  }
  return k.build()
}

// ---------- настольная лампа: квадратное основание, тонкая ножка, конический абажур ----------
function lamp(): THREE.Group {
  const k = new Kit()
  // держат за ножку; тяжёлое основание — ударная часть (впереди, +Z), абажур — сзади
  k.box(0.14, 0.14, 0.022, 'sage', 0, 0, 0.19, 0.006)
  // ножка с расширением у основания
  k.latheZ([[0, 0.18], [0.03, 0.18], [0.012, 0.165], [0.007, 0.14], [0.006, 0.1], [0, 0.1]], 'sage', 0, 0, 0)
  k.cylZ(0.0065, 0.0065, 0.34, 'sage', 0, 0, -0.06, 12)
  // абажур: широкий край смотрит на ножку, узкий торец — светится
  k.latheZ([[0.105, -0.2], [0.1, -0.24], [0.075, -0.36], [0.068, -0.365], [0.066, -0.36], [0.093, -0.24], [0.098, -0.2]], 'sage', 0, 0, 0, 32)
  k.add(new THREE.CircleGeometry(0.066, 32), 'led', 0, 0, -0.362, 0, Math.PI, 0)
  k.latheZ([[0.003, -0.22], [0.012, -0.226], [0.012, -0.24], [0, -0.24]], 'sage', 0, 0, 0)
  return k.build()
}

// ---------- деньгомёт: игрушечный пистолет с прозрачным магазином купюр ----------
function moneygun(): THREE.Group {
  const k = new Kit()
  // рукоять вниз от начала координат
  k.add(new RoundedBoxGeometry(0.034, 0.1, 0.04, 3, 0.012), 'grip', 0, -0.045, -0.015, 0.22)
  for (let i = 0; i < 4; i++) k.box(0.036, 0.004, 0.03, 'black', 0, -0.03 - i * 0.018, -0.02 + i * 0.003, 0.002, 0.22)
  // корпус-ствол
  k.side(rrect(-0.06, 0.0, 0.12, 0.06, 0.02), 0.07, 'body', 0, 0.006)
  // спусковая скоба и крючок
  k.add(new THREE.TorusGeometry(0.02, 0.004, 6, 14, Math.PI), 'grip', 0, -0.002, 0.03, Math.PI, Math.PI / 2, 0)
  k.box(0.008, 0.022, 0.008, 'gold', 0, -0.012, 0.028, 0.003, 0.3)
  // широкое дуло-щель
  k.side(rrect(0.115, 0.012, 0.14, 0.05, 0.008), 0.08, 'grip', 0, 0.003)
  k.box(0.066, 0.008, 0.012, 'black', 0, 0.031, 0.143, 0.003)
  // прозрачный короб с пачкой купюр сверху
  k.box(0.07, 0.04, 0.12, 'grip', 0, 0.064, 0.02, 0.008)
  for (let i = 0; i < 8; i++) k.box(0.064, 0.0035, 0.11, i % 2 ? 'bill' : 'billDark', 0, 0.088 + i * 0.0045, 0.02 + ((i * 5) % 3 - 1) * 0.002, 0.001)
  k.box(0.02, 0.004, 0.112, 'gold', 0, 0.124, 0.02, 0.0015) // бумажная лента-банковская бандероль
  // золотая монета-эмблема «$» на борту
  for (const sx of [-1, 1]) {
    k.add(new THREE.CylinderGeometry(0.016, 0.016, 0.005, 20), 'gold', sx * 0.039, 0.03, 0.04, 0, 0, Math.PI / 2)
    k.add(new THREE.TorusGeometry(0.012, 0.0022, 6, 20), 'yellowDark', sx * 0.042, 0.03, 0.04, 0, Math.PI / 2, 0)
  }
  // торчащая из дула купюра
  k.box(0.06, 0.0025, 0.05, 'bill', 0, 0.031, 0.165, 0.001, 0.08)
  return k.build()
}

// ---------- кофе навынос: лечит ----------
function coffee(): THREE.Group {
  const k = new Kit()
  k.add(new THREE.LatheGeometry([[0, 0], [0.072, 0], [0.074, 0.004], [0.09, 0.17], [0, 0.17]].map(([r, h]) => new THREE.Vector2(r, h)), 24), 'cup', 0, -0.09, 0)
  k.add(new THREE.LatheGeometry([[0.081, 0.06], [0.087, 0.06], [0.091, 0.13], [0.085, 0.13]].map(([r, h]) => new THREE.Vector2(r, h)), 24), 'sleeve', 0, -0.09, 0)
  k.add(new THREE.LatheGeometry([[0, 0.2], [0.03, 0.2], [0.04, 0.19], [0.088, 0.185], [0.096, 0.172], [0.094, 0.165], [0, 0.165]].map(([r, h]) => new THREE.Vector2(r, h)), 24), 'lid', 0, -0.09, 0)
  k.box(0.018, 0.006, 0.01, 'grip', 0.05, 0.106, 0, 0.002)
  // сердечко на стакане
  k.add(new THREE.SphereGeometry(0.011, 8, 6), 'red', -0.006, 0.0, 0.088, 0, 0, 0, [1, 1, 0.4])
  k.add(new THREE.SphereGeometry(0.011, 8, 6), 'red', 0.010, 0.0, 0.088, 0, 0, 0, [1, 1, 0.4])
  k.add(new THREE.ConeGeometry(0.015, 0.018, 8), 'red', 0.002, -0.013, 0.087, Math.PI, 0, 0, [1.05, 1, 0.4])
  return k.build()
}

export function weaponMesh(id: WeaponId | 'coffee'): THREE.Group {
  switch (id) {
    case 'cutter': return cutter()
    case 'stapler': return stapler()
    case 'mop': return mop()
    case 'lamp': return lamp()
    case 'moneygun': return moneygun()
    case 'coffee': return coffee()
  }
}

/** Скоба степлера (П-образная) и купюра деньгомёта — снаряды */
export function projectileMesh(kind: 'staple' | 'bill'): THREE.Mesh {
  if (kind === 'staple') {
    const parts = [
      new THREE.BoxGeometry(0.16, 0.025, 0.025).translate(0, 0, 0.07),
      new THREE.BoxGeometry(0.025, 0.025, 0.14).translate(-0.07, 0, 0),
      new THREE.BoxGeometry(0.025, 0.025, 0.14).translate(0.07, 0, 0),
    ]
    const g = mergeGeometries(parts)!
    parts.forEach((p) => p.dispose())
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe8eef5, metalness: 0.8, roughness: 0.25, emissive: 0x6f7c8c, emissiveIntensity: 0.4 }))
  }
  // купюра: светлое поле, тёмная рамка и «портрет»
  const c = document.createElement('canvas')
  c.width = 128; c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#b8e6bd'; g.fillRect(0, 0, 128, 64)
  g.strokeStyle = '#4f9e6a'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 54)
  g.fillStyle = '#4f9e6a'
  g.beginPath(); g.ellipse(64, 32, 13, 17, 0, 0, Math.PI * 2); g.fill()
  g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('$', 22, 33); g.fillText('$', 106, 33)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(0.24, 0.12)
  geo.rotateX(-Math.PI / 2)
  geo.rotateY(Math.PI / 2)
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
}
