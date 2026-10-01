import * as THREE from 'three'
import { StaticBuilder, type AABB, type Kind } from './builder'

export interface Spawn { x: number; z: number; rot: number }

export interface Office {
  group: THREE.Group
  colliders: AABB[]
  spawns: Spawn[]
  cooler: { x: number; z: number; radius: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** направление солнца (откуда светит) для теней от окон */
  sunDir: THREE.Vector3
}

// Детерминированный генератор: у всех игроков одинаковая расстановка мелочей
let seed = 1337
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Палитра: светлый современный офис
const P = {
  // пастель: светлые стены, мягкие акценты, тёмный не чёрный, а сливово-синий
  wall: 0xf3eee8, wallDark: 0xb9b3d6, skirt: 0xe7dfee,
  white: 0xfbf8f4, black: 0x4a4e6e, graphite: 0x6a6f8e, steel: 0xc9cbe0,
  acoustic: 0x9fb4d8, chair: 0x7f8bb8, leather: 0xf2a68b, sofaFabric: 0xa8d5c8,
  plantPot: 0xfbf3ea, plantPot2: 0xe9b8c8, leaf: 0x7fbf8e, leaf2: 0x9fd39a,
  sky: 0xfff6ec, cooler: 0x9ad8ff, ledG: 0x7dffb0, ledR: 0xff8fa3, ledB: 0x8fc4ff,
  rug: 0xc9b8e0, rugLounge: 0xf6d9c8, warn: 0xffd27a,
}

const W = 20 // полуширина по X
const D = 15 // полуглубина по Z
const WALL_H = 3.2
const SKIRT_H = 0.5
const T = 0.25

export function buildOffice(): Office {
  seed = 1337
  carpetIdx = 0
  const b = new StaticBuilder()

  // ---------- пол ----------
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, 'tile', 0xf4eef6)
  carpet(b, -4, -8.5, 12, 8) // open-space A
  carpet(b, 11, -8.5, 10, 8) // open-space B
  carpet(b, -13, 6.5, 10, 9) // open-space C
  carpet(b, -16, -10.5, 7, 8) // переговорка

  // ---------- стены ----------
  northWallWithWindows(b)
  westWall(b)
  lowWall(b, 'x', D, -W, W, [[-7.4, -4.6]])
  lowWall(b, 'z', W, -D, D, [[-9, -6]])

  // ---------- зоны ----------
  meetingRoom(b)
  deskBench(b, -4, -9.2, 0, 3)
  deskBench(b, 11, -9.2, 0, 3)
  deskBench(b, -13, 6.5, Math.PI / 2, 3)
  serverRoom(b)
  kitchen(b)
  lounge(b, 1, 9)

  // колонны — укрытия у центра
  column(b, -6, 0.5)
  column(b, 8, 0.5)

  // акустические перегородки — укрытия
  acoustic(b, -2.5, -3, 3.6, 0)
  acoustic(b, 12, -3, 3.6, 0)
  acoustic(b, -8, 4, 3, Math.PI / 2)
  acoustic(b, 6.5, 4.4, 2.6, Math.PI / 2)

  const cooler = { x: 1, z: 1, radius: 2.4 }
  waterCooler(b, cooler.x, cooler.z, cooler.radius)

  // лифты — по одному на игрока: точки появления и цели режима «Документы»
  const spawns: Spawn[] = [
    elevator(b, 1.5, -D, 0),
    elevator(b, -W, -2, Math.PI / 2),
    elevator(b, -6, D, Math.PI),
    elevator(b, W, -7.5, -Math.PI / 2),
  ]

  // растения и мелочи
  for (const [x, z, s] of [
    [-11.2, -13.9, 1.1], [3.6, -13.9, 1], [18.6, -13.8, 1.15], [-18.8, 13.8, 1.1],
    [-3.6, 13.6, 0.9], [8.6, 13.7, 1], [-7.2, -3.4, 0.8], [17.2, 1.2, 0.95],
  ] as const) plant(b, x, z, s)
  copier(b, 6.6, -13.9)
  copier(b, -18.9, 1.6, Math.PI / 2)
  boxes(b, 18.4, -11.4)
  whiteboard(b, -W + T / 2, 9, Math.PI / 2)

  return {
    group: b.build(),
    colliders: b.colliders,
    spawns,
    cooler,
    bounds: { minX: -W, maxX: W, minZ: -D, maxZ: D },
    sunDir: new THREE.Vector3(-0.35, 0.72, -0.6).normalize(),
  }
}

// ======================= стены =======================

const WINDOWS = [-17.5, -13.7, -9.9, -6.1, -2.3, 5.3, 9.1, 12.9, 16.7]
const WIN_W = 2.7
const SILL = 0.85
const HEAD = 2.75

function northWallWithWindows(b: StaticBuilder): void {
  const z = -D
  // низ под окнами и верх над окнами по всей длине
  b.box(W * 2, SILL, T, 0, 0, z, 'paint', P.wall, { collide: true })
  b.box(W * 2, WALL_H - HEAD, T, 0, HEAD, z, 'paint', P.wall)
  // простенки между окнами
  const edges: number[] = [-W]
  for (const x of WINDOWS) edges.push(x - WIN_W / 2, x + WIN_W / 2)
  edges.push(W)
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], c = edges[i + 1]
    if (c - a > 0.01) b.box(c - a, HEAD - SILL, T, (a + c) / 2, SILL, z, 'paint', P.wall)
  }
  for (const x of WINDOWS) {
    // рама, импост, стекло
    b.box(WIN_W, 0.06, T + 0.04, x, SILL, z, 'metal', P.graphite)
    b.box(WIN_W, 0.06, T + 0.04, x, HEAD - 0.06, z, 'metal', P.graphite)
    b.box(0.05, HEAD - SILL, T + 0.04, x - WIN_W / 2 + 0.025, SILL, z, 'metal', P.graphite)
    b.box(0.05, HEAD - SILL, T + 0.04, x + WIN_W / 2 - 0.025, SILL, z, 'metal', P.graphite)
    b.box(0.05, HEAD - SILL, 0.08, x, SILL, z, 'metal', P.graphite)
    b.box(WIN_W, HEAD - SILL, 0.02, x, SILL, z - 0.04, 'glass', 0xdff0ff)
    // подоконник
    b.box(WIN_W + 0.1, 0.04, 0.3, x, SILL, z + 0.2, 'paint', P.white)
    // жалюзи: верхняя треть опущена, ламели под углом — дают полосатый свет
    for (let s = 0; s < 9; s++) {
      b.box(WIN_W - 0.12, 0.012, 0.06, x, HEAD - 0.18 - s * 0.075, z + 0.14, 'plastic', P.white, { rotX: 0.5 })
    }
    b.box(WIN_W - 0.06, 0.06, 0.08, x, HEAD - 0.12, z + 0.14, 'plastic', P.white)
  }
  // яркое «небо» за окнами
  b.box(W * 2, WALL_H, 0.05, 0, 0, z - 1.2, 'light', P.sky)
  // плинтус
  b.box(W * 2, 0.08, 0.03, 0, 0, z + T / 2 + 0.015, 'matte', P.graphite)
}

function westWall(b: StaticBuilder): void {
  const x = -W
  wallZ(b, x, -D, D, WALL_H, [[-3.3, -0.7]])
  b.box(0.03, 0.08, D * 2, x + T / 2 + 0.015, 0, 0, 'matte', P.graphite)
  // деревянные реечные панели
  for (const zc of [4.6, 12.4]) {
    for (let i = 0; i < 16; i++) {
      b.box(0.05, 2.5, 0.08, x + T / 2 + 0.04, 0.25, zc - 1.2 + i * 0.16, 'darkwood', 0xffffff)
    }
  }
}

function wallZ(b: StaticBuilder, x: number, z0: number, z1: number, h: number, gaps: [number, number][], kind: Kind = 'paint', hex = P.wall): void {
  for (const [a, c] of segments(z0, z1, gaps)) b.box(T, h, c - a, x, 0, (a + c) / 2, kind, hex, { collide: true })
}

function wallX(b: StaticBuilder, z: number, x0: number, x1: number, h: number, gaps: [number, number][], kind: Kind = 'paint', hex = P.wall): void {
  for (const [a, c] of segments(x0, x1, gaps)) b.box(c - a, h, T, (a + c) / 2, 0, z, kind, hex, { collide: true })
}

/** Ближние к камере стены — низкий бортик, чтобы не загораживать (срез, как в изометрических играх) */
function lowWall(b: StaticBuilder, axis: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][]): void {
  if (axis === 'x') wallX(b, at, a, c, SKIRT_H, gaps, 'paint', P.skirt)
  else wallZ(b, at, a, c, SKIRT_H, gaps, 'paint', P.skirt)
  for (const [s0, s1] of segments(a, c, gaps)) {
    if (axis === 'x') b.box(s1 - s0, 0.04, T + 0.06, (s0 + s1) / 2, SKIRT_H, at, 'darkwood')
    else b.box(T + 0.06, 0.04, s1 - s0, at, SKIRT_H, (s0 + s1) / 2, 'darkwood')
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

// ======================= зоны =======================

const CARPETS = [0xc7d3f0, 0xf2c9d4, 0xcfe8d6, 0xe3d4f2]
let carpetIdx = 0
function carpet(b: StaticBuilder, x: number, z: number, w: number, d: number): void {
  b.box(w, 0.012, d, x, 0, z, 'carpet', CARPETS[carpetIdx++ % CARPETS.length])
}

function meetingRoom(b: StaticBuilder): void {
  // стеклянные стены в чёрных рамах
  glassWall(b, 'z', -12.2, -D, -6.2, [[-8.8, -7.2]])
  glassWall(b, 'x', -6.2, -W, -12.2, [[-16.6, -15]])
  // длинный стол
  b.box(5, 0.05, 1.5, -16, 0.74, -10.6, 'wood', 0xffffff, { collide: true })
  b.box(0.08, 0.74, 1.2, -18.2, 0, -10.6, 'metal', P.black)
  b.box(0.08, 0.74, 1.2, -13.8, 0, -10.6, 'metal', P.black)
  for (let i = 0; i < 4; i++) {
    const x = -17.7 + i * 1.15
    officeChair(b, x, -11.75, 0)
    officeChair(b, x, -9.45, Math.PI)
    if (rand() < 0.6) b.box(0.32, 0.015, 0.24, x, 0.79, -10.9 + rand() * 0.6, 'plastic', P.graphite) // ноутбук
  }
  // большой экран на западной стене
  b.box(0.06, 1.1, 1.9, -W + T / 2 + 0.05, 1.15, -10.6, 'plastic', P.black)
  b.box(0.02, 1.0, 1.8, -W + T / 2 + 0.09, 1.2, -10.6, 'screen')
  plant(b, -13, -14.2, 0.8)
}

function glassWall(b: StaticBuilder, axis: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][]): void {
  for (const [s0, s1] of segments(a, c, gaps)) {
    const len = s1 - s0, mid = (s0 + s1) / 2
    if (axis === 'x') {
      b.box(len, 2.6, 0.03, mid, 0.04, at, 'glass', 0xe6f4ff, { collide: true })
      b.box(len, 0.05, 0.08, mid, 0, at, 'metal', P.black)
      b.box(len, 0.05, 0.08, mid, 2.64, at, 'metal', P.black)
      for (let p = s0; p <= s1 + 0.01; p += len / Math.max(1, Math.round(len / 1.6))) b.box(0.05, 2.68, 0.08, p, 0, at, 'metal', P.black)
      b.box(len, 0.12, 0.035, mid, 1.15, at, 'plastic', 0xffffff) // матовая полоса
    } else {
      b.box(0.03, 2.6, len, at, 0.04, mid, 'glass', 0xe6f4ff, { collide: true })
      b.box(0.08, 0.05, len, at, 0, mid, 'metal', P.black)
      b.box(0.08, 0.05, len, at, 2.64, mid, 'metal', P.black)
      for (let p = s0; p <= s1 + 0.01; p += len / Math.max(1, Math.round(len / 1.6))) b.box(0.08, 2.68, 0.05, at, 0, p, 'metal', P.black)
      b.box(0.035, 0.12, len, at, 1.15, mid, 'plastic', 0xffffff)
    }
  }
}

/** Ряд столов «лицом к лицу» с акустической перегородкой посередине */
function deskBench(b: StaticBuilder, cx: number, cz: number, rot: number, perSide: number): void {
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const at = (lx: number, lz: number): [number, number] => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos]
  const DW = 1.45, DD = 0.78
  const len = perSide * DW
  for (let i = 0; i < perSide; i++) {
    const lx = -len / 2 + DW / 2 + i * DW
    for (const side of [-1, 1]) {
      const lz = side * (DD / 2 + 0.02)
      desk(b, ...at(lx, lz), rot + (side < 0 ? 0 : Math.PI))
      const [chx, chz] = at(lx + (rand() - 0.5) * 0.3, side * (DD + 0.45))
      officeChair(b, chx, chz, rot + (side < 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.6)
    }
  }
  // белые ноги-рамы
  for (let i = 0; i <= perSide; i++) {
    const [x, z] = at(-len / 2 + i * DW, 0)
    b.box(0.05, 0.72, DD * 2 - 0.1, x, 0, z, 'metal', P.white, { rotY: rot })
  }
  // перегородка-экран
  const [px, pz] = at(0, 0)
  b.rbox(len, 0.45, 0.05, 0.02, px, 0.76, pz, 'fabric', P.acoustic, { rotY: rot })
  // препятствие
  const ac = Math.abs(cos), as = Math.abs(sin)
  b.blocker(cx, cz, len * ac + (DD * 2 + 0.05) * as, len * as + (DD * 2 + 0.05) * ac)
}

/** Стол: lx — центр, rot — сидящий смотрит в -z локально, стол «смотрит» на него */
function desk(b: StaticBuilder, x: number, z: number, rot: number): void {
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
  b.box(1.42, 0.035, 0.76, x, 0.72, z, 'wood', 0xffffff, { rotY: rot })
  // монитор у дальнего края
  const [mx, mz] = at(0, 0.22)
  b.box(0.2, 0.012, 0.16, mx, 0.755, mz, 'metal', P.graphite, { rotY: rot })
  const [nx, nz] = at(0, 0.25)
  b.box(0.04, 0.24, 0.03, nx, 0.755, nz, 'metal', P.graphite, { rotY: rot })
  b.box(0.62, 0.37, 0.025, mx, 0.9, mz, 'plastic', P.black, { rotY: rot })
  const [sx, sz] = at(0, 0.205)
  b.box(0.58, 0.33, 0.004, sx, 0.92, sz, 'screen', 0xffffff, { rotY: rot })
  // клавиатура, мышь
  const [kx, kz] = at(-0.05, -0.1)
  b.rbox(0.42, 0.018, 0.13, 0.006, kx, 0.755, kz, 'plastic', P.white, { rotY: rot })
  const [ux, uz] = at(0.32, -0.08)
  b.rbox(0.06, 0.02, 0.1, 0.01, ux, 0.755, uz, 'plastic', P.white, { rotY: rot })
  // настольная лампа (будущее оружие!)
  if (rand() < 0.45) {
    const [lx, lz] = at(-0.55, 0.22)
    b.cylinder(0.07, 0.08, 0.02, lx, 0.755, lz, 'metal', P.black)
    b.box(0.015, 0.34, 0.015, lx, 0.77, lz, 'metal', P.black, { rotZ: 0.25 })
    b.cylinder(0.03, 0.07, 0.09, lx + 0.05, 1.04, lz, 'metal', P.black)
  }
  // кружка, бумаги, степлер
  if (rand() < 0.6) {
    const [cx, cz] = at(0.5, -0.05)
    b.cylinder(0.04, 0.035, 0.095, cx, 0.755, cz, 'plastic', [0xe8505b, 0xffffff, 0x3d8bfd, 0x2bb673][Math.floor(rand() * 4)], { segments: 12 })
  }
  if (rand() < 0.5) {
    const [px, pz] = at(-0.45, -0.12)
    b.box(0.22, 0.02 + rand() * 0.06, 0.3, px, 0.755, pz, 'matte', 0xffffff, { rotY: rot + (rand() - 0.5) * 0.4 })
  }
  // тумба
  const [tx, tz] = at(0.5, 0.05)
  b.rbox(0.4, 0.58, 0.55, 0.02, tx, 0, tz, 'plastic', P.white, { rotY: rot })
}

function officeChair(b: StaticBuilder, x: number, z: number, rot: number): void {
  // крестовина и газлифт
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    b.box(0.03, 0.025, 0.3, x + Math.sin(a) * 0.14, 0.05, z + Math.cos(a) * 0.14, 'metal', P.black, { rotY: a })
    b.sphere(0.025, x + Math.sin(a) * 0.28, 0.03, z + Math.cos(a) * 0.28, 'plastic', P.black)
  }
  b.cylinder(0.025, 0.025, 0.36, x, 0.06, z, 'chrome', P.steel, { segments: 8 })
  // сиденье и спинка
  b.rbox(0.48, 0.08, 0.46, 0.035, x, 0.44, z, 'fabric', P.chair, { rotY: rot })
  const bx = x - Math.sin(rot) * 0.24, bz = z - Math.cos(rot) * 0.24
  b.rbox(0.46, 0.55, 0.06, 0.03, bx, 0.6, bz, 'fabric', P.chair, { rotY: rot, rotX: 0 })
  b.box(0.04, 0.3, 0.04, bx, 0.44, bz, 'metal', P.black, { rotY: rot })
}

function acoustic(b: StaticBuilder, x: number, z: number, len: number, rot: number): void {
  b.rbox(len, 1.35, 0.08, 0.03, x, 0.04, z, 'fabric', P.acoustic, { rotY: rot, collide: true })
  const c = Math.cos(rot), s = Math.sin(rot)
  for (const e of [-1, 1]) b.box(0.05, 0.04, 0.4, x + c * e * (len / 2 - 0.2), 0, z - s * e * (len / 2 - 0.2), 'metal', P.graphite, { rotY: rot })
}

function column(b: StaticBuilder, x: number, z: number): void {
  b.box(0.7, WALL_H, 0.7, x, 0, z, 'paint', P.wall, { collide: true })
  b.box(0.74, 0.08, 0.74, x, 0, z, 'matte', P.graphite)
}

function serverRoom(b: StaticBuilder): void {
  const x0 = 15
  wallZ(b, x0, -2.2, 6.2, 2.8, [[0.2, 1.8]], 'paint', P.wallDark)
  wallX(b, -2.2, x0, W, 2.8, [], 'paint', P.wallDark)
  b.box(W - x0, 0.015, 8.4, (x0 + W) / 2, 0, 2, 'matte', 0xd9d4ec)
  for (let i = 0; i < 5; i++) {
    const z = -1.3 + i * 1.3
    rack(b, 19, z)
    if (i % 2 === 0) rack(b, 16.6, z + 0.4)
  }
  // жёлтая разметка на полу
  b.box(0.08, 0.016, 7.6, 17.8, 0, 2, 'matte', P.warn)
}

function rack(b: StaticBuilder, x: number, z: number): void {
  b.rbox(0.8, 2.1, 0.9, 0.02, x, 0, z, 'metal', 0x8d93b8, { collide: true })
  for (let i = 0; i < 8; i++) {
    const y = 0.2 + i * 0.23
    b.box(0.66, 0.16, 0.02, x, y, z + 0.455, 'plastic', 0x777da3)
    for (let k = 0; k < 3; k++) {
      const c = rand()
      b.box(0.03, 0.03, 0.01, x - 0.25 + rand() * 0.5, y + 0.06, z + 0.468, 'light', c < 0.7 ? P.ledG : c < 0.85 ? P.ledB : P.ledR)
    }
  }
}

function kitchen(b: StaticBuilder): void {
  // кухонный гарнитур вдоль восточной стены
  b.box(0.7, 0.88, 5.6, 19.4, 0, 11.6, 'plastic', 0xa9c7e8, { collide: true })
  b.box(0.74, 0.05, 5.7, 19.4, 0.88, 11.6, 'marble')
  b.rbox(0.75, 2.0, 0.8, 0.04, 19.4, 0, 8.2, 'metal', 0xd7dbe0, { collide: true }) // холодильник
  b.rbox(0.4, 0.42, 0.36, 0.03, 19.4, 0.93, 12.6, 'plastic', P.black) // кофемашина
  b.cylinder(0.05, 0.04, 0.1, 19.2, 0.93, 13.2, 'plastic', 0xffffff, { segments: 12 })
  // остров: дерево + мрамор, как в хороших офисах
  b.box(3.2, 0.9, 1.1, 14, 0, 11.5, 'darkwood', 0xffffff, { collide: true })
  b.box(3.4, 0.05, 1.3, 14, 0.9, 11.5, 'marble')
  for (let i = 0; i < 4; i++) {
    const x = 12.9 + i * 0.75
    b.cylinder(0.18, 0.18, 0.05, x, 0.72, 12.55, 'leather', P.leather)
    b.cylinder(0.02, 0.02, 0.72, x, 0, 12.55, 'chrome', P.steel, { segments: 8 })
    b.cylinder(0.14, 0.14, 0.01, x, 0.25, 12.55, 'chrome', P.steel)
  }
  b.cylinder(0.12, 0.1, 0.06, 13.6, 0.95, 11.4, 'plastic', 0xffffff) // миска
  for (let i = 0; i < 3; i++) b.sphere(0.04, 13.55 + i * 0.05, 1.03, 11.4 + (i % 2) * 0.05, 'plastic', [0xe8505b, 0xf5b700, 0x7fbf3f][i])
}

function lounge(b: StaticBuilder, x: number, z: number): void {
  b.box(5.6, 0.012, 3.8, x, 0.005, z, 'fabric', P.rugLounge)
  sofa(b, x - 1.6, z, Math.PI / 2)
  sofa(b, x + 1.6, z, -Math.PI / 2)
  // журнальный столик
  b.box(1.2, 0.04, 0.7, x, 0.38, z, 'wood', 0xffffff, { collide: true })
  b.box(1.1, 0.38, 0.6, x, 0, z, 'metal', P.black)
  b.box(0.3, 0.02, 0.22, x - 0.2, 0.42, z + 0.1, 'matte', 0xd9534f, { rotY: 0.3 })
}

/** [x, z] + высота → аргументы (x, y, z) */
function xyz([x, z]: [number, number], y: number): [number, number, number] {
  return [x, y, z]
}

function sofa(b: StaticBuilder, x: number, z: number, rot: number): void {
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
  b.rbox(2.2, 0.38, 0.9, 0.08, x, 0.06, z, 'leather', P.leather, { rotY: rot, collide: true })
  b.rbox(2.2, 0.45, 0.22, 0.08, ...xyz(at(0, -0.36), 0.4), 'leather', P.leather, { rotY: rot })
  b.rbox(0.2, 0.25, 0.9, 0.07, ...xyz(at(-1.0, 0), 0.4), 'leather', P.leather, { rotY: rot })
  b.rbox(0.2, 0.25, 0.9, 0.07, ...xyz(at(1.0, 0), 0.4), 'leather', P.leather, { rotY: rot })
  for (const lx of [-0.5, 0.5]) b.rbox(0.92, 0.12, 0.62, 0.05, ...xyz(at(lx, 0.08), 0.44), 'leather', P.leather, { rotY: rot })
  for (const lx of [-0.95, 0.95]) for (const lz of [-0.35, 0.35]) b.box(0.05, 0.06, 0.05, ...xyz(at(lx, lz), 0), 'metal', P.black, { rotY: rot })
}

function waterCooler(b: StaticBuilder, x: number, z: number, radius: number): void {
  // круглая зона на полу
  b.cylinder(radius, radius, 0.014, x, 0, z, 'matte', 0xa8e6d6, { segments: 48 })
  b.cylinder(radius - 0.15, radius - 0.15, 0.016, x, 0, z, 'matte', 0xc6f0e4, { segments: 48 })
  b.rbox(0.42, 1.0, 0.42, 0.04, x, 0, z, 'plastic', 0xf4f4f4, { collide: true })
  b.box(0.05, 0.05, 0.1, x - 0.08, 0.72, z + 0.24, 'plastic', 0x3d8bfd)
  b.box(0.05, 0.05, 0.1, x + 0.08, 0.72, z + 0.24, 'plastic', 0xe8505b)
  b.cylinder(0.19, 0.2, 0.5, x, 1.0, z, 'glass', P.cooler, { segments: 20 })
  b.cylinder(0.17, 0.18, 0.42, x, 1.02, z, 'plastic', 0x9fd8ff, { segments: 20 })
  b.cylinder(0.06, 0.17, 0.1, x, 1.5, z, 'glass', P.cooler, { segments: 20 })
  // стаканчики
  b.cylinder(0.04, 0.04, 0.25, x + 0.3, 0.6, z, 'plastic', 0xffffff, { segments: 10 })
}

function elevator(b: StaticBuilder, x: number, z: number, rot: number): Spawn {
  const dx = Math.sin(rot), dz = Math.cos(rot)
  const px = -dz, pz = dx
  const inset = T / 2 + 0.05
  const fx = x + dx * inset, fz = z + dz * inset
  const h = 2.5
  // ниша и портал
  b.box(0.22, h + 0.2, 0.22, fx + px * 1.3, 0, fz + pz * 1.3, 'chrome', 0xd0d4d9, { rotY: rot, collide: true })
  b.box(0.22, h + 0.2, 0.22, fx - px * 1.3, 0, fz - pz * 1.3, 'chrome', 0xd0d4d9, { rotY: rot, collide: true })
  b.box(2.82, 0.2, 0.22, fx, h, fz, 'chrome', 0xd0d4d9, { rotY: rot })
  b.box(1.18, h - 0.02, 0.05, fx + px * 0.6, 0, fz + pz * 0.6, 'metal', 0xc2c8cf, { rotY: rot })
  b.box(1.18, h - 0.02, 0.05, fx - px * 0.6, 0, fz - pz * 0.6, 'metal', 0xc2c8cf, { rotY: rot })
  b.box(0.012, h - 0.04, 0.06, fx, 0, fz, 'metal', P.black, { rotY: rot })
  // табло и кнопка
  b.box(0.6, 0.14, 0.03, fx + dx * 0.12, h + 0.28, fz + dz * 0.12, 'light', 0xffc861, { rotY: rot })
  b.box(0.08, 0.16, 0.03, fx + px * 1.55 + dx * 0.1, 1.15, fz + pz * 1.55 + dz * 0.1, 'light', 0xffffff, { rotY: rot })
  // коврик
  b.rbox(2.4, 0.015, 1.3, 0.01, fx + dx * 0.8, 0, fz + dz * 0.8, 'fabric', 0x9aa3cf, { rotY: rot })
  b.blocker(fx, fz, Math.abs(px) * 2.8 + Math.abs(dx) * 0.4, Math.abs(pz) * 2.8 + Math.abs(dz) * 0.4)
  return { x: fx + dx * 1.7, z: fz + dz * 1.7, rot }
}

// ======================= мелочи =======================

function plant(b: StaticBuilder, x: number, z: number, s = 1): void {
  const tall = s >= 1
  b.cylinder(0.26 * s, 0.2 * s, 0.5 * s, x, 0, z, 'matte', rand() < 0.5 ? P.plantPot : P.plantPot2, { collide: true, segments: 18 })
  b.cylinder(0.24 * s, 0.24 * s, 0.02, x, 0.48 * s, z, 'matte', 0x9c7f6a, { segments: 18 })
  if (tall) b.cylinder(0.02, 0.025, 1.0 * s, x, 0.5 * s, z, 'darkwood', 0xffffff, { segments: 6 })
  // листья: сплюснутые эллипсоиды под разными углами
  const n = tall ? 16 : 11
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2
    const h = (tall ? 0.75 + rand() * 0.9 : 0.55 + rand() * 0.35) * s
    const r = (tall ? 0.18 + rand() * 0.22 : 0.12 + rand() * 0.18) * s
    const g = new THREE.SphereGeometry(0.16 * s, 8, 6)
    g.scale(0.55, 0.08, 1.25)
    g.rotateX(-0.5 - rand() * 0.5)
    g.rotateY(a)
    b.geo(g, x + Math.sin(a) * r, h, z + Math.cos(a) * r, 'foliage', rand() < 0.5 ? P.leaf : P.leaf2)
  }
}

function copier(b: StaticBuilder, x: number, z: number, rot = 0): void {
  b.rbox(1.0, 0.95, 0.7, 0.03, x, 0, z, 'plastic', 0xe9e9e6, { rotY: rot, collide: true })
  b.rbox(0.9, 0.12, 0.6, 0.02, x, 0.95, z, 'plastic', 0xd5d5d2, { rotY: rot })
  b.box(0.3, 0.02, 0.18, x + 0.2, 1.08, z, 'light', 0x8fd3ff, { rotY: rot })
  b.box(0.5, 0.02, 0.32, x - 0.15, 1.07, z, 'matte', 0xffffff, { rotY: rot + 0.1 })
}

function boxes(b: StaticBuilder, x: number, z: number): void {
  b.rbox(0.7, 0.5, 0.7, 0.02, x, 0, z, 'matte', 0xc9a26b, { collide: true })
  b.rbox(0.55, 0.4, 0.55, 0.02, x + 0.05, 0.5, z, 'matte', 0xbf9862, { rotY: 0.4 })
  b.rbox(0.6, 0.45, 0.6, 0.02, x - 0.1, 0, z + 0.75, 'matte', 0xd1ad78, { collide: true, rotY: 0.2 })
}

function whiteboard(b: StaticBuilder, x: number, z: number, rot: number): void {
  b.box(2.2, 1.2, 0.04, x + 0.03, 1.0, z, 'plastic', 0xfafafa, { rotY: rot })
  b.box(2.26, 0.04, 0.08, x + 0.05, 1.0, z, 'metal', P.steel, { rotY: rot })
  // каракули маркером
  for (let i = 0; i < 6; i++) b.box(0.3 + rand() * 0.8, 0.02, 0.005, x + 0.06, 1.3 + i * 0.13, z - 0.6 + rand() * 0.4, 'matte', i % 3 ? 0x3d8bfd : 0xe8505b, { rotY: rot })
}
