import * as THREE from 'three'
import { StaticBuilder, type AABB } from './builder'
import { prop, type PackName } from '../assets'
import { MV } from './palette'

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

// Цвета геометрии — только из палитры Monument Valley
const C = {
  floor: MV.cream, floorAlt: MV.creamLight,
  lowWall: MV.teal, lowTop: MV.cream,
  carpetA: MV.lilac, carpetB: MV.blush, carpetC: MV.mint, carpetMeet: MV.sky, carpetBoss: MV.coral,
  ink: MV.indigo, glass: 0xeaf4ff, frame: MV.indigo, white: MV.white,
  rack: MV.lavender, rackFront: MV.indigo, ledG: 0x9dffc9, ledR: 0xffb3c0, ledB: 0xb3d9ff,
  cooler: 0xbfe6ff, zone: MV.mint, zoneIn: 0xc9efe3,
  steel: MV.lilac, sign: MV.mustard,
  water: 0x8fd6cf, waterLight: 0xc9f0ea, rim: MV.creamLight,
  pillar: MV.creamLight, arch: MV.coral, archAlt: MV.peach, step: MV.blush, stepSide: MV.coral,
  pot: MV.creamLight, leaf: MV.teal, leafLight: MV.mint,
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

/*
  План этажа (вид сверху, север — вверх):

   ┌ переговорка ┐  open-space «Север»  [лифт N]  open-space    ┌ кабинет Босса ┐
   │   (стекло)  │                                               │   (стекло)    │
   └─────────────┘ ═══ колоннада с арками ═══════════════════    └───────────────┘
  [лифт W]           ~~~~ бассейн ~~~~          серверная      [лифт E]
   open-space        ~ мост · КУЛЕР · мост ~
   «Запад»           ~~~~~~~~~~~~~~~~~~~~
   невозможная      ресепшен [лифт S]   лаунж          кухня
   лестница
*/
export function buildOffice(): Office {
  seed = 1337
  const b = new StaticBuilder()
  const p = new Placer(b.colliders)

  // ---------- пол: крупная плитка в два тона ----------
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, 'tile', C.floor)
  b.rbox(14, 0.015, 7.2, 0.3, -2.4, 0, -10.2, 'carpet', C.carpetA)
  b.rbox(7.4, 0.015, 7.2, 0.3, 9.4, 0, -10.2, 'carpet', C.carpetB)
  b.rbox(9.6, 0.015, 11, 0.3, -14.4, 0, 4.4, 'carpet', C.carpetC)
  b.rbox(6.8, 0.015, 6.4, 0.3, -16.6, 0, -10.9, 'carpet', C.carpetMeet)
  b.rbox(6.2, 0.015, 6.2, 0.3, 16.8, 0, -11.2, 'carpet', C.carpetBoss)

  // ---------- стены ----------
  for (let i = 0; i < 14; i++) {
    const x = -W + PIECE / 2 + i * PIECE
    const name = i === 7 ? 'wall_doorway' : i % 3 === 1 ? 'wall' : 'wall_window_open'
    p.put('kitchen', name, x, -D, 0, { collide: false })
  }
  b.blocker(0, -D, W * 2, 0.4)
  for (let i = 0; i < 10; i++) {
    const z = -D + PIECE / 2 + i * PIECE
    const name = i === 4 ? 'wall_doorway' : i % 3 === 2 ? 'wall_window_open' : 'wall'
    p.put('kitchen', name, -W, z, Math.PI / 2, { collide: false })
  }
  b.blocker(-W, 0, 0.4, D * 2)
  // «небо» за окнами — розовое свечение
  b.box(W * 2, 3, 0.05, 0, 0, -D - 0.9, 'light', 0xffe3e6)
  b.box(0.05, 3, D * 2, -W - 0.9, 0, 0, 'light', 0xffe3e6)
  lowWall(b, 'x', D, -W, W, [[-7.4, -4.6]])
  lowWall(b, 'z', W, -D, D, [[-9, -6]])

  // ---------- лифты ----------
  const spawns: Spawn[] = [
    elevator(b, -W + PIECE * 7.5, -D, 0),
    elevator(b, -W, -D + PIECE * 4.5, Math.PI / 2),
    elevator(b, -6, D, Math.PI),
    elevator(b, W, -7.5, -Math.PI / 2),
  ]

  // ---------- переговорка (СЗ) ----------
  glassWall(b, 'z', -13, -D + 0.2, -7.6, [[-9.6, -8.2]])
  glassWall(b, 'x', -7.6, -W + 0.2, -13, [[-17.4, -15.9]])
  p.put('furniture', 'table_medium_long', -16.6, -11, 0, { scale: 1.1 })
  for (let i = 0; i < 3; i++) {
    p.put('furniture', 'chair_C', -18.1 + i * 1.5, -12.6, 0, { collide: false })
    p.put('furniture', 'chair_C', -18.1 + i * 1.5, -9.4, Math.PI, { collide: false })
  }
  p.put('furniture', 'book_set', -16.9, -11.1, 0.3, { y: 0.8 + 0.13 })
  p.put('furniture', 'lamp_standing', -19.2, -8.4, 0)

  // ---------- кабинет Босса (СВ): стеклянный куб, ковёр-коралл, глобус ----------
  glassWall(b, 'z', 13.6, -D + 0.2, -8, [[-10.6, -9.1]])
  glassWall(b, 'x', -8, 13.6, W - 0.2, [])
  p.put('furniture', 'table_medium_long', 17, -11.6, 0, { scale: 1.2 })
  p.put('furniture', 'armchair_pillows', 17, -13.3, 0, { scale: 0.85 })
  p.put('furniture', 'chair_A', 16.2, -9.9, Math.PI, { collide: false })
  p.put('furniture', 'chair_A', 17.8, -9.9, Math.PI, { collide: false })
  p.put('furniture', 'lamp_table', 18.3, -11.8, 0, { y: 0.86, scale: 0.7, collide: false })
  p.put('furniture', 'shelf_B_large_decorated', W - 0.2, -11.4, -Math.PI / 2, { y: 1.2 })
  globe(b, 14.6, -13.4)
  b.rbox(1.6, 0.5, 0.06, 0.03, 17, 1.7, -D + 0.25, 'plastic', MV.mustard) // табличка «BOSS»

  // ---------- open-space «Север» ----------
  for (const [x, z] of [[-7.6, -11.4], [-2.6, -11.4], [-7.6, -8.4], [-2.6, -8.4], [6.2, -11.4], [6.2, -8.4], [10.8, -11.4], [10.8, -8.4]] as const) {
    desk(b, p, x, z, 0)
  }

  // ---------- колоннада с арками: делит этаж, даёт укрытия ----------
  colonnade(b, -12, 12.6, -5.2, [-1.4, 3.4])

  // ---------- атриум: бассейн, островок с кулером, 4 мостика ----------
  const cooler = { x: 1, z: 1.8, radius: 2.4 }
  atrium(b, cooler.x, cooler.z)
  waterCooler(b, cooler.x, cooler.z, cooler.radius)

  // ---------- теннисный стол — офисная классика и укрытие ----------
  pingPong(b, 10.4, 3.4, Math.PI / 2)

  // ---------- серверная (В) ----------
  serverRoom(b)

  // ---------- open-space «Запад» ----------
  for (const [x, z] of [[-16.4, 1.4], [-12.4, 1.4], [-16.4, 6.8], [-12.4, 6.8]] as const) desk(b, p, x, z, Math.PI / 2)

  // ---------- невозможная лестница: поднимается и уходит в стену ----------
  impossibleStairs(b, -W + 0.25, 11.4)

  // ---------- ресепшен у южного лифта ----------
  reception(b, p, -6, 10.6)

  // ---------- лаунж ----------
  p.put('furniture', 'rug_oval_A', 2.6, 10.6, 0, { scale: 1.7, collide: false })
  p.put('furniture', 'couch_pillows', 2.6, 12.8, Math.PI)
  p.put('furniture', 'armchair_pillows', -0.6, 10.4, Math.PI / 2)
  p.put('furniture', 'armchair_pillows', 5.8, 10.4, -Math.PI / 2)
  p.put('furniture', 'table_low', 2.6, 10.4, 0)
  p.put('furniture', 'book_set', 2.9, 10.4, 0.4, { y: 0.46 })
  p.put('furniture', 'lamp_standing', -0.8, 13, 0)

  // ---------- кухня (ЮВ) ----------
  // пол кухни — крупная клетка мята/крем
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    b.box(1.18, 0.012, 1.18, 12.4 + i * 1.2, 0, 7.2 + j * 1.2, 'paint', (i + j) % 2 ? MV.mint : MV.creamLight)
  }
  p.put('kitchen', 'kitchencounter_straight_A_backsplash', W - 0.75, 7.6, -Math.PI / 2)
  p.put('kitchen', 'kitchencounter_sink_backsplash', W - 0.75, 9.04, -Math.PI / 2)
  p.put('kitchen', 'kitchencounter_straight_A_decorated', W - 0.75, 10.48, -Math.PI / 2)
  p.put('kitchen', 'stove_multi', W - 0.75, 11.92, -Math.PI / 2)
  p.put('kitchen', 'fridge_A_decorated', W - 0.9, 13.4, -Math.PI / 2)
  p.put('kitchen', 'kitchentable_A_large_decorated', 15, 9.4, Math.PI / 2)
  for (const z of [8.4, 9.4, 10.4]) p.put('kitchen', 'chair_stool', 13.9, z, 0, { collide: false })
  p.put('kitchen', 'table_round_A_decorated', 13.2, 13, 0)

  // ---------- зелень: кактусы KayKit и геометрические деревца в духе MV ----------
  for (const [x, z, n] of [[-11.6, -13.5, 'A'], [3.8, -13.5, 'B'], [-19.2, -4, 'A'], [8.8, 13.2, 'B'], [-10, 13.2, 'A']] as const) {
    p.put('furniture', `cactus_medium_${n}`, x, z, rand() * 6)
  }
  for (const [x, z, s] of [[-13, -5.2, 1], [13.6, -5.2, 1], [-6.6, 4.6, 0.85], [8.4, 4.6, 0.85], [13.4, -1, 1.1], [-19, 13, 1.1]] as const) {
    topiary(b, x, z, s)
  }

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

// ======================= архитектура в духе Monument Valley =======================

/** Колоннада: квадратные колонны, полукруглые арки, карниз. gaps — проходы без колонн */
function colonnade(b: StaticBuilder, x0: number, x1: number, z: number, skip: number[]): void {
  const step = 2.8
  const n = Math.round((x1 - x0) / step)
  const posts: number[] = []
  for (let i = 0; i <= n; i++) posts.push(x0 + i * step)
  const H = 1.75
  for (const x of posts) {
    if (skip.some((s) => Math.abs(s - x) < 0.5)) continue
    b.box(0.56, 0.12, 0.56, x, 0, z, 'paint', C.archAlt)
    b.box(0.46, H, 0.46, x, 0.12, z, 'paint', C.pillar, { collide: true })
    b.box(0.56, 0.1, 0.56, x, H + 0.12, z, 'paint', C.archAlt)
  }
  // арки между соседними колоннами
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], c = posts[i + 1]
    if (skip.some((s) => Math.abs(s - a) < 0.5 || Math.abs(s - c) < 0.5)) continue
    const r = (c - a) / 2 - 0.23
    const arch = new THREE.TorusGeometry(r, 0.11, 6, 20, Math.PI)
    b.geo(arch, (a + c) / 2, H + 0.22 - r * 0.55, z, 'paint', i % 2 ? C.arch : C.archAlt)
  }
}

/** Атриум: кольцо воды вокруг острова с кулером и четыре мостика */
function atrium(b: StaticBuilder, cx: number, cz: number): void {
  const rIn = 2.7, rOut = 5.1
  const ring = (r0: number, r1: number, y: number, kind: 'paint' | 'plastic' | 'matte', hex: number) => {
    const g = new THREE.RingGeometry(r0, r1, 64)
    g.rotateX(-Math.PI / 2)
    b.geo(g, cx, y, cz, kind, hex)
  }
  // вода чуть ниже пола: светлая кромка и тёмная глубина
  ring(rIn, rOut, 0.012, 'plastic', C.water)
  ring(rIn + 0.15, rIn + 0.55, 0.014, 'plastic', C.waterLight)
  ring(rOut - 0.5, rOut - 0.2, 0.014, 'plastic', C.waterLight)
  // бортики
  for (const r of [rIn, rOut]) {
    const t = new THREE.TorusGeometry(r, 0.09, 6, 64)
    t.rotateX(-Math.PI / 2)
    b.geo(t, cx, 0.08, cz, 'paint', C.rim)
  }
  // кувшинки и плавающие фигуры
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    const r = rIn + 0.6 + rand() * (rOut - rIn - 1.2)
    const g = new THREE.CylinderGeometry(0.22, 0.22, 0.02, 7)
    b.geo(g, cx + Math.cos(a) * r, 0.03, cz + Math.sin(a) * r, 'matte', i % 3 ? MV.teal : MV.blush)
  }
  // мостики на север, юг, запад, восток; кольцо воды непроходимо между ними
  const bridges = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
  for (const a of bridges) {
    const r = (rIn + rOut) / 2
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
    const along = Math.abs(Math.cos(a)) > 0.5 // мост вдоль X
    const len = rOut - rIn + 0.6
    if (along) {
      b.rbox(len, 0.12, 1.5, 0.05, x, 0.02, z, 'wood', 0xffffff)
      b.box(len, 0.3, 0.07, x, 0.12, z - 0.78, 'paint', C.arch)
      b.box(len, 0.3, 0.07, x, 0.12, z + 0.78, 'paint', C.arch)
    } else {
      b.rbox(1.5, 0.12, len, 0.05, x, 0.02, z, 'wood', 0xffffff)
      b.box(0.07, 0.3, len, x - 0.78, 0.12, z, 'paint', C.arch)
      b.box(0.07, 0.3, len, x + 0.78, 0.12, z, 'paint', C.arch)
    }
  }
  // коллайдеры воды: короткие отрезки по дуге, кроме мостов
  const rMid = (rIn + rOut) / 2
  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg * Math.PI) / 180
    const nearBridge = bridges.some((bA) => {
      let d = Math.abs(a - bA) % (Math.PI * 2)
      if (d > Math.PI) d = Math.PI * 2 - d
      return d < 0.32
    })
    if (nearBridge) continue
    b.blocker(cx + Math.cos(a) * rMid, cz + Math.sin(a) * rMid, 1.6, 1.6)
  }
}

/** Лестница, которая поднимается вдоль западной стены и уходит в неё */
function impossibleStairs(b: StaticBuilder, x: number, z: number): void {
  const n = 9
  for (let i = 0; i < n; i++) {
    const h = 0.32 * (i + 1)
    const sz = z - i * 0.55
    b.box(1.3, h, 0.55, x + 0.65, 0, sz, 'paint', i % 2 ? C.step : C.stepSide)
    b.box(1.3, 0.04, 0.55, x + 0.65, h, sz, 'paint', C.pillar)
  }
  // дверь в стене наверху — никуда
  b.rbox(0.1, 1.6, 0.9, 0.04, x + 0.02, 0.32 * n, z - (n - 1) * 0.55, 'paint', MV.indigo)
  b.rbox(0.12, 0.08, 0.08, 0.03, x + 0.1, 0.32 * n + 0.8, z - (n - 1) * 0.55 + 0.25, 'plastic', MV.mustard)
  b.blocker(x + 0.65, z - (n - 1) * 0.275, 1.3, n * 0.55)
}

function reception(b: StaticBuilder, p: Placer, x: number, z: number): void {
  // полукруглая стойка, фронтом к залу
  const g = new THREE.CylinderGeometry(1.6, 1.6, 1.05, 32, 1, true, Math.PI / 2, Math.PI)
  b.geo(g, x, 0.525, z, 'paint', MV.coral)
  const top = new THREE.RingGeometry(1.42, 1.72, 32, 1, Math.PI, Math.PI)
  top.rotateX(-Math.PI / 2)
  b.geo(top, x, 1.06, z, 'paint', MV.creamLight)
  b.blocker(x, z - 0.8, 3.4, 1.7)
  p.put('furniture', 'chair_C', x, z + 0.6, Math.PI, { collide: false })
  b.rbox(0.5, 0.32, 0.04, 0.02, x - 0.4, 1.07, z - 1.0, 'plastic', MV.indigo)
  b.cylinder(0.12, 0.1, 0.25, x + 0.7, 1.07, z - 1.1, 'paint', MV.mint, { segments: 12 })
}

function pingPong(b: StaticBuilder, x: number, z: number, rot: number): void {
  const L = 2.74, Wd = 1.52
  b.box(L, 0.05, Wd, x, 0.72, z, 'paint', MV.teal, { rotY: rot, collide: true })
  b.box(L, 0.006, 0.03, x, 0.77, z, 'paint', MV.white, { rotY: rot })
  b.box(0.03, 0.006, Wd, x, 0.77, z, 'paint', MV.white, { rotY: rot })
  b.box(0.02, 0.16, Wd + 0.1, x, 0.77, z, 'paint', MV.white, { rotY: rot }) // сетка
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (L / 2 - 0.15), lz = sz * (Wd / 2 - 0.12)
    const c = Math.cos(rot), s = Math.sin(rot)
    b.box(0.06, 0.72, 0.06, x + lx * c + lz * s, 0, z - lx * s + lz * c, 'paint', MV.indigo)
  }
  b.sphere(0.03, x + 0.3, 0.8, z + 0.5, 'paint', MV.mustard)
  b.rbox(0.16, 0.02, 0.26, 0.01, x - 0.4, 0.75, z - 0.6, 'paint', MV.coral, { rotY: 0.6 })
}

function globe(b: StaticBuilder, x: number, z: number): void {
  b.cylinder(0.25, 0.3, 0.06, x, 0, z, 'paint', MV.indigo)
  b.cylinder(0.03, 0.03, 0.9, x, 0.06, z, 'paint', MV.mustard, { segments: 8 })
  b.sphere(0.32, x, 1.2, z, 'paint', MV.sky)
  const t = new THREE.TorusGeometry(0.38, 0.025, 6, 32)
  t.rotateY(0.4)
  b.geo(t, x, 1.2, z, 'paint', MV.mustard)
  b.blocker(x, z, 0.7, 0.7)
}

/** Геометрическое деревце: горшок-цилиндр и шары кроны */
function topiary(b: StaticBuilder, x: number, z: number, s: number): void {
  b.cylinder(0.32 * s, 0.26 * s, 0.5 * s, x, 0, z, 'paint', C.pot, { collide: true, segments: 16 })
  b.cylinder(0.04 * s, 0.05 * s, 0.6 * s, x, 0.5 * s, z, 'darkwood', 0xffffff, { segments: 6 })
  b.sphere(0.52 * s, x, 1.35 * s, z, 'paint', C.leaf)
  b.sphere(0.34 * s, x + 0.25 * s, 1.75 * s, z - 0.1 * s, 'paint', C.leafLight)
}

// ======================= мебель и техника =======================

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
