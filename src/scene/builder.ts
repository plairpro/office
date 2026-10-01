import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Прямоугольник препятствия на полу (вид сверху), центр + полуразмеры */
export interface AABB {
  x: number
  z: number
  hw: number
  hd: number
}

type Layer = 'solid' | 'glow' | 'glass'

/**
 * Собирает статичную геометрию в 3 меша (обычный, светящийся, стекло) с цветами в вершинах.
 * Весь офис рисуется за 3 вызова отрисовки — быстро даже на встроенной графике.
 */
export class StaticBuilder {
  private parts: Record<Layer, THREE.BufferGeometry[]> = { solid: [], glow: [], glass: [] }
  readonly colliders: AABB[] = []
  private color = new THREE.Color()

  box(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    hex: number,
    opts: { collide?: boolean; layer?: Layer; rotY?: number } = {},
  ): void {
    const g = new THREE.BoxGeometry(w, h, d)
    if (opts.rotY) g.rotateY(opts.rotY)
    g.translate(x, y + h / 2, z)
    this.push(g, hex, opts.layer ?? 'solid')
    if (opts.collide) {
      // для повёрнутых объектов берём описывающий прямоугольник
      const r = opts.rotY ?? 0
      const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
      this.colliders.push({ x, z, hw: (w * c + d * s) / 2, hd: (w * s + d * c) / 2 })
    }
  }

  cylinder(
    rTop: number, rBottom: number, h: number,
    x: number, y: number, z: number,
    hex: number,
    opts: { collide?: boolean; layer?: Layer; segments?: number } = {},
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, opts.segments ?? 10)
    g.translate(x, y + h / 2, z)
    this.push(g, hex, opts.layer ?? 'solid')
    if (opts.collide) {
      const r = Math.max(rTop, rBottom)
      this.colliders.push({ x, z, hw: r, hd: r })
    }
  }

  sphere(r: number, x: number, y: number, z: number, hex: number, detail = 0): void {
    const g = new THREE.IcosahedronGeometry(r, detail)
    g.translate(x, y, z)
    this.push(g, hex, 'solid')
  }

  /** Только препятствие, без геометрии */
  blocker(x: number, z: number, w: number, d: number): void {
    this.colliders.push({ x, z, hw: w / 2, hd: d / 2 })
  }

  private push(g: THREE.BufferGeometry, hex: number, layer: Layer): void {
    // плоская заливка: убираем индексы, чтобы грани не сглаживались
    const geo = g.index ? g.toNonIndexed() : g
    geo.deleteAttribute('uv')
    geo.computeVertexNormals()
    this.color.setHex(hex)
    const n = geo.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.color.r
      colors[i * 3 + 1] = this.color.g
      colors[i * 3 + 2] = this.color.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.parts[layer].push(geo)
  }

  build(): THREE.Group {
    const group = new THREE.Group()
    const solid = this.merge('solid')
    if (solid) {
      const mesh = new THREE.Mesh(
        solid,
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    const glow = this.merge('glow')
    if (glow) {
      group.add(new THREE.Mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true })))
    }
    const glass = this.merge('glass')
    if (glass) {
      const mesh = new THREE.Mesh(
        glass,
        new THREE.MeshLambertMaterial({
          vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false,
        }),
      )
      mesh.renderOrder = 2
      group.add(mesh)
    }
    return group
  }

  private merge(layer: Layer): THREE.BufferGeometry | null {
    const list = this.parts[layer]
    if (!list.length) return null
    const merged = mergeGeometries(list, false)
    list.forEach((g) => g.dispose())
    return merged
  }
}
