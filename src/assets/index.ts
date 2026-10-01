import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GRADE_PALETTE } from '../scene/palette'

import furnitureUrl from './furniture.glb?url'
import kitchenUrl from './kitchen.glb?url'
import protoUrl from './proto.glb?url'
import animsUrl from './char_anims.glb?url'
import knightUrl from './char_knight.glb?url'
import barbarianUrl from './char_barbarian.glb?url'
import mageUrl from './char_mage.glb?url'
import rogueUrl from './char_rogue.glb?url'

export type PackName = 'furniture' | 'kitchen' | 'proto'
export type BaseChar = 'knight' | 'barbarian' | 'mage' | 'rogue'

export interface Assets {
  packs: Record<PackName, Map<string, THREE.Object3D>>
  chars: Record<BaseChar, GLTF>
  clips: Map<string, THREE.AnimationClip>
}

let assets: Assets | null = null

export function getAssets(): Assets {
  if (!assets) throw new Error('ассеты ещё не загружены')
  return assets
}

/**
 * Загружает все модели (CC0-паки KayKit, ~2.4 МБ в сжатом виде).
 * onProgress получает долю 0..1.
 */
export async function loadAssets(onProgress: (p: number) => void): Promise<Assets> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const urls = [furnitureUrl, kitchenUrl, protoUrl, animsUrl, knightUrl, barbarianUrl, mageUrl, rogueUrl]
  let done = 0
  const load = (u: string) => loader.loadAsync(u).then((g) => { onProgress(++done / urls.length); return g })
  const [furniture, kitchen, proto, anims, knight, barbarian, mage, rogue] = await Promise.all(urls.map(load))

  const pack = (g: GLTF): Map<string, THREE.Object3D> => {
    const map = new Map<string, THREE.Object3D>()
    g.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
        pastelize(o.material as THREE.MeshStandardMaterial)
      }
    })
    for (const child of g.scene.children) map.set(child.name, child)
    return map
  }

  // персонажи — лёгкая цветокоррекция (кожа и волосы остаются живыми)
  for (const g of [knight, barbarian, mage, rogue]) {
    g.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const m = o.material as THREE.MeshStandardMaterial
      m.roughness = 0.85
      m.metalness = 0
      if (m.map && !graded.has(m.map)) {
        graded.add(m.map)
        m.map.image = gradeImage(m.map.image as CanvasImageSource & { width: number; height: number }, 0.3)
        m.map.needsUpdate = true
      }
    })
  }

  assets = {
    packs: { furniture: pack(furniture), kitchen: pack(kitchen), proto: pack(proto) },
    chars: { knight, barbarian, mage, rogue },
    clips: new Map(anims.animations.map((c) => [c.name, c])),
  }
  return assets
}

const graded = new WeakSet<THREE.Texture>()
const PAL = GRADE_PALETTE.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255])

/**
 * Цветокоррекция атласа в палитру Monument Valley: каждый цвет тянется к ближайшему
 * тону палитры с сохранением светотени. Один раз на текстуру.
 */
function pastelize(m: THREE.MeshStandardMaterial): void {
  m.roughness = 0.9
  m.metalness = 0
  const tex = m.map
  if (!tex || graded.has(tex)) return
  graded.add(tex)
  tex.image = gradeImage(tex.image as CanvasImageSource & { width: number; height: number }, 0.6)
  tex.needsUpdate = true
}

export function gradeImage(img: CanvasImageSource & { width: number; height: number }, amount: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height)
  const px = d.data
  const cache = new Map<number, number>()
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
    let out = cache.get(key)
    if (out === undefined) {
      let r = px[i], gr = px[i + 1], b = px[i + 2]
      // мягче и светлее
      const l = 0.3 * r + 0.59 * gr + 0.11 * b
      r = (l + (r - l) * 0.7) * 0.85 + 255 * 0.15
      gr = (l + (gr - l) * 0.7) * 0.85 + 255 * 0.15
      b = (l + (b - l) * 0.7) * 0.85 + 255 * 0.15
      // ближайший тон палитры (по цвету, без учёта яркости)
      const L = 0.3 * r + 0.59 * gr + 0.11 * b + 1
      let best = PAL[0], bd = Infinity
      for (const p of PAL) {
        const pl = 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2] + 1
        const dr = p[0] / pl - r / L, dg = p[1] / pl - gr / L, db = p[2] / pl - b / L
        const dist = dr * dr + dg * dg + db * db + 0.15 * ((pl - L) / 255) ** 2
        if (dist < bd) { bd = dist; best = p }
      }
      const pl = 0.3 * best[0] + 0.59 * best[1] + 0.11 * best[2] + 1
      const k = L / pl
      const R = Math.min(255, r * (1 - amount) + best[0] * k * amount)
      const G = Math.min(255, gr * (1 - amount) + best[1] * k * amount)
      const B = Math.min(255, b * (1 - amount) + best[2] * k * amount)
      out = (R << 16) | (G << 8) | B
      cache.set(key, out)
    }
    px[i] = (out >> 16) & 255
    px[i + 1] = (out >> 8) & 255
    px[i + 2] = out & 255
  }
  g.putImageData(d, 0, 0)
  return c
}

/** Копия модели из пака (геометрия и материал общие) */
export function prop(pack: PackName, name: string): THREE.Object3D {
  const src = getAssets().packs[pack].get(name)
  if (!src) throw new Error(`нет модели ${pack}/${name}`)
  return src.clone(true)
}
