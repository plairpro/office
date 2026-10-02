import * as THREE from 'three'

export interface Component {
  tris: number[] // индексы треугольников
  min: THREE.Vector3
  max: THREE.Vector3
  cells: Set<string> // ячейки атласа 16×16
}

/** Делит меш на связные куски (вершины склеиваем по позиции — в glTF швы UV разрезают их) */
export function meshComponents(m: THREE.SkinnedMesh): Component[] {
  const g = m.geometry
  const pos = g.attributes.position
  const uv = g.attributes.uv
  const idx = g.index
  const triCount = (idx ? idx.count : pos.count) / 3
  const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  // склейка вершин по позиции
  const key = new Map<string, number>()
  const canon = new Int32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    let c = key.get(k)
    if (c === undefined) { c = key.size; key.set(k, c) }
    canon[i] = c
  }
  const parent = new Int32Array(key.size).map((_, i) => i)
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  for (let t = 0; t < triCount; t++) {
    const a = find(canon[vi(t, 0)]), b = find(canon[vi(t, 1)]), c = find(canon[vi(t, 2)])
    parent[b] = a; parent[find(c)] = a
  }
  const groups = new Map<number, Component>()
  const v = new THREE.Vector3()
  m.updateMatrixWorld(true)
  for (let t = 0; t < triCount; t++) {
    const r = find(canon[vi(t, 0)])
    let c = groups.get(r)
    if (!c) { c = { tris: [], min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), cells: new Set() }; groups.set(r, c) }
    c.tris.push(t)
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k)
      m.getVertexPosition(i, v)
      v.applyMatrix4(m.matrixWorld)
      c.min.min(v); c.max.max(v)
    }
    const i0 = vi(t, 0)
    c.cells.add(`${Math.floor(uv.getX(i0) * 16)},${Math.floor(uv.getY(i0) * 16)}`)
  }
  return [...groups.values()].sort((a, b) => b.tris.length - a.tris.length)
}

/** Убирает куски из меша: их треугольники становятся вырожденными */
export function removeComponents(m: THREE.SkinnedMesh, comps: Component[]): void {
  const g = m.geometry
  if (!g.index) return
  const idx = g.index
  for (const c of comps) for (const t of c.tris) {
    const a = idx.getX(t * 3)
    idx.setX(t * 3 + 1, a); idx.setX(t * 3 + 2, a)
  }
  idx.needsUpdate = true
}
