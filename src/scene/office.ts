import * as THREE from 'three'
import { StaticBuilder, type AABB } from './builder'

export interface Spawn { x: number; z: number; rot: number }

export interface Office {
  group: THREE.Group
  colliders: AABB[]
  spawns: Spawn[]
  cooler: { x: number; z: number; radius: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

// Палитра: тёплый стилизованный офис
const C = {
  carpet: 0x7d8aa0, carpetDark: 0x6c7890, wood: 0xb98a5e, tiles: 0xe8e2d4, serverFloor: 0x3b4252,
  wall: 0xefe6d8, wallTrim: 0xc9bba8, skirt: 0xd6c9b6, drywall: 0xe3ddd2,
  desk: 0xf2efe9, deskLeg: 0x5c6370, monitor: 0x2b2f36, screen: 0x7fd3ff, chair: 0x30343c,
  keyboard: 0x444a54, mug: 0xe85d4a, paper: 0xffffff,
  partition: 0x9fb3c8, partitionFrame: 0x6b7a8c,
  coolerBody: 0xf4f4f4, coolerWater: 0x6fc3ff, coolerRug: 0x5fbfa8,
  pot: 0xc0643c, leaf: 0x4caf50, leafDark: 0x388e3c,
  elevFrame: 0x8e98a3, elevDoor: 0xc7ced6, elevLight: 0xffd166,
  rack: 0x22262e, ledGreen: 0x39ff88, ledRed: 0xff4d4d,
  glass: 0xbfe6ff, glassFrame: 0x8a949e,
  counter: 0xfafafa, cabinet: 0x5aa9a0, fridge: 0xdfe4ea,
  printer: 0xdcdcdc, box: 0xc9a26b, sofa: 0xd97b4a, table: 0x8d6e63,
}

// Детерминированный генератор: у всех игроков одинаковая расстановка мелочей
let seed = 1337
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const W = 18 // полуширина карты по X
const D = 14 // полуглубина по Z
const WALL_H = 3
const SKIRT_H = 0.45
const T = 0.3

export function buildOffice(): Office {
  seed = 1337
  const b = new StaticBuilder()

  floors(b)
  outerWalls(b)
  meetingRoom(b)
  serverRoom(b)
  kitchen(b)

  // Кластеры столов open-space
  const clusters: [number, number, number][] = [
    [-12, 3.5, 0], [-5, -8.5, 0], [5, -8.5, 0], [-5, 8.5, 0], [5, 8.5, 0], [13, -1, Math.PI / 2],
  ]
  for (const [x, z, r] of clusters) deskCluster(b, x, z, r)

  // Перегородки-кубиклы — укрытия
  partition(b, -8.2, -0.5, 3.4, Math.PI / 2)
  partition(b, 8.6, 3, 3.4, Math.PI / 2)
  partition(b, -0.5, 4.6, 3.2, 0)
  partition(b, 1, -4.8, 3.2, 0)

  const cooler = { x: 0, z: 0, radius: 2.6 }
  waterCooler(b, cooler.x, cooler.z, cooler.radius)

  // Лифты — по одному на каждого игрока (точки появления и цели режима «Документы»)
  const spawns: Spawn[] = [
    elevator(b, 0, -D, 0), // север
    elevator(b, -W, 6, Math.PI / 2), // запад
    elevator(b, -3, D, Math.PI), // юг
    elevator(b, W, 3, -Math.PI / 2), // восток
  ]

  // Мелочи
  plant(b, -16.8, 12.8); plant(b, 9.5, -12.8); plant(b, -8.6, -12.8); plant(b, 2.4, 12.8)
  plant(b, -2.8, -2.6, 0.7); plant(b, 2.8, 2.6, 0.7)
  printer(b, -2.6, -12.9)
  boxes(b, 16.6, -6.2)
  boxes(b, -16.5, 9.6)

  return {
    group: b.build(),
    colliders: b.colliders,
    spawns,
    cooler,
    bounds: { minX: -W, maxX: W, minZ: -D, maxZ: D },
  }
}

// ---------- зоны ----------

function floors(b: StaticBuilder): void {
  b.box(W * 2, 0.1, D * 2, 0, -0.1, 0, C.carpet)
  // дорожки посветлее/потемнее для читаемости
  b.box(W * 2 - 2, 0.01, 2.4, 0, 0, 0, C.carpetDark)
  b.box(2.4, 0.01, D * 2 - 2, 0, 0, 0, C.carpetDark)
  b.box(8, 0.02, 7, -14, 0, -10.5, C.wood) // переговорка
  b.box(7, 0.02, 6, 14.5, 0, -11, C.serverFloor) // серверная
  b.box(7, 0.02, 8, 14.5, 0, 10, C.tiles) // кухня
}

function outerWalls(b: StaticBuilder): void {
  // дальние стены высокие, ближние к камере — низкий бортик (срез, как в изометрических играх)
  wallX(b, -D, -W, W, WALL_H, C.wall, [[-1.2, 1.2]])
  wallZ(b, -W, -D, D, WALL_H, C.wall, [[4.8, 7.2]])
  wallX(b, D, -W, W, SKIRT_H, C.skirt, [[-4.2, -1.8]])
  wallZ(b, W, -D, D, SKIRT_H, C.skirt, [[1.8, 4.2]])
  // плинтус у высоких стен
  b.box(W * 2, 0.15, 0.05, 0, 0, -D + T / 2 + 0.03, C.wallTrim)
  b.box(0.05, 0.15, D * 2, -W + T / 2 + 0.03, 0, 0, C.wallTrim)
}

function meetingRoom(b: StaticBuilder): void {
  // стеклянные стены с проёмами
  glassWallZ(b, -10, -D, -7, [[-9.6, -8]])
  glassWallX(b, -7, -W, -10, [[-14.4, -12.8]])
  // стол и кресла
  b.box(4.2, 0.08, 1.8, -14, 0.72, -10.5, C.table, { collide: true })
  b.box(0.15, 0.72, 0.15, -15.8, 0, -10.5, C.deskLeg)
  b.box(0.15, 0.72, 0.15, -12.2, 0, -10.5, C.deskLeg)
  for (let i = 0; i < 3; i++) {
    chair(b, -15.3 + i * 1.3, -11.8, 0)
    chair(b, -15.3 + i * 1.3, -9.2, Math.PI)
  }
  // экран на стене
  b.box(2.6, 1.4, 0.08, -14, 1.2, -D + T / 2 + 0.05, C.monitor)
  b.box(2.4, 1.2, 0.02, -14, 1.3, -D + T / 2 + 0.1, 0x9fd8ff, { layer: 'glow' })
}

function serverRoom(b: StaticBuilder): void {
  const x0 = 11
  wallZ(b, x0, -D, -8, 2.6, C.drywall, [[-11.2, -9.6]])
  wallX(b, -8, x0, W, 2.6, C.drywall, [])
  for (let i = 0; i < 4; i++) {
    const z = -12.6 + i * 1.25
    rack(b, 16.6, z)
    if (i < 3) rack(b, 13.4, z + 0.6)
  }
}

function kitchen(b: StaticBuilder): void {
  // стойка вдоль восточной стены
  b.box(1, 0.9, 6, 17.2, 0, 10.2, C.cabinet, { collide: true })
  b.box(1.1, 0.06, 6.1, 17.2, 0.9, 10.2, C.counter)
  // холодильник и микроволновка
  b.box(1.1, 2.1, 1, 17.2, 0, 6.4, C.fridge, { collide: true })
  b.box(0.06, 0.5, 0.06, 16.62, 1.1, 6.1, C.deskLeg)
  b.box(0.6, 0.35, 0.45, 17.2, 0.96, 12, C.monitor)
  // остров
  b.box(2.6, 0.9, 1.2, 13.4, 0, 10.5, C.cabinet, { collide: true })
  b.box(2.8, 0.06, 1.4, 13.4, 0.9, 10.5, C.counter)
  for (let i = 0; i < 3; i++) b.cylinder(0.22, 0.22, 0.75, 12.6 + i * 0.8, 0, 11.7, C.chair, { segments: 8 })
  b.cylinder(0.08, 0.06, 0.14, 13, 0.96, 10.4, C.mug, { segments: 8 })
  b.cylinder(0.08, 0.06, 0.14, 13.6, 0.96, 10.7, 0x3d8bfd, { segments: 8 })
  // диванчик
  b.box(2.6, 0.45, 0.9, 13.6, 0, 13.1, C.sofa, { collide: true })
  b.box(2.6, 0.5, 0.25, 13.6, 0.45, 13.45, C.sofa)
}

// ---------- мебель ----------

function deskCluster(b: StaticBuilder, cx: number, cz: number, rot: number): void {
  // 4 стола «лицом к лицу»: 2 x 2
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const at = (lx: number, lz: number): [number, number] => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos]
  for (const lx of [-0.8, 0.8]) {
    for (const lz of [-0.45, 0.45]) {
      const [x, z] = at(lx, lz)
      const face = lz < 0 ? 1 : -1 // монитор смотрит на сидящего
      b.box(1.55, 0.06, 0.85, x, 0.72, z, C.desk, { rotY: rot })
      const [mx, mz] = at(lx, lz - face * 0.25)
      b.box(0.62, 0.38, 0.05, mx, 0.86, mz, C.monitor, { rotY: rot })
      const [sx, sz] = at(lx, lz - face * 0.22)
      b.box(0.56, 0.32, 0.02, sx, 0.89, sz, rand() < 0.8 ? C.screen : 0xffb86b, { layer: 'glow', rotY: rot })
      const [kx, kz] = at(lx, lz + face * 0.12)
      b.box(0.45, 0.02, 0.15, kx, 0.78, kz, C.keyboard, { rotY: rot })
      if (rand() < 0.5) {
        const [ux, uz] = at(lx + 0.55, lz + face * 0.1)
        b.cylinder(0.05, 0.04, 0.1, ux, 0.78, uz, C.mug, { segments: 6 })
      }
      if (rand() < 0.5) {
        const [px, pz] = at(lx - 0.5, lz + face * 0.05)
        b.box(0.25, 0.08 + rand() * 0.12, 0.32, px, 0.78, pz, C.paper, { rotY: rot + 0.2 })
      }
      const [cx2, cz2] = at(lx, lz + face * 0.75)
      chair(b, cx2, cz2, rot + (face > 0 ? Math.PI : 0))
    }
  }
  // ножки-тумбы
  for (const lx of [-1.5, 0, 1.5]) {
    const [x, z] = at(lx, 0)
    b.box(0.08, 0.72, 1.6, x, 0, z, C.deskLeg, { rotY: rot })
  }
  // перегородка между рядами
  const [px, pz] = at(0, 0)
  b.box(3.1, 0.35, 0.05, px, 0.78, pz, C.partition, { rotY: rot })
  // препятствие — сам блок столов
  const ac = Math.abs(cos), as = Math.abs(sin)
  b.blocker(cx, cz, 3.2 * ac + 1.8 * as, 3.2 * as + 1.8 * ac)
}

function chair(b: StaticBuilder, x: number, z: number, rot: number): void {
  b.cylinder(0.04, 0.22, 0.42, x, 0, z, C.deskLeg, { segments: 5 })
  b.box(0.5, 0.08, 0.5, x, 0.42, z, C.chair, { rotY: rot })
  const bx = x - Math.sin(rot) * 0.22, bz = z - Math.cos(rot) * 0.22
  b.box(0.48, 0.5, 0.07, bx, 0.5, bz, C.chair, { rotY: rot })
}

function partition(b: StaticBuilder, x: number, z: number, len: number, rot: number): void {
  b.box(len, 1.25, 0.12, x, 0, z, C.partition, { collide: true, rotY: rot })
  b.box(len + 0.06, 0.06, 0.16, x, 1.25, z, C.partitionFrame, { rotY: rot })
}

function waterCooler(b: StaticBuilder, x: number, z: number, radius: number): void {
  b.cylinder(radius, radius, 0.02, x, 0, z, C.coolerRug, { segments: 28 })
  b.cylinder(radius - 0.25, radius - 0.25, 0.025, x, 0, z, 0x6fd0b8, { segments: 28 })
  b.box(0.5, 1.0, 0.5, x, 0, z, C.coolerBody, { collide: true })
  b.box(0.06, 0.06, 0.12, x - 0.1, 0.75, z + 0.28, 0x3d8bfd)
  b.box(0.06, 0.06, 0.12, x + 0.1, 0.75, z + 0.28, 0xe8505b)
  b.cylinder(0.22, 0.24, 0.55, x, 1.0, z, C.coolerWater, { segments: 12 })
  b.cylinder(0.08, 0.2, 0.1, x, 1.55, z, C.coolerWater, { segments: 12 })
}

function elevator(b: StaticBuilder, x: number, z: number, rot: number): Spawn {
  // rot — куда «смотрит» лифт (в комнату). 0 = на юг (+z)
  const dx = Math.sin(rot), dz = Math.cos(rot)
  const px = -dz, pz = dx // вдоль стены
  const inset = T / 2 + 0.06
  const fx = x + dx * inset, fz = z + dz * inset
  const h = 2.6
  // рамка
  b.box(0.3, h, 0.35, fx + px * 1.25, 0, fz + pz * 1.25, C.elevFrame, { rotY: rot, collide: true })
  b.box(0.3, h, 0.35, fx - px * 1.25, 0, fz - pz * 1.25, C.elevFrame, { rotY: rot, collide: true })
  b.box(2.8, 0.35, 0.35, fx, h, fz, C.elevFrame, { rotY: rot })
  // створки
  b.box(1.08, h - 0.05, 0.08, fx + px * 0.55, 0, fz + pz * 0.55, C.elevDoor, { rotY: rot })
  b.box(1.08, h - 0.05, 0.08, fx - px * 0.55, 0, fz - pz * 0.55, C.elevDoor, { rotY: rot })
  b.box(0.02, h - 0.1, 0.1, fx, 0, fz, C.elevFrame, { rotY: rot })
  // табло
  b.box(0.7, 0.2, 0.05, fx + dx * 0.2, h + 0.08, fz + dz * 0.2, C.elevLight, { rotY: rot, layer: 'glow' })
  // коврик перед лифтом
  b.box(2.4, 0.015, 1.4, fx + dx * 0.9, 0, fz + dz * 0.9, 0x55606f, { rotY: rot })
  b.blocker(fx, fz, Math.abs(px) * 2.6 + Math.abs(dx) * 0.4, Math.abs(pz) * 2.6 + Math.abs(dz) * 0.4)
  return { x: fx + dx * 1.7, z: fz + dz * 1.7, rot }
}

function rack(b: StaticBuilder, x: number, z: number): void {
  b.box(0.9, 2.1, 0.8, x, 0, z, C.rack, { collide: true })
  for (let i = 0; i < 7; i++) {
    const y = 0.25 + i * 0.26
    b.box(0.7, 0.04, 0.02, x, y, z + 0.41, 0x3a404a)
    b.box(0.05, 0.04, 0.02, x - 0.25 + rand() * 0.5, y + 0.06, z + 0.415,
      rand() < 0.8 ? C.ledGreen : C.ledRed, { layer: 'glow' })
  }
}

function plant(b: StaticBuilder, x: number, z: number, scale = 1): void {
  b.cylinder(0.28 * scale, 0.22 * scale, 0.5 * scale, x, 0, z, C.pot, { collide: true, segments: 8 })
  b.sphere(0.45 * scale, x, 0.85 * scale, z, C.leaf)
  b.sphere(0.32 * scale, x + 0.2 * scale, 1.15 * scale, z - 0.1 * scale, C.leafDark)
  b.sphere(0.28 * scale, x - 0.18 * scale, 1.2 * scale, z + 0.12 * scale, C.leaf)
}

function printer(b: StaticBuilder, x: number, z: number): void {
  b.box(1.0, 0.75, 0.7, x, 0, z, C.deskLeg, { collide: true })
  b.box(0.9, 0.45, 0.65, x, 0.75, z, C.printer)
  b.box(0.5, 0.03, 0.3, x, 1.2, z + 0.1, C.paper)
  b.box(0.12, 0.05, 0.05, x + 0.3, 1.2, z - 0.2, C.ledGreen, { layer: 'glow' })
}

function boxes(b: StaticBuilder, x: number, z: number): void {
  b.box(0.8, 0.6, 0.8, x, 0, z, C.box, { collide: true })
  b.box(0.6, 0.45, 0.6, x + 0.1, 0.6, z - 0.05, C.box, { rotY: 0.4 })
  b.box(0.7, 0.5, 0.7, x - 0.2, 0, z + 0.85, C.box, { collide: true, rotY: 0.2 })
}

// ---------- стены ----------

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

function wallX(b: StaticBuilder, z: number, x0: number, x1: number, h: number, hex: number, gaps: [number, number][]): void {
  for (const [a, c] of segments(x0, x1, gaps)) b.box(c - a, h, T, (a + c) / 2, 0, z, hex, { collide: true })
}

function wallZ(b: StaticBuilder, x: number, z0: number, z1: number, h: number, hex: number, gaps: [number, number][]): void {
  for (const [a, c] of segments(z0, z1, gaps)) b.box(T, h, c - a, x, 0, (a + c) / 2, hex, { collide: true })
}

function glassWallX(b: StaticBuilder, z: number, x0: number, x1: number, gaps: [number, number][]): void {
  for (const [a, c] of segments(x0, x1, gaps)) {
    b.box(c - a, 2.4, 0.06, (a + c) / 2, 0.1, z, C.glass, { layer: 'glass', collide: true })
    b.box(c - a, 0.1, 0.12, (a + c) / 2, 0, z, C.glassFrame)
    b.box(c - a, 0.08, 0.12, (a + c) / 2, 2.5, z, C.glassFrame)
  }
}

function glassWallZ(b: StaticBuilder, x: number, z0: number, z1: number, gaps: [number, number][]): void {
  for (const [a, c] of segments(z0, z1, gaps)) {
    b.box(0.06, 2.4, c - a, x, 0.1, (a + c) / 2, C.glass, { layer: 'glass', collide: true })
    b.box(0.12, 0.1, c - a, x, 0, (a + c) / 2, C.glassFrame)
    b.box(0.12, 0.08, c - a, x, 2.5, (a + c) / 2, C.glassFrame)
  }
}
