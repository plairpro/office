// Карта атласа персонажей: какие ячейки 64×64 на какой высоте тела (для перекраски одежды)
import * as THREE from 'three'
import { loadAssets, getAssets } from '../src/assets'
await loadAssets(() => {})
const out: Record<string, unknown> = {}
for (const [name, gltf] of Object.entries(getAssets().chars)) {
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const H = box.max.y - box.min.y
  let img: CanvasImageSource | null = null
  const cells: Record<string, { n: number; y0: number; y1: number; ys: number; z: number; groups: Set<string>; col?: string }> = {}
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh || o instanceof THREE.Mesh)) return
    const m = o as THREE.Mesh
    const mat = m.material as THREE.MeshStandardMaterial
    if (mat.map && !img) img = mat.map.image as CanvasImageSource
    const g = m.geometry
    const uv = g.attributes.uv, pos = g.attributes.position
    const v = new THREE.Vector3()
    const idx = g.index
    const n = idx ? idx.count : pos.count
    for (let t = 0; t < n; t += 3) {
      let u = 0, w = 0, y = 0, z = 0
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k
        u += uv.getX(i); w += uv.getY(i)
        if (m instanceof THREE.SkinnedMesh) m.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i)
        v.applyMatrix4(m.matrixWorld)
        y += v.y; z += v.z
      }
      u /= 3; w /= 3; y = (y / 3 - box.min.y) / H; z /= 3
      const cx = Math.floor(u * 16), cy = Math.floor(w * 16) // flipY=false у glTF: v вниз
      const key = `${cx},${cy}`
      const c = cells[key] ??= { n: 0, y0: 1, y1: 0, ys: 0, z: 0, groups: new Set() }
      c.n++; c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y); c.ys += y; c.z += z
      c.groups.add(m.name.replace(/^.*_/, ''))
    }
  })
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024
  const g2 = cv.getContext('2d')!
  if (img) g2.drawImage(img, 0, 0, 1024, 1024)
  out[name] = Object.entries(cells).sort((a, b) => b[1].ys / b[1].n - a[1].ys / a[1].n).map(([k, c]) => {
    const [x, y] = k.split(',').map(Number)
    const p = g2.getImageData(x * 64 + 32, y * 64 + 32, 1, 1).data
    return `${k.padEnd(6)} n=${String(c.n).padStart(4)} h=${(c.ys / c.n).toFixed(2)} [${c.y0.toFixed(2)}-${c.y1.toFixed(2)}] ${[...c.groups].join('/')} #${[p[0], p[1], p[2]].map((q) => q.toString(16).padStart(2, '0')).join('')}`
  })
}
;(window as unknown as { __atlas: unknown }).__atlas = out
