import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import * as TX from './textures'

/** Прямоугольник препятствия на полу (вид сверху), центр + полуразмеры */
export interface AABB {
  x: number
  z: number
  hw: number
  hd: number
  /** высота верха препятствия: выше SHOT_HEIGHT — блокирует выстрелы, ниже — только движение */
  top: number
}

/** Выстрелы летят на высоте груди: всё, что ниже, — укрытие только от тарана, не от пуль */
export const SHOT_HEIGHT = 1.0
export const blocksShots = (c: AABB): boolean => c.top >= SHOT_HEIGHT

/** Тип поверхности: от него зависят текстура, шероховатость, металличность */
export type Kind =
  | 'paint' | 'tile' | 'carpet' | 'wood' | 'darkwood' | 'marble' | 'metal' | 'chrome'
  | 'plastic' | 'matte' | 'fabric' | 'leather' | 'glass' | 'screen' | 'light' | 'foliage'

interface KindDef {
  scale?: number // метров на повтор текстуры (мировые UV)
  ownUV?: boolean // использовать UV самой геометрии (экраны)
  castShadow?: boolean
  make(): THREE.Material
}

let textures: ReturnType<typeof loadTextures> | null = null
function loadTextures() {
  return {
    tile: TX.tileTexture(),
    wood: TX.woodTexture(),
    screen: TX.screenTexture(),
  }
}

// Мягкие матовые материалы в тон ассетам KayKit: плоский цвет из вершин
const t = (p: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...p })

const KINDS: Record<Kind, KindDef> = {
  paint: { castShadow: true, make: () => t() },
  tile: { scale: 1.6, make: () => t({ map: textures!.tile, roughness: 0.6 }) },
  carpet: { make: () => t({ roughness: 1 }) },
  wood: { scale: 1.2, castShadow: true, make: () => t({ map: textures!.wood }) },
  darkwood: { scale: 1.2, castShadow: true, make: () => t({ map: textures!.wood, color: 0xc9a98e }) },
  marble: { castShadow: true, make: () => t({ roughness: 0.35 }) },
  metal: { castShadow: true, make: () => t({ roughness: 0.5, metalness: 0.3 }) },
  chrome: { castShadow: true, make: () => t({ roughness: 0.25, metalness: 0.7 }) },
  plastic: { castShadow: true, make: () => t({ roughness: 0.55 }) },
  matte: { castShadow: true, make: () => t() },
  fabric: { castShadow: true, make: () => t({ roughness: 1 }) },
  leather: { castShadow: true, make: () => t({ roughness: 0.6 }) },
  foliage: { castShadow: true, make: () => t({ side: THREE.DoubleSide }) },
  glass: {
    make: () => new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide,
    }),
  },
  screen: {
    ownUV: true,
    make: () => new THREE.MeshBasicMaterial({ vertexColors: true, map: textures!.screen, toneMapped: false }),
  },
  // цвет ×1.8 — ярче единицы, только эти поверхности светятся в bloom
  light: { make: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8) }) },
}

const ORDER = Object.keys(KINDS) as Kind[]

interface Opts { collide?: boolean; rotY?: number; rotX?: number; rotZ?: number }

/**
 * Собирает статичную геометрию: по одному мешу на тип поверхности (≈15 вызовов отрисовки на весь офис).
 * UV считаются от мировых координат — текстуры плитки, дерева и т.п. ложатся ровно и без растяжений.
 */
export class StaticBuilder {
  private parts = new Map<Kind, THREE.BufferGeometry[]>()
  readonly colliders: AABB[] = []
  private color = new THREE.Color()

  constructor() { textures ??= loadTextures() }

  box(w: number, h: number, d: number, x: number, y: number, z: number, kind: Kind, hex = 0xffffff, o: Opts = {}): void {
    // все грани чуть скруглены — мягкий «игрушечный» вид вместо острых кубов
    const r = Math.min(0.045, Math.min(w, h, d) * 0.3)
    const g = r > 0.006 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)
    this.add(g, x, y + h / 2, z, kind, hex, o)
    if (o.collide) this.collideBox(w, d, x, z, o.rotY ?? 0, y + h)
  }

  /** Коробка со скруглёнными рёбрами — диваны, подушки, техника */
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, kind: Kind, hex = 0xffffff, o: Opts = {}): void {
    this.add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), x, y + h / 2, z, kind, hex, o)
    if (o.collide) this.collideBox(w, d, x, z, o.rotY ?? 0, y + h)
  }

  cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, kind: Kind, hex = 0xffffff,
    o: Opts & { segments?: number } = {}): void {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, h, o.segments ?? 20), x, y + h / 2, z, kind, hex, o)
    if (o.collide) {
      const r = Math.max(rTop, rBottom)
      this.colliders.push({ x, z, hw: r, hd: r, top: y + h })
    }
  }

  sphere(r: number, x: number, y: number, z: number, kind: Kind, hex = 0xffffff, sx = 1, sy = 1, sz = 1, o: Opts = {}): void {
    const g = new THREE.SphereGeometry(r, 16, 12)
    g.scale(sx, sy, sz)
    this.add(g, x, y, z, kind, hex, o)
  }

  /** Произвольная геометрия */
  geo(g: THREE.BufferGeometry, x: number, y: number, z: number, kind: Kind, hex = 0xffffff, o: Opts = {}): void {
    this.add(g, x, y, z, kind, hex, o)
  }

  /** Только препятствие, без геометрии. top — высота (по умолчанию стена, блокирует выстрелы) */
  blocker(x: number, z: number, w: number, d: number, top = 3): void {
    this.colliders.push({ x, z, hw: w / 2, hd: d / 2, top })
  }

  private collideBox(w: number, d: number, x: number, z: number, r: number, top: number): void {
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
    this.colliders.push({ x, z, hw: (w * c + d * s) / 2, hd: (w * s + d * c) / 2, top })
  }

  private add(g0: THREE.BufferGeometry, x: number, y: number, z: number, kind: Kind, hex: number, o: Opts): void {
    if (o.rotX) g0.rotateX(o.rotX)
    if (o.rotZ) g0.rotateZ(o.rotZ)
    if (o.rotY) g0.rotateY(o.rotY)
    g0.translate(x, y, z)
    const g = g0.index ? g0.toNonIndexed() : g0
    if (g !== g0) g0.dispose()
    const def = KINDS[kind]

    const pos = g.getAttribute('position')
    const nrm = g.getAttribute('normal')
    const n = pos.count
    if (!def.ownUV) {
      // мировые UV: проекция по доминирующей оси нормали
      const s = 1 / (def.scale ?? 1)
      const uv = new Float32Array(n * 2)
      for (let i = 0; i < n; i++) {
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i))
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
        if (ay >= ax && ay >= az) { uv[i * 2] = px * s; uv[i * 2 + 1] = pz * s }
        else if (ax >= az) { uv[i * 2] = pz * s; uv[i * 2 + 1] = py * s }
        else { uv[i * 2] = px * s; uv[i * 2 + 1] = py * s }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    }

    this.color.setHex(hex)
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.color.r
      colors[i * 3 + 1] = this.color.g
      colors[i * 3 + 2] = this.color.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // одинаковый набор атрибутов у всех — иначе склейка не сработает
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
    }
    if (!this.parts.has(kind)) this.parts.set(kind, [])
    this.parts.get(kind)!.push(g)
  }

  build(): THREE.Group {
    const group = new THREE.Group()
    for (const kind of ORDER) {
      const list = this.parts.get(kind)
      if (!list?.length) continue
      const merged = mergeGeometries(list, false)
      list.forEach((g) => g.dispose())
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, KINDS[kind].make())
      mesh.name = kind
      mesh.receiveShadow = kind !== 'light' && kind !== 'glass'
      mesh.castShadow = !!KINDS[kind].castShadow
      if (kind === 'glass') mesh.renderOrder = 2
      group.add(mesh)
    }
    return group
  }
}
