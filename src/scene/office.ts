import * as THREE from 'three'
import { StaticBuilder, type AABB } from './builder'
import { prop, type PackName } from '../assets'
import { MV } from './palette'

export interface Spawn { x: number; z: number; rot: number }

/** Предмет на полу: оружие или кофе (лечит) */
export interface PickupSpot { x: number; z: number; kind: 'stapler' | 'mop' | 'lamp' | 'moneygun' | 'coffee' }

export interface Office {
  group: THREE.Group
  colliders: AABB[]
  spawns: Spawn[]
  cooler: { x: number; z: number; radius: number }
  pickups: PickupSpot[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  sunDir: THREE.Vector3
}

// Ассеты KayKit крупнее реальных вещей примерно в 1.4 раза — приводим к метрам
const S = 0.72
const PIECE = 4 * S // ширина модульной стены
const W = (10 * PIECE) / 2 // 14.4 м
const D = (9 * PIECE) / 2 // 12.96 м

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
        hw: ((box.max.x - box.min.x) / 2) * k, hd: ((box.max.z - box.min.z) / 2) * k, top: box.max.y,
      })
    }
    return m
  }
}

/*
  ЛЕВЕЛ-ДИЗАЙН (север — вверх). Этаж 34.6 × 25.9 м, 4 игрока, все против всех.

  ┌──────────────┬─[N]──┬──────── окна ────────────┬───────────────┐
  │ переговорка  │карман│   рабочая зона «Север»   │ кабинет Босса │
  │  «Лондон»    │ ▬▬▬▬ │  ▌стол ▌стол ▌стол        ├───────────[E]─┤
  ├────────  ────┘      └──────────────┐          │       ▌карман │
  │ зона «Запад»     ◣ ▬▬ экран ▬▬ ◢   │ колонна  ├──────  ───────┤
  │  ▌стол           ▌   КУЛЕР    ▌    │          │  серверная    │
  │ лестница         ◥ ▬ стеллаж ▬ ◤   │          │               │
  ├[W]────┐        лаунж        теннис  ┌─────────┴────  ─────────┤
  │карман▐│                        ▬▬▬▬ │карман     кухня          │
  │  WC  М│Ж                        [S]─┘                           │
  └───────┴─────────────────────────────────────────────────────────┘

  Принципы:
  • «Вертушка»: 4 лифта на 4 стенах со сдвигом — поворотная симметрия, равные дистанции до кулера.
  • Карман респа: перед лифтом стена, два выхода — с респа никого не видно и тебя тоже.
  • Центр — «коробка» вокруг кулера: экран, стеллаж и две кадки, 4 входа по диагоналям, по одному на респ.
  • Длинные линии режут высокие перегородки и стеллажи; низкая мебель (столы, пуфы, диваны)
    мешает только бегу, пули летят над ней.
*/
export function buildOffice(): Office {
  seed = 1337
  const b = new StaticBuilder()
  const p = new Placer(b.colliders)

  // ---------- пол и зоны ----------
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, 'tile', C.floor)
  b.rbox(14.4, 0.015, 4.6, 0.3, 2.2, 0, -10.5, 'carpet', C.carpetA) // «Север»
  b.rbox(4.6, 0.015, 7.6, 0.3, -11.8, 0, -2.4, 'carpet', C.carpetC) // «Запад»
  b.rbox(4.6, 0.015, 4.3, 0.3, -11.9, 0, -10.8, 'carpet', C.carpetMeet) // переговорка
  b.rbox(4.6, 0.015, 4.1, 0.3, 11.9, 0, -10.9, 'carpet', C.carpetBoss) // Босс
  b.rbox(9.6, 0.015, 8.4, 0.4, 0, 0, 0, 'carpet', MV.peach) // центр

  // ---------- внешние стены ----------
  const NI = 2 // проём под лифт в северной стене
  for (let i = 0; i < 10; i++) {
    const x = -W + PIECE / 2 + i * PIECE
    p.put('kitchen', i === NI ? 'wall_doorway' : i % 3 === 1 ? 'wall' : 'wall_window_open', x, -D, 0, { collide: false })
  }
  b.blocker(0, -D, W * 2, 0.4)
  const WI = 6 // проём под лифт в западной стене
  for (let i = 0; i < 9; i++) {
    const z = -D + PIECE / 2 + i * PIECE
    p.put('kitchen', i === WI ? 'wall_doorway' : i % 3 === 2 ? 'wall_window_open' : 'wall', -W, z, Math.PI / 2, { collide: false })
  }
  b.blocker(-W, 0, 0.4, D * 2)
  b.box(W * 2, 3, 0.05, 0, 0, -D - 0.9, 'light', 0xffe3e6) // «небо» за окнами
  b.box(0.05, 3, D * 2, -W - 0.9, 0, 0, 'light', 0xffe3e6)

  // ---------- лифты «вертушкой»: поворотная симметрия, равные пути до кулера ----------
  const nX = -W + PIECE / 2 + NI * PIECE // -7.2
  const wZ = -D + PIECE / 2 + WI * PIECE // 5.76
  const sX = -nX, eZ = -wZ // юг 7.2, восток -5.76
  lowWall(b, 'x', D, -W, W, [[sX - 1.1, sX + 1.1]])
  lowWall(b, 'z', W, -D, D, [[eZ - 1.1, eZ + 1.1]])
  // порядок важен: 1-й и 2-й игроки — напротив друг друга, 3-й и 4-й — на свободных сторонах
  const spawns: Spawn[] = [
    elevator(b, nX, -D, 0), // N
    elevator(b, sX, D, Math.PI), // S
    elevator(b, W, eZ, -Math.PI / 2), // E
    elevator(b, -W, wZ, Math.PI / 2), // W
  ]
  // карманы респа: стена перед лифтом, выходы по бокам
  wallLine(b, 'x', -D + 4.2, nX - 1.5, nX + 1.5, MV.lilac, 2.2)
  wallLine(b, 'x', D - 4.2, sX - 1.5, sX + 1.5, MV.lilac, 2.2)
  wallLine(b, 'z', W - 4.2, eZ - 1.5, eZ + 1.5, MV.lilac, 2.2)
  wallLine(b, 'z', -W + 4.2, wZ - 1.5, wZ + 1.5, MV.lilac, 2.2)
  sign(p, 'Лифт 1', nX, 1.9, -D + 4.12, Math.PI, 1.1, MV.indigo)
  sign(p, 'Лифт 2', sX, 1.9, D - 4.12, 0, 1.1, MV.indigo)
  sign(p, 'Лифт 3', W - 4.12, 1.9, eZ, Math.PI / 2, 1.1, MV.indigo)
  sign(p, 'Лифт 4', -W + 4.12, 1.9, wZ, -Math.PI / 2, 1.1, MV.indigo)

  // ---------- СЗ: переговорка «Лондон» ----------
  glassWall(b, 'z', -10.4, -D + 0.2, -8.6, [])
  glassWall(b, 'x', -8.6, -W + 0.2, -10.4, [[-12.9, -11.5]])
  p.put('furniture', 'table_medium_long', -12.3, -10.9, 0, { scale: 0.75 })
  for (const x of [-13, -11.6]) {
    p.put('furniture', 'chair_C', x, -12.1, 0, { collide: false })
    p.put('furniture', 'chair_C', x, -9.7, Math.PI, { collide: false })
  }
  b.rbox(0.06, 1, 1.8, 0.03, -W + 0.25, 1, -10.9, 'plastic', MV.indigo)
  b.box(0.02, 0.9, 1.7, -W + 0.3, 1.05, -10.9, 'screen')
  sign(p, 'Лондон', -12.3, 2.35, -8.55, 0, 1.3, MV.indigo)

  // ---------- СВ: кабинет Босса ----------
  glassWall(b, 'z', 10.4, -D + 0.2, -8.8, [[-10.2, -8.8]])
  glassWall(b, 'x', -8.8, 10.4, W - 0.2, [])
  p.put('furniture', 'table_medium_long', 12, -11.3, 0, { scale: 0.95 })
  p.put('furniture', 'armchair_pillows', 12, -12.5, 0, { scale: 0.7 })
  p.put('furniture', 'chair_A', 11.4, -9.9, Math.PI, { collide: false })
  p.put('furniture', 'chair_A', 12.6, -9.9, Math.PI, { collide: false })
  p.put('furniture', 'shelf_B_large_decorated', W - 0.2, -10.8, -Math.PI / 2, { y: 1.2 })
  globe(b, 11, -12.3)
  sign(p, 'Генеральный директор', 12, 2.35, -8.75, 0, 2.0, MV.indigo)

  // ---------- рабочая зона «Север»: столы, между ними высокие перегородки ----------
  for (const x of [-2.6, 1.8, 6.2]) desk(b, p, x, -11.4, 0)
  for (const x of [-0.4, 4]) acoustic(b, x, -11.3, 2.6, Math.PI / 2)
  sign(p, 'Отдел продаж', 1.8, 0.02, -8.6, 0, 2.2, MV.lavender, true)

  // ---------- рабочая зона «Запад» и лестница в никуда ----------
  desk(b, p, -11.2, 0.4, Math.PI / 2)
  acoustic(b, -11.2, -1.7, 2.6, 0)
  impossibleStairs(b, -W + 0.25, -2.4)

  // ---------- ЮЗ: туалеты ----------
  restrooms(b, p, -W + 0.2, -9.4, 8.9, D - 0.2)

  // ---------- ЮВ: кухня ----------
  kitchenZone(b, p, 10.4, 8.6)

  // ---------- В: серверная ----------
  wallLine(b, 'z', 10.2, -2, 4.4, MV.lavender, 2.4, [[0.6, 2]])
  wallLine(b, 'x', -2, 10.2, W - 0.2, MV.lavender, 2.4)
  wallLine(b, 'x', 4.4, 10.2, W - 0.2, MV.lavender, 2.4)
  b.rbox(4, 0.015, 6.4, 0.2, 12.3, 0, 1.2, 'matte', 0xd9d4ec)
  for (const z of [-1.1, 0.1, 2.5, 3.7]) rack(b, 13.6, z)
  sign(p, 'Серверная', 10.12, 2.0, 1.3, -Math.PI / 2, 1.5, MV.indigo)

  // ---------- центр: «коробка» вокруг кулера ----------
  const cooler = centerArena(b, p)

  // ---------- юг: лаунж и теннис ----------
  p.put('furniture', 'rug_oval_A', -5.4, 10.2, 0, { scale: 1.3, collide: false })
  p.put('furniture', 'couch_pillows', -5.4, 12, Math.PI, { scale: 0.85 })
  p.put('furniture', 'armchair_pillows', -7.8, 10, Math.PI / 2, { scale: 0.85 })
  p.put('furniture', 'table_low', -5.4, 10, 0, { scale: 0.85 })
  p.put('furniture', 'cabinet_medium_decorated', -2.8, 10.2, -Math.PI / 2) // стеллаж — режет линию вдоль юга
  pingPong(b, 1.8, 10.4, 0)

  // ---------- кольцо вокруг центра: укрытия режут обход по кругу ----------
  for (const [x, z] of [[0, -6.6], [0, 6.6]] as const) planter(b, x, z, 3.2, 0)
  for (const [x, z] of [[-7.4, 0], [7.4, 0]] as const) planter(b, x, z, 3.2, Math.PI / 2)
  for (const [x, z] of [[-5.6, -5.4], [5.6, 5.4], [5.8, -5.2], [-5.8, 5.2]] as const) column(b, x, z)
  // телефонные капсулы — высокие укрытия по бокам от центра
  for (const [x, z, r] of [[-5.7, -2.3, 0], [5.7, 2.3, Math.PI], [5.7, -2.3, Math.PI], [-5.7, 2.3, 0]] as const) phoneBooth(b, x, z, r)
  // кусты в коридорах вдоль стен
  for (const [x, z] of [[-4.2, -8.2], [4.2, 8.2], [4.4, -8.2], [-4.4, 8.2], [8.2, -2.9], [-8.2, 2.9]] as const) topiary(b, x, z, 1)
  for (const [x, z, n] of [[-8.8, -12.4, 'A'], [8.8, -7.6, 'B'], [-8.8, 7.8, 'A'], [8.8, 12.4, 'B']] as const) {
    p.put('furniture', `cactus_medium_${n}`, x, z, rand() * 6)
  }

  const group = b.build()
  group.add(p.group)
  return {
    group,
    colliders: b.colliders,
    spawns,
    cooler,
    // «вертушка»: у каждого лифта своё оружие неподалёку, кофе — в двух дальних углах
    pickups: [
      { x: 1.8, z: -8.2, kind: 'stapler' }, // север, у отдела продаж — ближе к лифту 1
      { x: -1.8, z: 8.2, kind: 'moneygun' }, // юг, у теннисного стола — ближе к лифту 2
      { x: 13.2, z: -9.6, kind: 'lamp' }, // кабинет директора — ближе к лифту 3
      { x: -6.4, z: 8.4, kind: 'mop' }, // у лаунжа и туалетов — ближе к лифту 4
      { x: -10.4, z: -6.6, kind: 'coffee' }, // у переговорки, между лифтами 1 и 4
      { x: 10.4, z: 6.6, kind: 'coffee' }, // у кухни, между лифтами 2 и 3
    ],
    bounds: { minX: -W, maxX: W, minZ: -D, maxZ: D },
    sunDir: new THREE.Vector3(-0.35, 0.75, -0.55).normalize(),
  }
}

/** Центр карты: кулер в «коробке» из экрана, стеллажа и двух кадок; входы — по диагоналям */
function centerArena(b: StaticBuilder, p: Placer): { x: number; z: number; radius: number } {
  const hx = 3.6, hz = 3.1
  // север — большой экран (смотрит внутрь, на кулер)
  const sw = 4.6, sh = 2.1, sy = 0.7
  b.rbox(sw + 0.3, sh + 0.3, 0.2, 0.06, 0, sy - 0.15, -hz, 'plastic', MV.indigo)
  b.box(sw + 0.3, sy - 0.15, 0.2, 0, 0, -hz, 'paint', MV.coral)
  b.blocker(0, -hz, sw + 0.3, 0.3)
  slide(p, 0, sy + sh / 2, -hz + 0.11, sw, sh)
  b.rbox(4.4, 0.12, 1.2, 0.05, 0, 0, -hz + 0.8, 'paint', MV.blush) // сцена
  // юг — стеллаж с папками
  b.rbox(sw, 1.7, 0.45, 0.06, 0, 0, hz, 'paint', MV.creamLight, { collide: true })
  for (let i = 0; i < 8; i++) {
    b.rbox(0.42, 0.4 + rand() * 0.25, 0.32, 0.03, -2 + i * 0.57, 0.12 + (i % 2) * 0.8, hz, 'paint',
      [MV.coral, MV.teal, MV.mustard, MV.lavender][i % 4])
  }
  // запад и восток — длинные кадки с растениями
  for (const sx of [-1, 1]) {
    b.rbox(0.7, 0.7, 3.6, 0.1, sx * hx, 0, 0, 'paint', MV.creamLight, { collide: true })
    for (let i = 0; i < 4; i++) {
      b.sphere(0.5, sx * hx, 1.05 + (i % 2) * 0.15, -1.3 + i * 0.87, 'paint', i % 2 ? C.leaf : C.leafLight)
    }
    b.blocker(sx * hx, 0, 0.7, 3.6, 1.9) // крона — укрытие от выстрелов
  }
  // внутри: кулер в центре, пара пуфов (низкое укрытие)
  waterCooler(b, 0, 0, 2.4)
  for (const [x, z, c] of [[-1.8, 1.6, MV.mint], [1.8, 1.6, MV.lilac], [-1.9, -1.2, MV.mustard], [1.9, -1.2, MV.blush]] as const) pouf(b, x, z, c)
  sign(p, 'Презентационная зона', 0, 0.025, hz + 0.75, 0, 3, MV.coral, true)
  return { x: 0, z: 0, radius: 2.4 }
}

/** Телефонная капсула: глухой корпус, стеклянная дверь, кресло внутри */
function phoneBooth(b: StaticBuilder, x: number, z: number, rot: number): void {
  b.rbox(1.3, 2.2, 1.3, 0.12, x, 0, z, 'paint', MV.lavender, { rotY: rot, collide: true })
  const dx = Math.cos(rot) * 0.66, dz = -Math.sin(rot) * 0.66
  b.rbox(0.03, 1.8, 0.9, 0.02, x + dx, 0.15, z + dz, 'glass', 0xeaf4ff, { rotY: rot })
  b.rbox(0.7, 0.18, 0.04, 0.02, x, 2.0, z + 0.4, 'paint', MV.mustard, { rotY: rot })
}

/** Длинная кадка с кустами — высокое укрытие */
function planter(b: StaticBuilder, x: number, z: number, len: number, rot: number): void {
  b.rbox(len, 0.6, 0.6, 0.1, x, 0, z, 'paint', MV.creamLight, { rotY: rot })
  const c = Math.cos(rot), s = Math.sin(rot)
  const n = Math.round(len / 0.8)
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + 0.4 + (i * (len - 0.8)) / Math.max(1, n - 1)
    b.sphere(0.42, x + t * c, 0.95 + (i % 2) * 0.15, z - t * s, 'paint', i % 2 ? C.leaf : C.leafLight)
  }
  const ac = Math.abs(c), as = Math.abs(s)
  b.blocker(x, z, len * ac + 0.6 * as, len * as + 0.6 * ac, 1.5)
}

function column(b: StaticBuilder, x: number, z: number): void {
  b.box(0.6, 0.12, 0.6, x, 0, z, 'paint', C.archAlt)
  b.box(0.5, 2.6, 0.5, x, 0.12, z, 'paint', C.pillar, { collide: true })
  b.box(0.6, 0.1, 0.6, x, 2.72, z, 'paint', C.arch)
}

function acoustic(b: StaticBuilder, x: number, z: number, len: number, rot: number): void {
  b.rbox(len, 1.6, 0.1, 0.04, x, 0.05, z, 'fabric', MV.lavender, { rotY: rot, collide: true })
}

function kitchenZone(b: StaticBuilder, p: Placer, x0: number, z0: number): void {
  wallLine(b, 'x', z0, x0, W - 0.2, MV.teal, 2.2, [[x0 + 1.4, x0 + 2.8]])
  wallLine(b, 'z', x0, z0, D - 0.2, MV.teal, 2.2, [[z0 + 1.6, z0 + 3]])
  for (let i = 0; i < Math.floor((W - x0) / 1.1); i++) for (let j = 0; j < 4; j++) {
    b.box(1.08, 0.012, 1.08, x0 + 0.65 + i * 1.1, 0, z0 + 0.65 + j * 1.1, 'paint', (i + j) % 2 ? MV.mint : MV.creamLight)
  }
  p.put('kitchen', 'kitchencounter_sink_backsplash', W - 0.75, z0 + 1.2, -Math.PI / 2)
  p.put('kitchen', 'kitchencounter_straight_A_decorated', W - 0.75, z0 + 2.64, -Math.PI / 2)
  p.put('kitchen', 'fridge_A_decorated', W - 0.9, z0 + 4.0, -Math.PI / 2)
  p.put('kitchen', 'table_round_A_decorated', x0 + 2.2, z0 + 2.4, 0, { scale: 0.85 })
  sign(p, 'Кухня', x0 + 3.6, 1.6, z0 - 0.09, Math.PI, 1.2, MV.tealDeep)
}

/** Туалеты М и Ж: перегородки, кабинки, раковины, таблички */
function restrooms(b: StaticBuilder, p: Placer, x0: number, x1: number, z0: number, z1: number): void {
  const mid = (x0 + x1) / 2
  wallLine(b, 'z', x1, z0, z1, MV.lilac, 2.4)
  const half = (x1 - x0) / 2
  wallLine(b, 'x', z0, x0, x1, MV.lilac, 2.4, [[x0 + half / 2 - 0.55, x0 + half / 2 + 0.55], [x1 - half / 2 - 0.55, x1 - half / 2 + 0.55]])
  wallLine(b, 'z', mid, z0, z1, MV.lilac, 2.4)
  b.rbox(x1 - x0, 0.015, z1 - z0, 0.1, (x0 + x1) / 2, 0, (z0 + z1) / 2, 'matte', 0xe6f3f0)
  for (const [ax, bx, label, col] of [[x0, mid, 'Ж', MV.coral], [mid, x1, 'М', MV.teal]] as const) {
    const cx = (ax + bx) / 2
    const stalls = Math.max(1, Math.floor((bx - ax - 0.2) / 1.2))
    for (let k = 0; k < stalls; k++) {
      const sx = ax + 0.1 + k * 1.2
      if (k > 0) b.box(0.06, 1.9, 1.4, sx, 0.1, z1 - 0.7, 'paint', MV.creamLight, { collide: true })
      toilet(b, sx + 0.6, z1 - 0.4)
    }
    b.rbox(1.2, 0.85, 0.45, 0.05, cx, 0, z0 + 2.1, 'paint', MV.creamLight, { collide: true })
    b.cylinder(0.16, 0.12, 0.08, cx, 0.85, z0 + 2.1, 'plastic', MV.white)
    sign(p, label, cx, 1.95, z0 - 0.06, Math.PI, 0.5, col)
  }
}

// ======================= зоны =======================

function pouf(b: StaticBuilder, x: number, z: number, hex: number): void {
  b.cylinder(0.32, 0.34, 0.38, x, 0, z, 'fabric', hex, { collide: true, segments: 16 })
  b.cylinder(0.26, 0.32, 0.06, x, 0.38, z, 'fabric', hex, { segments: 16 })
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
  b.cylinder(0.32 * s, 0.26 * s, 0.5 * s, x, 0, z, 'paint', C.pot, { segments: 16 })
  b.blocker(x, z, 0.64 * s, 0.64 * s, 1.9 * s) // крона закрывает от выстрелов
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
