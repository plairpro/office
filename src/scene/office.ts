import * as THREE from 'three'
import { StaticBuilder, type AABB } from './builder'
import { prop, type PackName } from '../assets'

export interface Spawn { x: number; z: number; rot: number }

export interface Office {
  group: THREE.Group
  colliders: AABB[]
  spawns: Spawn[]
  cooler: { x: number; z: number; radius: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  sunDir: THREE.Vector3
}

// Ассеты KayKit крупнее реальных вещей примерно в 1.4 раза — приводим к метрам
const S = 0.72
const PIECE = 4 * S // ширина модульной стены
const W = (14 * PIECE) / 2 // 20.16 м
const D = (10 * PIECE) / 2 // 14.4 м

const C = {
  floor: 0xf6f1ec, lowWall: 0xa8dccb, lowTop: 0xf3e3d3,
  carpetA: 0xd6dcf5, carpetB: 0xf5d6dc, carpetC: 0xd9efe2, carpetMeet: 0xe7dcf3,
  ink: 0x4a4e6e, glass: 0xe6f4ff, frame: 0x6a6f8e, white: 0xfbf8f4,
  rack: 0x9aa0c8, rackFront: 0x777da3, ledG: 0x7dffb0, ledR: 0xff8fa3, ledB: 0x8fc4ff,
  cooler: 0x9ad8ff, zone: 0xa8e6d6, zoneIn: 0xc6f0e4,
  steel: 0xd3d7e6, sign: 0xffd27a,
}

let seed = 1337
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

class Placer {
  readonly group = new THREE.Group()
  constructor(private colliders: AABB[]) {}

  /**
   * Ставит модель из пака. collide: добавить препятствие по габаритам (по умолчанию —
   * если предмет выше 0.3 м и стоит на полу). shrink — насколько ужать коллайдер.
   */
  put(pack: PackName, name: string, x: number, z: number, rot = 0,
    o: { y?: number; scale?: number; collide?: boolean; shrink?: number } = {}): THREE.Object3D {
    const m = prop(pack, name)
    m.scale.multiplyScalar(S * (o.scale ?? 1))
    m.rotation.y = rot
    m.position.set(x, o.y ?? 0, z)
    this.group.add(m)
    m.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(m)
    const tall = box.max.y - box.min.y > 0.3 && box.min.y < 0.5
    if (o.collide ?? tall) {
      const k = o.shrink ?? 0.9
      this.colliders.push({
        x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2,
        hw: ((box.max.x - box.min.x) / 2) * k, hd: ((box.max.z - box.min.z) / 2) * k,
      })
    }
    return m
  }
}

export function buildOffice(): Office {
  seed = 1337
  const b = new StaticBuilder()
  const p = new Placer(b.colliders)

  // ---------- пол и ковры ----------
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, 'tile', C.floor)
  b.rbox(13, 0.015, 8.4, 0.2, -3.6, 0, -8.6, 'carpet', C.carpetA)
  b.rbox(8.8, 0.015, 8.4, 0.2, 9.2, 0, -8.6, 'carpet', C.carpetB)
  b.rbox(9, 0.015, 10, 0.2, -14.6, 0, 6.6, 'carpet', C.carpetC)
  b.rbox(7.2, 0.015, 7, 0.2, -16.4, 0, -10.6, 'carpet', C.carpetMeet)

  // ---------- стены ----------
  // северная: окна, двери лифта посередине
  for (let i = 0; i < 14; i++) {
    const x = -W + PIECE / 2 + i * PIECE
    const name = i === 7 ? 'wall_doorway' : i % 3 === 1 ? 'wall' : 'wall_window_open'
    p.put('kitchen', name, x, -D, 0, { collide: false })
  }
  b.blocker(0, -D, W * 2, 0.4)
  // западная
  for (let i = 0; i < 10; i++) {
    const z = -D + PIECE / 2 + i * PIECE
    const name = i === 4 ? 'wall_doorway' : i % 3 === 2 ? 'wall_window_open' : 'wall'
    p.put('kitchen', name, -W, z, Math.PI / 2, { collide: false })
  }
  b.blocker(-W, 0, 0.4, D * 2)
  // ближние к камере стены — низкий бортик, чтобы не загораживать вид
  lowWall(b, 'x', D, -W, W, [[-7.4, -4.6]])
  lowWall(b, 'z', W, -D, D, [[-9, -6]])

  // ---------- лифты (точки появления, цели режима «Документы») ----------
  const spawns: Spawn[] = [
    elevator(b, -W + PIECE * 7.5, -D, 0),
    elevator(b, -W, -D + PIECE * 4.5, Math.PI / 2),
    elevator(b, -6, D, Math.PI),
    elevator(b, W, -7.5, -Math.PI / 2),
  ]

  // ---------- переговорка (северо-запад) ----------
  glassWall(b, 'z', -12.6, -D + 0.2, -7, [[-9.4, -7.9]])
  glassWall(b, 'x', -7, -W + 0.2, -12.6, [[-16.9, -15.4]])
  p.put('furniture', 'table_medium_long', -16.4, -10.8, 0, { scale: 1.15 })
  for (let i = 0; i < 3; i++) {
    p.put('furniture', 'chair_C', -18 + i * 1.6, -12.5, 0, { collide: false })
    p.put('furniture', 'chair_C', -18 + i * 1.6, -9.1, Math.PI, { collide: false })
  }
  p.put('furniture', 'book_set', -16.8, -10.9, 0.3, { y: 0.72 * 1.15 + 0.18 })
  p.put('furniture', 'lamp_standing', -19.3, -8, 0)
  p.put('furniture', 'cactus_medium_A', -13.4, -13.6, 0)

  // ---------- open-space: столы ----------
  const desksA: [number, number, number][] = [[-8, -10.3, 0], [-3.4, -10.3, 0], [-8, -6.9, 0], [-3.4, -6.9, 0]]
  const desksB: [number, number, number][] = [[6.8, -10.3, 0], [11.4, -10.3, 0], [6.8, -6.9, 0], [11.4, -6.9, 0]]
  const desksC: [number, number, number][] = [[-16.6, 3.3, Math.PI / 2], [-12.8, 3.3, Math.PI / 2], [-16.6, 9.1, Math.PI / 2], [-12.8, 9.1, Math.PI / 2]]
  for (const [x, z, r] of [...desksA, ...desksB, ...desksC]) desk(b, p, x, z, r)

  // ---------- лаунж (юг, центр) ----------
  p.put('furniture', 'rug_rectangle_stripes_A', 1, 9.6, 0, { scale: 1.6, collide: false })
  p.put('furniture', 'couch_pillows', 1, 12.2, Math.PI)
  p.put('furniture', 'armchair_pillows', -2.4, 9.4, Math.PI / 2)
  p.put('furniture', 'armchair_pillows', 4.4, 9.4, -Math.PI / 2)
  p.put('furniture', 'table_low', 1, 9.4, 0)
  p.put('furniture', 'book_set', 1.3, 9.4, 0.4, { y: 0.36 + 0.1 })
  p.put('furniture', 'lamp_standing', -2.6, 12.6, 0)
  p.put('furniture', 'cactus_medium_B', 4.6, 12.8, 0)

  // ---------- кухня (юго-восток) ----------
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    p.put('kitchen', 'floor_kitchen', 13.1 + i * PIECE, 6.1 + j * PIECE, 0, { y: -0.36 + 0.02, collide: false })
  }
  // линия гарнитура вдоль восточной стены
  p.put('kitchen', 'kitchencounter_straight_A_backsplash', W - 0.75, 7.6, -Math.PI / 2)
  p.put('kitchen', 'kitchencounter_sink_backsplash', W - 0.75, 9.04, -Math.PI / 2)
  p.put('kitchen', 'kitchencounter_straight_A_decorated', W - 0.75, 10.48, -Math.PI / 2)
  p.put('kitchen', 'stove_multi', W - 0.75, 11.92, -Math.PI / 2)
  p.put('kitchen', 'fridge_A_decorated', W - 0.9, 13.4, -Math.PI / 2)
  p.put('kitchen', 'kitchentable_A_large_decorated', 15, 9.4, Math.PI / 2)
  for (const z of [8.4, 9.4, 10.4]) p.put('kitchen', 'chair_stool', 13.9, z, 0, { collide: false })
  p.put('kitchen', 'table_round_A_decorated', 13.4, 13, 0)

  // ---------- серверная (восток) ----------
  serverRoom(b)

  // ---------- склад и колонны-укрытия ----------
  p.put('proto', 'Pallet_Small_Decorated_A', 16.6, -12.6, 0.2)
  p.put('proto', 'Pallet_Small_Decorated_B', 18.6, -10.6, -0.1)
  p.put('proto', 'Box_A', 15.2, -11.2, 0.4)
  p.put('proto', 'Box_B', 15.4, -12.3, -0.2)
  p.put('kitchen', 'pillar_A', -6, 0.6, 0, { scale: 1.05 })
  p.put('kitchen', 'pillar_A', 8, 0.6, 0, { scale: 1.05 })
  p.put('furniture', 'cabinet_medium_decorated', -2.6, -2.8, 0)
  p.put('furniture', 'cabinet_medium_decorated', 3.8, 4.4, Math.PI)
  p.put('furniture', 'shelf_B_large_decorated', -9.6, -0.6, Math.PI / 2, { y: 0.9 })
  p.put('furniture', 'cabinet_medium_decorated', -9.6, -0.6, Math.PI / 2)
  p.put('furniture', 'cabinet_medium_decorated', 12.4, -2.6, 0)

  // кулер — центр карты, зона режима «Кулер»
  const cooler = { x: 1, z: 1, radius: 2.4 }
  waterCooler(b, cooler.x, cooler.z, cooler.radius)

  // зелень
  for (const [x, z, n] of [
    [-19, 13.2, 'A'], [-7.8, 13.3, 'B'], [8.4, 13.2, 'A'], [-11.6, -13.4, 'B'], [3.6, -13.5, 'A'],
    [14.2, -13.4, 'B'], [-5, 2.6, 'A'], [6.6, -1.6, 'B'], [-19.2, -3.2, 'A'],
  ] as const) p.put('furniture', `cactus_medium_${n}`, x, z, rand() * 6)

  const group = b.build()
  group.add(p.group)
  return {
    group,
    colliders: b.colliders,
    spawns,
    cooler,
    bounds: { minX: -W, maxX: W, minZ: -D, maxZ: D },
    sunDir: new THREE.Vector3(-0.35, 0.75, -0.55).normalize(),
  }
}

// ======================= элементы =======================

/** Стол на двоих лицом к лицу: стол и стулья KayKit, мониторы — свои */
function desk(b: StaticBuilder, p: Placer, x: number, z: number, rot: number): void {
  p.put('furniture', 'table_medium_long', x, z, rot, { shrink: 0.95 })
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
  const top = 0.72
  for (const side of [-1, 1]) {
    for (const lx of [-0.55, 0.55]) {
      // монитор у середины стола, экраном к сидящему
      const [mx, mz] = at(lx, side * 0.12)
      const face = rot + (side < 0 ? Math.PI : 0)
      b.rbox(0.62, 0.38, 0.05, 0.02, mx, top + 0.14, mz, 'plastic', C.ink, { rotY: face })
      const [sx, sz] = at(lx, side * 0.12 - side * 0.03)
      b.box(0.56, 0.32, 0.004, sx, top + 0.17, sz, 'screen', 0xffffff, { rotY: face })
      const [nx, nz] = at(lx, side * 0.14)
      b.box(0.06, 0.14, 0.04, nx, top, nz, 'metal', C.frame, { rotY: face })
      const [kx, kz] = at(lx, side * 0.42)
      b.rbox(0.42, 0.02, 0.14, 0.008, kx, top, kz, 'plastic', C.white, { rotY: face })
      // стул
      const [cx, cz] = at(lx + (rand() - 0.5) * 0.2, side * 1.05)
      p.put('furniture', 'chair_C', cx, cz, face + Math.PI + (rand() - 0.5) * 0.5, { collide: false })
    }
  }
  if (rand() < 0.6) {
    const [lx, lz] = at(1.25, (rand() - 0.5) * 0.6)
    p.put('furniture', 'lamp_table', lx, lz, rand() * 6, { y: top, scale: 0.6, collide: false })
  }
  if (rand() < 0.6) {
    const [bx, bz] = at(-1.2, (rand() - 0.5) * 0.4)
    p.put('furniture', 'book_set', bx, bz, rot + rand(), { y: top + 0.18 * 0.72, scale: 0.8, collide: false })
  }
  if (rand() < 0.5) {
    const [cx, cz] = at(0, (rand() - 0.5) * 0.3)
    p.put('furniture', rand() < 0.5 ? 'cactus_small_A' : 'cactus_small_B', cx, cz, rand() * 6, { y: top, collide: false })
  }
}

function lowWall(b: StaticBuilder, axis: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][]): void {
  const H = 0.55, T = 0.36
  for (const [s0, s1] of segments(a, c, gaps)) {
    const len = s1 - s0, mid = (s0 + s1) / 2
    if (axis === 'x') {
      b.box(len, H, T, mid, 0, at, 'paint', C.lowWall, { collide: true })
      b.box(len, 0.06, T + 0.04, mid, H, at, 'paint', C.lowTop)
    } else {
      b.box(T, H, len, at, 0, mid, 'paint', C.lowWall, { collide: true })
      b.box(T + 0.04, 0.06, len, at, H, mid, 'paint', C.lowTop)
    }
  }
}

function glassWall(b: StaticBuilder, axis: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][]): void {
  for (const [s0, s1] of segments(a, c, gaps)) {
    const len = s1 - s0, mid = (s0 + s1) / 2
    const posts = Math.max(1, Math.round(len / 1.6))
    if (axis === 'x') {
      b.box(len, 2.5, 0.03, mid, 0.05, at, 'glass', C.glass, { collide: true })
      b.box(len, 0.06, 0.09, mid, 0, at, 'metal', C.frame)
      b.box(len, 0.06, 0.09, mid, 2.55, at, 'metal', C.frame)
      for (let i = 0; i <= posts; i++) b.box(0.06, 2.6, 0.09, s0 + (len * i) / posts, 0, at, 'metal', C.frame)
    } else {
      b.box(0.03, 2.5, len, at, 0.05, mid, 'glass', C.glass, { collide: true })
      b.box(0.09, 0.06, len, at, 0, mid, 'metal', C.frame)
      b.box(0.09, 0.06, len, at, 2.55, mid, 'metal', C.frame)
      for (let i = 0; i <= posts; i++) b.box(0.09, 2.6, 0.06, at, 0, s0 + (len * i) / posts, 'metal', C.frame)
    }
  }
}

function segments(a: number, c: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let cur = a
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > cur) out.push([cur, g0])
    cur = Math.max(cur, g1)
  }
  if (cur < c) out.push([cur, c])
  return out
}

function serverRoom(b: StaticBuilder): void {
  b.rbox(5, 0.015, 8.4, 0.2, 17.6, 0, 1.6, 'matte', 0xdcd6ef)
  b.box(0.08, 0.018, 7.8, 15.3, 0, 1.6, 'matte', C.sign)
  for (let i = 0; i < 5; i++) {
    const z = -1.6 + i * 1.3
    rack(b, 19.1, z)
    if (i % 2 === 0) rack(b, 16.7, z + 0.4)
  }
}

function rack(b: StaticBuilder, x: number, z: number): void {
  b.rbox(0.8, 2.0, 0.9, 0.06, x, 0, z, 'plastic', C.rack, { collide: true })
  for (let i = 0; i < 7; i++) {
    const y = 0.25 + i * 0.24
    b.rbox(0.64, 0.15, 0.03, 0.02, x - 0.41, y, z, 'plastic', C.rackFront, { rotY: Math.PI / 2 })
    for (let k = 0; k < 3; k++) {
      const c = rand()
      b.box(0.012, 0.03, 0.03, x - 0.43, y + 0.06, z - 0.22 + rand() * 0.44, 'light', c < 0.7 ? C.ledG : c < 0.85 ? C.ledB : C.ledR)
    }
  }
}

function waterCooler(b: StaticBuilder, x: number, z: number, radius: number): void {
  b.cylinder(radius, radius, 0.014, x, 0, z, 'matte', C.zone, { segments: 48 })
  b.cylinder(radius - 0.15, radius - 0.15, 0.016, x, 0, z, 'matte', C.zoneIn, { segments: 48 })
  b.rbox(0.46, 1.0, 0.46, 0.06, x, 0, z, 'plastic', C.white, { collide: true })
  b.rbox(0.06, 0.06, 0.1, 0.02, x - 0.09, 0.72, z + 0.26, 'plastic', 0x6fa8ff)
  b.rbox(0.06, 0.06, 0.1, 0.02, x + 0.09, 0.72, z + 0.26, 'plastic', 0xff7a8a)
  b.cylinder(0.2, 0.21, 0.52, x, 1.0, z, 'glass', C.cooler, { segments: 24 })
  b.cylinder(0.18, 0.19, 0.44, x, 1.02, z, 'plastic', 0xb8e4ff, { segments: 24 })
  b.cylinder(0.06, 0.18, 0.1, x, 1.52, z, 'plastic', 0xb8e4ff, { segments: 24 })
  b.cylinder(0.045, 0.045, 0.26, x + 0.32, 0.55, z, 'plastic', C.white, { segments: 12 })
}

/** Лифт: створки, рамка, табло. На северной/западной стене — в проёме стены KayKit */
function elevator(b: StaticBuilder, x: number, z: number, rot: number): Spawn {
  const dx = Math.sin(rot), dz = Math.cos(rot)
  const px = -dz, pz = dx
  const fx = x + dx * 0.2, fz = z + dz * 0.2
  const h = 2.3
  b.rbox(0.18, h + 0.18, 0.2, 0.04, fx + px * 0.95, 0, fz + pz * 0.95, 'metal', C.steel, { rotY: rot })
  b.rbox(0.18, h + 0.18, 0.2, 0.04, fx - px * 0.95, 0, fz - pz * 0.95, 'metal', C.steel, { rotY: rot })
  b.rbox(2.08, 0.18, 0.2, 0.04, fx, h, fz, 'metal', C.steel, { rotY: rot })
  b.box(0.86, h, 0.05, fx + px * 0.44, 0, fz + pz * 0.44, 'metal', 0xc7cbe0, { rotY: rot })
  b.box(0.86, h, 0.05, fx - px * 0.44, 0, fz - pz * 0.44, 'metal', 0xc7cbe0, { rotY: rot })
  b.box(0.015, h, 0.06, fx, 0, fz, 'metal', C.ink, { rotY: rot })
  b.rbox(0.5, 0.14, 0.03, 0.02, fx + dx * 0.11, h + 0.24, fz + dz * 0.11, 'light', C.sign, { rotY: rot })
  b.rbox(2.2, 0.015, 1.2, 0.05, fx + dx * 0.75, 0, fz + dz * 0.75, 'fabric', 0x9aa3cf, { rotY: rot })
  b.blocker(fx, fz, Math.abs(px) * 2.2 + Math.abs(dx) * 0.4, Math.abs(pz) * 2.2 + Math.abs(dz) * 0.4)
  return { x: fx + dx * 1.6, z: fz + dz * 1.6, rot }
}
