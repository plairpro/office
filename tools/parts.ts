// Связные куски геометрии в мешах персонажей: что тело, а что ремни, фляги и наплечники
import * as THREE from 'three'
import { loadAssets, getAssets } from '../src/assets'
import { meshComponents } from '../src/game/parts'
await loadAssets(() => {})
const out: Record<string, string[]> = {}
for (const [name, gltf] of Object.entries(getAssets().chars)) {
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const H = box.max.y - box.min.y
  const lines: string[] = []
  let img: CanvasImageSource | null = null
  scene.traverse((o) => { if (!img && o instanceof THREE.Mesh) img = ((o.material as THREE.MeshStandardMaterial).map?.image ?? null) as CanvasImageSource | null })
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024
  const ctx = cv.getContext('2d')!
  if (img) ctx.drawImage(img, 0, 0, 1024, 1024)
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    if (!/Body|Arm|Leg/.test(o.name)) return
    // по ячейкам: сколько треугольников, высота, вынос вперёд/вбок, цвет
    const g = o.geometry, uv = g.attributes.uv, idx = g.index!
    const v = new THREE.Vector3()
    const cell = new Map<string, { n: number; h0: number; h1: number; r: number; z: number }>()
    for (let t = 0; t < idx.count / 3; t++) {
      let cx = 0, cy = 0, hy = 0, rr = 0, zz = 0
      for (let k = 0; k < 3; k++) {
        const i = idx.getX(t * 3 + k)
        cx += uv.getX(i); cy += uv.getY(i)
        o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld)
        hy += (v.y - box.min.y) / H; rr += Math.hypot(v.x, v.z); zz += v.z
      }
      const key = `${Math.floor(cx / 3 * 16)},${Math.floor(cy / 3 * 16)}`
      const c = cell.get(key) ?? { n: 0, h0: 1, h1: 0, r: 0, z: 0 }
      c.n++; c.h0 = Math.min(c.h0, hy / 3); c.h1 = Math.max(c.h1, hy / 3); c.r += rr / 3; c.z += zz / 3
      cell.set(key, c)
    }
    for (const [k, c] of [...cell].sort((a, b) => b[1].n - a[1].n)) {
      const [x, y] = k.split(',').map(Number)
      const p = ctx.getImageData(x * 64 + 32, y * 64 + 32, 1, 1).data
      lines.push(`  ${o.name.padEnd(18)} cell ${k.padEnd(5)} n=${String(c.n).padStart(4)} h=${c.h0.toFixed(2)}-${c.h1.toFixed(2)} r=${(c.r / c.n).toFixed(2)} z=${(c.z / c.n).toFixed(2)} #${[p[0], p[1], p[2]].map((q) => q.toString(16).padStart(2, '0')).join('')}`)
    }
    const comps = meshComponents(o)
    comps.forEach((c, i) => {
      lines.push(`${o.name.padEnd(22)} #${i} tris=${String(c.tris.length).padStart(4)} h=${((c.min.y - box.min.y) / H).toFixed(2)}-${((c.max.y - box.min.y) / H).toFixed(2)} x=${c.min.x.toFixed(2)}..${c.max.x.toFixed(2)} z=${c.min.z.toFixed(2)}..${c.max.z.toFixed(2)} cells=${[...c.cells].slice(0, 6).join(' ')}`)
    })
  })
  out[name] = lines
}
;(window as unknown as { __parts: unknown }).__parts = out
