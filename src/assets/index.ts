import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

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

  assets = {
    packs: { furniture: pack(furniture), kitchen: pack(kitchen), proto: pack(proto) },
    chars: { knight, barbarian, mage, rogue },
    clips: new Map(anims.animations.map((c) => [c.name, c])),
  }
  return assets
}

const pastelDone = new WeakSet<THREE.Texture>()

/** Смягчает атлас пака в пастель: чуть светлее и менее насыщенно. Один раз на текстуру. */
function pastelize(m: THREE.MeshStandardMaterial): void {
  m.roughness = 0.85
  m.metalness = 0
  const tex = m.map
  if (!tex || pastelDone.has(tex)) return
  pastelDone.add(tex)
  const img = tex.image as ImageBitmap | HTMLImageElement
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height)
  const px = d.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gr = px[i + 1], b = px[i + 2]
    const l = 0.3 * r + 0.59 * gr + 0.11 * b
    // −20% насыщенности, затем 18% к белому
    const s = 0.8, w = 0.18
    px[i] = (l + (r - l) * s) * (1 - w) + 255 * w
    px[i + 1] = (l + (gr - l) * s) * (1 - w) + 255 * w
    px[i + 2] = (l + (b - l) * s) * (1 - w) + 255 * w
  }
  g.putImageData(d, 0, 0)
  tex.image = c
  tex.needsUpdate = true
}

/** Копия модели из пака (геометрия и материал общие) */
export function prop(pack: PackName, name: string): THREE.Object3D {
  const src = getAssets().packs[pack].get(name)
  if (!src) throw new Error(`нет модели ${pack}/${name}`)
  return src.clone(true)
}
