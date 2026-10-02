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
  План этажа (север — вверх, камера смотрит с юго-востока):

  ┌─────────────┬──────────┬──────── окна ─────────────────────┬────────┬───────────────┐
  │ переговорка │ перегов. │  рабочая зона «Север» (у окон)    │ печать │ кабинет Босса │
  │   «Лондон»  │ «Париж»  │                                   │ архив  │   (стекло)    │
  ├─────────────┴──────────┴──── арки ─── проход ─── арки ─────┴────────┼───────────────┤
  │ лестница       рабочая         ПРЕЗЕНТАЦИОННАЯ ЗОНА                 │  серверная    │
  │ в никуда       зона «Запад»    экран · сцена · КУЛЕР · пуфы         ├───────────────┤
  │                                                                     │ служебный     │
  ├──────────┐                                                 теннис   │ холл · лифты  │
  │ WC  М │ Ж│      ресепшен          лаунж                ┌────────────┴───────────────┤
  │          │   главный холл                              │        кухня-столовая       │
  └──────────┴──── лифт ── лифт ─────────────────────────────────────────────────────────┘
*/
export function buildOffice(): Office {
  seed = 1337
  const b = new StaticBuilder()
  const p = new Placer(b.colliders)

  // ---------- пол и зоны ----------
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, 'tile', C.floor)
  b.rbox(20.6, 0.015, 6.6, 0.3, -0.1, 0, -10.6, 'carpet', C.carpetA) // рабочая зона «Север»
  b.rbox(6.6, 0.015, 7.2, 0.3, -14.4, 0, -3.4, 'carpet', C.carpetC) // рабочая зона «Запад»
  b.rbox(5.8, 0.015, 5.2, 0.3, -17.3, 0, -11.8, 'carpet', C.carpetMeet) // переговорка 1
  b.rbox(4, 0.015, 4, 0.3, -12.6, 0, -12.4, 'carpet', C.carpetB) // переговорка 2
  b.rbox(6.4, 0.015, 6.2, 0.3, 16.9, 0, -11.3, 'carpet', C.carpetBoss) // Босс
  b.rbox(15, 0.015, 9.6, 0.4, 1, 0, 0.4, 'carpet', MV.peach) // презентационная зона
  b.rbox(9, 0.015, 5.2, 0.3, -6.4, 0, 11.6, 'carpet', MV.sky) // главный холл

  // ---------- внешние стены ----------
  for (let i = 0; i < 14; i++) {
    const x = -W + PIECE / 2 + i * PIECE
    p.put('kitchen', i % 3 === 1 ? 'wall' : 'wall_window_open', x, -D, 0, { collide: false })
  }
  b.blocker(0, -D, W * 2, 0.4)
  for (let i = 0; i < 10; i++) {
    const z = -D + PIECE / 2 + i * PIECE
    p.put('kitchen', i % 3 === 2 ? 'wall_window_open' : 'wall', -W, z, Math.PI / 2, { collide: false })
  }
  b.blocker(-W, 0, 0.4, D * 2)
  b.box(W * 2, 3, 0.05, 0, 0, -D - 0.9, 'light', 0xffe3e6) // «небо» за окнами
  b.box(0.05, 3, D * 2, -W - 0.9, 0, 0, 'light', 0xffe3e6)
  // ближние к камере стены — низкий бортик с проёмами под лифты
  lowWall(b, 'x', D, -W, W, [[-10.7, -8.3], [-6.7, -4.3]])
  lowWall(b, 'z', W, -D, D, [[-2.5, -0.3], [0.7, 2.9]])

  // ---------- лифты: главный холл (юг) и служебный (восток) ----------
  const spawns: Spawn[] = [
    elevator(b, -9.5, D, Math.PI),
    elevator(b, W, -1.4, -Math.PI / 2),
    elevator(b, -5.5, D, Math.PI),
    elevator(b, W, 1.8, -Math.PI / 2),
  ]

  // ---------- переговорки (СЗ) ----------
  glassWall(b, 'x', -9.2, -W + 0.2, -14.6, [[-17.9, -16.4]])
  glassWall(b, 'z', -14.6, -D + 0.2, -9.2, [])
  p.put('furniture', 'table_medium_long', -17.3, -11.9, 0, { scale: 1.05 })
  for (let i = 0; i < 3; i++) {
    p.put('furniture', 'chair_C', -18.8 + i * 1.5, -13.4, 0, { collide: false })
    p.put('furniture', 'chair_C', -18.8 + i * 1.5, -10.4, Math.PI, { collide: false })
  }
  b.rbox(0.06, 1.1, 2, 0.03, -W + 0.25, 1.0, -11.9, 'plastic', MV.indigo) // экран на стене
  b.box(0.02, 1.0, 1.9, -W + 0.3, 1.05, -11.9, 'screen')
  glassWall(b, 'x', -10.4, -14.6, -10.6, [[-13.4, -12]])
  glassWall(b, 'z', -10.6, -D + 0.2, -10.4, [])
  p.put('furniture', 'table_small', -12.6, -12.6, 0)
  p.put('furniture', 'chair_A', -13.5, -12.6, Math.PI / 2, { collide: false })
  p.put('furniture', 'chair_A', -11.7, -12.6, -Math.PI / 2, { collide: false })
  sign(p, 'Лондон', -17.3, 2.35, -9.15, 0, 1.4, MV.indigo)
  sign(p, 'Париж', -12.5, 2.35, -10.35, 0, 1.2, MV.indigo)

  // ---------- рабочая зона «Север»: ряды столов у окон ----------
  for (const x of [-7.6, -3, 3.2, 7.8]) {
    desk(b, p, x, -12, 0)
    desk(b, p, x, -8.7, 0)
  }
  sign(p, 'Отдел продаж', -5.3, 0.02, -6.8, -Math.PI / 2, 2.4, MV.lavender, true)
  sign(p, 'Бухгалтерия', 5.5, 0.02, -6.8, -Math.PI / 2, 2.4, MV.lavender, true)

  // ---------- печать и архив (между open-space и Боссом) ----------
  copier(b, 11.2, -13.4)
  p.put('furniture', 'cabinet_medium_decorated', 12.4, -10.4, -Math.PI / 2)
  p.put('furniture', 'cabinet_medium', 12.4, -8.8, -Math.PI / 2)
  p.put('proto', 'Box_A', 10.6, -11.3, 0.3)
  p.put('proto', 'Box_B', 10.4, -10.6, -0.2)

  // ---------- кабинет Босса (СВ) ----------
  glassWall(b, 'z', 13.7, -D + 0.2, -8.2, [[-10.8, -9.3]])
  glassWall(b, 'x', -8.2, 13.7, W - 0.2, [])
  p.put('furniture', 'table_medium_long', 17, -11.8, 0, { scale: 1.2 })
  p.put('furniture', 'armchair_pillows', 17, -13.4, 0, { scale: 0.85 })
  p.put('furniture', 'chair_A', 16.2, -10.1, Math.PI, { collide: false })
  p.put('furniture', 'chair_A', 17.8, -10.1, Math.PI, { collide: false })
  p.put('furniture', 'lamp_table', 18.3, -12, 0, { y: 0.86, scale: 0.7, collide: false })
  p.put('furniture', 'shelf_B_large_decorated', W - 0.2, -11.4, -Math.PI / 2, { y: 1.2 })
  globe(b, 14.6, -13.4)
  sign(p, 'Генеральный директор', 15.8, 2.35, -8.15, 0, 2.2, MV.indigo)

  // ---------- арки: граница рабочей и общей зон, проход по центру ----------
  colonnade(b, -9.4, 12.6, -6.2, [1.8])

  // ---------- ПРЕЗЕНТАЦИОННАЯ ЗОНА: сцена, экран, пуфы, кулер ----------
  const cooler = presentation(b, p, 1, -3.6)

  // ---------- рабочая зона «Запад» и лестница в никуда ----------
  desk(b, p, -15.4, -5.4, Math.PI / 2)
  desk(b, p, -12, -5.4, Math.PI / 2)
  desk(b, p, -15.4, -1.4, Math.PI / 2)
  desk(b, p, -12, -1.4, Math.PI / 2)
  impossibleStairs(b, -W + 0.25, 4.8)

  // ---------- туалеты (ЮЗ) ----------
  restrooms(b, p)

  // ---------- главный холл: ресепшен, ожидание, логотип ----------
  reception(b, p, -7.5, 9.4)
  logoTotem(b, p, -3.2, 12.6)
  p.put('furniture', 'couch_pillows', -11.2, 12.6, Math.PI / 2, { scale: 0.8 })
  topiary(b, -11.4, 9.6, 1)

  // ---------- лаунж ----------
  p.put('furniture', 'rug_oval_A', 3.6, 10.8, 0, { scale: 1.6, collide: false })
  p.put('furniture', 'couch_pillows', 3.6, 12.9, Math.PI)
  p.put('furniture', 'armchair_pillows', 0.6, 10.6, Math.PI / 2)
  p.put('furniture', 'armchair_pillows', 6.6, 10.6, -Math.PI / 2)
  p.put('furniture', 'table_low', 3.6, 10.6, 0)
  p.put('furniture', 'book_set', 3.9, 10.6, 0.4, { y: 0.46 })
  p.put('furniture', 'lamp_standing', 0.4, 13, 0)

  // ---------- теннисный стол ----------
  pingPong(b, 10, 6.6, 0)

  // ---------- серверная (В) ----------
  b.rbox(4.6, 0.015, 4.4, 0.2, 17.9, 0, -5.8, 'matte', 0xd9d4ec)
  glassWall(b, 'z', 15.5, -8.2, -3.6, [[-6.6, -5.2]])
  wallLine(b, 'x', -3.6, 15.5, W - 0.2, MV.lavender)
  for (const z of [-7.4, -6.2, -5]) rack(b, 19.4, z)
  rack(b, 17.2, -7.2)
  sign(p, 'Серверная', 17.8, 2.35, -3.55, 0, 1.6, MV.indigo)

  // ---------- служебный холл у восточных лифтов ----------
  b.rbox(4.2, 0.015, 6.6, 0.3, 18, 0, 0.2, 'carpet', MV.lilac)
  p.put('furniture', 'chair_stool', 16.4, 3.6, 0, { collide: false })
  topiary(b, 16.2, -2.6, 0.9)

  // ---------- кухня-столовая (ЮВ) ----------
  wallLine(b, 'x', 5.6, 11.6, 16.2, MV.teal, 1.1)
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
  sign(p, 'Кухня', 13.8, 1.45, 5.65, 0, 1.2, MV.tealDeep)

  // ---------- зелень ----------
  for (const [x, z, n] of [[-9.6, -13.6, 'A'], [9.6, -13.6, 'B'], [-19.2, -7.6, 'A'], [-0.6, 13.2, 'B'], [11.6, 13.4, 'A']] as const) {
    p.put('furniture', `cactus_medium_${n}`, x, z, rand() * 6)
  }
  for (const [x, z, s] of [[-9.6, -6.2, 1], [12.6, -6.2, 1], [-8.2, 4.4, 0.9], [9.4, 3.6, 0.9]] as const) topiary(b, x, z, s)

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

// ======================= зоны =======================

/** Сцена с экраном, ряды пуфов полукругом, кулер у края сцены. Возвращает зону кулера */
function presentation(b: StaticBuilder, p: Placer, cx: number, cz: number): { x: number; z: number; radius: number } {
  // сцена: низкий подиум в две ступени
  b.rbox(9, 0.16, 2.6, 0.08, cx, 0, cz - 0.4, 'paint', MV.coral, { collide: false })
  b.rbox(8.4, 0.12, 2.1, 0.06, cx, 0.16, cz - 0.55, 'paint', MV.blush)
  // экран на опорах, смотрит в зал
  const sw = 5.6, sh = 2.4, sy = 0.75
  b.rbox(sw + 0.3, sh + 0.3, 0.16, 0.06, cx, sy - 0.15, cz - 1.4, 'plastic', MV.indigo)
  for (const sx of [-1, 1]) b.box(0.14, sy, 0.14, cx + sx * (sw / 2 - 0.4), 0.28, cz - 1.4, 'metal', MV.indigo)
  b.blocker(cx, cz - 1.4, sw + 0.3, 0.4)
  slide(p, cx, sy + sh / 2, cz - 1.31, sw, sh)
  // трибуна
  b.rbox(0.6, 1.1, 0.45, 0.06, cx + 2.8, 0.28, cz - 0.3, 'paint', MV.creamLight, { collide: true })
  b.box(0.5, 0.06, 0.08, cx + 2.8, 1.38, cz - 0.1, 'paint', MV.mustard)
  // пуфы полукругом, проход по центру
  const rows = [5.2, 6.5, 7.8]
  rows.forEach((r, ri) => {
    const n = 7 + ri * 2
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.18 + (Math.PI * 0.64 * i) / (n - 1) // от 32° до 148°
      if (Math.abs(a - Math.PI / 2) < 0.16) continue // центральный проход
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r - 0.4
      pouf(b, x, z, [MV.mint, MV.lilac, MV.blush, MV.mustard][(i + ri) % 4])
    }
  })
  // кулер — у края сцены: зона «Кулер» = пятачок перед экраном
  const zx = cx, zz = cz + 2.3
  waterCooler(b, zx - 1.9, zz - 0.9, 0)
  b.cylinder(2.4, 2.4, 0.016, zx, 0, zz, 'matte', C.zone, { segments: 48 })
  b.cylinder(2.25, 2.25, 0.018, zx, 0, zz, 'matte', C.zoneIn, { segments: 48 })
  return { x: zx, z: zz, radius: 2.4 }
}

function pouf(b: StaticBuilder, x: number, z: number, hex: number): void {
  b.cylinder(0.32, 0.34, 0.38, x, 0, z, 'fabric', hex, { collide: true, segments: 16 })
  b.cylinder(0.26, 0.32, 0.06, x, 0.38, z, 'fabric', hex, { segments: 16 })
}

/** Туалеты М и Ж: перегородки, кабинки, раковины, таблички */
function restrooms(b: StaticBuilder, p: Placer): void {
  const x0 = -W + 0.2, x1 = -13, z0 = 7.4, z1 = D - 0.2
  const mid = -16.6
  wallLine(b, 'z', x1, z0, z1, MV.lilac, 2.4)
  wallLine(b, 'x', z0, x0, x1, MV.lilac, 2.4, [[-18.6, -17.4], [-15.2, -14]])
  wallLine(b, 'z', mid, z0, z1, MV.lilac, 2.4)
  b.rbox(x1 - x0, 0.015, z1 - z0, 0.1, (x0 + x1) / 2, 0, (z0 + z1) / 2, 'matte', 0xe6f3f0)
  for (const [ax, bx, label, col] of [[x0, mid, 'Ж', MV.coral], [mid, x1, 'М', MV.teal]] as const) {
    const cx = (ax + bx) / 2
    // две кабинки у дальней стены
    for (const k of [0, 1]) {
      const sx = ax + 0.35 + k * 1.55 + 0.75
      b.box(0.06, 1.9, 1.5, ax + 0.35 + k * 1.55, 0.1, z1 - 0.75, 'paint', MV.creamLight, { collide: true })
      toilet(b, sx, z1 - 0.45)
    }
    b.box(0.06, 1.9, 1.5, ax + 0.35 + 2 * 1.55, 0.1, z1 - 0.75, 'paint', MV.creamLight, { collide: true })
    // раковина с зеркалом
    b.rbox(1.6, 0.85, 0.5, 0.05, cx, 0, z0 + 0.45, 'paint', MV.creamLight, { collide: true })
    b.cylinder(0.18, 0.14, 0.08, cx - 0.4, 0.85, z0 + 0.45, 'plastic', MV.white)
    b.cylinder(0.18, 0.14, 0.08, cx + 0.4, 0.85, z0 + 0.45, 'plastic', MV.white)
    sign(p, label, cx, 1.95, z0 - 0.06, Math.PI, 0.5, col)
    sign(p, label, cx, 1.95, z0 + 0.06, 0, 0.5, col)
  }
}

function toilet(b: StaticBuilder, x: number, z: number): void {
  b.rbox(0.42, 0.42, 0.55, 0.12, x, 0, z, 'plastic', MV.white, { collide: true })
  b.rbox(0.45, 0.5, 0.18, 0.05, x, 0.4, z + 0.22, 'plastic', MV.white)
}

/** Прямая стенка-перегородка в цвет палитры (с проёмами) */
function wallLine(b: StaticBuilder, axis: 'x' | 'z', at: number, a: number, c: number, hex: number, h = 2.4,
  gaps: [number, number][] = []): void {
  for (const [s0, s1] of segments(Math.min(a, c), Math.max(a, c), gaps)) {
    const len = s1 - s0, mid = (s0 + s1) / 2
    if (axis === 'x') {
      b.box(len, h, 0.14, mid, 0, at, 'paint', hex, { collide: true })
      b.box(len, 0.05, 0.18, mid, h, at, 'paint', MV.creamLight)
    } else {
      b.box(0.14, h, len, at, 0, mid, 'paint', hex, { collide: true })
      b.box(0.18, 0.05, len, at, h, mid, 'paint', MV.creamLight)
    }
  }
}

function copier(b: StaticBuilder, x: number, z: number): void {
  b.rbox(1.0, 0.95, 0.7, 0.05, x, 0, z, 'plastic', MV.creamLight, { collide: true })
  b.rbox(0.9, 0.14, 0.6, 0.04, x, 0.95, z, 'plastic', MV.lilac)
  b.box(0.28, 0.02, 0.16, x + 0.22, 1.09, z, 'light', 0xb3e0ff)
  b.box(0.5, 0.03, 0.34, x - 0.15, 1.09, z, 'matte', MV.white)
}

function logoTotem(b: StaticBuilder, p: Placer, x: number, z: number): void {
  b.rbox(0.9, 2.2, 0.3, 0.1, x, 0, z, 'paint', MV.mustard, { collide: true })
  sign(p, 'ОФИС', x, 1.55, z - 0.16, Math.PI, 0.8, MV.indigo)
  sign(p, '★', x, 1.0, z - 0.16, Math.PI, 0.5, MV.coral)
}

// ======================= надписи и экран =======================

/** Табличка с текстом. floor=true — надпись на полу */
function sign(p: Placer, text: string, x: number, y: number, z: number, rotY: number, width: number, hex: number, floor = false): void {
  const c = document.createElement('canvas')
  const H = 128
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.font = `bold ${H * 0.62}px system-ui, -apple-system, "Segoe UI", sans-serif`
  c.width = Math.ceil(ctx.measureText(text).width + H * 0.6)
  ctx.font = `bold ${H * 0.62}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, c.width / 2, H * 0.54)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const h = width * (H / c.width)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  m.position.set(x, y, z)
  if (floor) { m.rotation.set(-Math.PI / 2, 0, rotY); m.position.y = 0.025 } else m.rotation.y = rotY
  p.group.add(m)
}

/** Слайд на большом экране: «Итоги квартала» и ироничный слоган */
function slide(p: Placer, x: number, y: number, z: number, w: number, h: number): void {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = Math.round(1024 * (h / w))
  const g = c.getContext('2d')!
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
  g.fillStyle = hex(MV.creamLight)
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = hex(MV.indigo)
  g.font = 'bold 64px system-ui, sans-serif'
  g.fillText('ИТОГИ КВАРТАЛА', 56, 100)
  g.font = '34px system-ui, sans-serif'
  g.fillStyle = hex(MV.lavender)
  g.fillText('Мы — одна большая семья ♥', 56, 152)
  const bars = [0.35, 0.5, 0.42, 0.68, 0.95]
  const cols = [MV.mint, MV.teal, MV.lilac, MV.coral, MV.mustard]
  bars.forEach((v, i) => {
    const bw = 120, gap = 46, bx = 70 + i * (bw + gap), base = c.height - 60
    g.fillStyle = hex(cols[i])
    g.fillRect(bx, base - v * (c.height - 260), bw, v * (c.height - 260))
  })
  g.fillStyle = hex(MV.coral)
  g.font = 'bold 44px system-ui, sans-serif'
  g.fillText('+300%', 870, 250)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
  m.position.set(x, y, z)
  p.group.add(m)
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
  if (radius > 0) {
    b.cylinder(radius, radius, 0.014, x, 0, z, 'matte', C.zone, { segments: 48 })
    b.cylinder(radius - 0.15, radius - 0.15, 0.016, x, 0, z, 'matte', C.zoneIn, { segments: 48 })
  }
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
