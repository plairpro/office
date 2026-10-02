import * as THREE from 'three'
import { RED } from '../scene/palette'
import type { AABB } from '../scene/builder'

/**
 * Эффекты боя. Кровь — единственный насыщенный цвет в пастельном мире.
 * Режим «для офиса» (gore = false) заменяет кровь конфетти.
 *
 * Всё на InstancedMesh: тысячи капель и пятен — пара вызовов отрисовки.
 */

const MAX_DROPS = 900
const MAX_DECALS = 700
const GRAVITY = 18

const BLOOD = [new THREE.Color(RED), new THREE.Color(0xb10c22), new THREE.Color(0xe0213a)]
const CONFETTI = [0xe9806e, 0x4fb3a9, 0xf0b84a, 0x9483d1, 0xa9dfcf, 0xf2b9b3].map((c) => new THREE.Color(c))

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; c: THREE.Color; alive: boolean; decal: number }
interface Gib { mesh: THREE.Object3D; vx: number; vy: number; vz: number; spin: THREE.Vector3; trail: number; life: number; bounces: number }
interface Fountain { at: () => THREE.Vector3 | null; t: number; acc: number }
interface Floater { sprite: THREE.Sprite; t: number; vy: number }

export class Fx {
  gore = true
  private drops: Drop[] = []
  private dropMesh: THREE.InstancedMesh
  private decalMesh: THREE.InstancedMesh
  private decalNext = 0
  private gibs: Gib[] = []
  private fountains: Fountain[] = []
  private floaters: Floater[] = []
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private sc = new THREE.Vector3()
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(private scene: THREE.Scene, private colliders: AABB[]) {
    this.dropMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.05, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_DROPS,
    )
    this.dropMesh.frustumCulled = false
    this.dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < MAX_DROPS; i++) {
      this.dropMesh.setMatrixAt(i, this.hidden)
      this.dropMesh.setColorAt(i, BLOOD[0])
      this.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, c: BLOOD[0], alive: false, decal: 0 })
    }
    scene.add(this.dropMesh)

    const decalGeo = new THREE.PlaneGeometry(1, 1)
    decalGeo.rotateX(-Math.PI / 2)
    this.decalMesh = new THREE.InstancedMesh(
      decalGeo,
      new THREE.MeshBasicMaterial({
        map: splatTexture(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
      MAX_DECALS,
    )
    this.decalMesh.frustumCulled = false
    this.decalMesh.renderOrder = 1
    for (let i = 0; i < MAX_DECALS; i++) {
      this.decalMesh.setMatrixAt(i, this.hidden)
      this.decalMesh.setColorAt(i, BLOOD[0])
    }
    scene.add(this.decalMesh)
  }

  private palette(): THREE.Color[] { return this.gore ? BLOOD : CONFETTI }

  /** Брызги при попадании: dir — направление удара (капли летят по нему) */
  hit(x: number, y: number, z: number, dirX: number, dirZ: number, amount = 1): void {
    const n = Math.round(14 * amount)
    for (let i = 0; i < n; i++) {
      const sp = 2.5 + Math.random() * 4
      this.spawnDrop(x, y, z,
        dirX * sp + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3.5, dirZ * sp + (Math.random() - 0.5) * 3,
        0.6 + Math.random() * 0.9, 0.12 + Math.random() * 0.22)
    }
    this.decal(x + dirX * 0.4, z + dirZ * 0.4, 0.35 + Math.random() * 0.4 * amount)
  }

  /** Взрыв при смерти */
  burst(x: number, y: number, z: number, amount = 1): void {
    const n = Math.round(90 * amount)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 6
      this.spawnDrop(x, y, z, Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp,
        0.6 + Math.random() * 1.4, 0.15 + Math.random() * 0.4)
    }
    this.decal(x, z, 1.6 + Math.random() * 0.6)
    this.decal(x + (Math.random() - 0.5), z + (Math.random() - 0.5), 1 + Math.random() * 0.5)
  }

  /** Капля под ногами (кровотечение) */
  drip(x: number, z: number): void {
    this.spawnDrop(x + (Math.random() - 0.5) * 0.3, 0.9, z + (Math.random() - 0.5) * 0.3, 0, 0, 0, 0.5, 0.08 + Math.random() * 0.1)
  }

  /** Фонтан из шеи: at() возвращает текущую точку (или null — закончить) */
  fountain(at: () => THREE.Vector3 | null, seconds = 1.6): void {
    this.fountains.push({ at, t: seconds, acc: 0 })
  }

  /** Отлетающая часть тела (голова). Оставляет кровавый след, пока катится */
  gib(obj: THREE.Object3D, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    obj.position.set(x, y, z)
    this.scene.add(obj)
    this.gibs.push({
      mesh: obj, vx, vy, vz, trail: 0, life: 14, bounces: 0,
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
    })
  }

  /** Всплывающая надпись над головой: «Уклон!», «+30» */
  floatText(text: string, x: number, y: number, z: number, color = '#4d4a7d'): void {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 64
    const g = c.getContext('2d')!
    g.font = 'bold 40px system-ui, sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.lineWidth = 8; g.strokeStyle = 'rgba(255,250,246,0.95)'
    g.strokeText(text, 128, 34)
    g.fillStyle = color
    g.fillText(text, 128, 34)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
    s.scale.set(1.8, 0.45, 1)
    s.position.set(x, y, z)
    s.renderOrder = 20
    this.scene.add(s)
    this.floaters.push({ sprite: s, t: 1.1, vy: 1.2 })
  }

  /** Пятно на полу. Пятна копятся весь матч — офис превращается в место преступления */
  decal(x: number, z: number, size: number): void {
    const pal = this.palette()
    const i = this.decalNext
    this.decalNext = (this.decalNext + 1) % MAX_DECALS
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), Math.random() * Math.PI * 2)
    const s = this.gore ? size : size * 0.6
    this.m4.compose(this.v.set(x, 0.012 + (i % 50) * 0.0002, z), this.q, this.sc.set(s, 1, s * (0.7 + Math.random() * 0.5)))
    this.decalMesh.setMatrixAt(i, this.m4)
    this.decalMesh.setColorAt(i, pal[(Math.random() * pal.length) | 0])
    this.decalMesh.instanceMatrix.needsUpdate = true
    this.decalMesh.instanceColor!.needsUpdate = true
  }

  dispose(): void {
    for (const g of this.gibs) this.scene.remove(g.mesh)
    for (const f of this.floaters) { this.scene.remove(f.sprite); f.sprite.material.map?.dispose(); f.sprite.material.dispose() }
    this.gibs = []; this.floaters = []; this.fountains = []
    for (const m of [this.dropMesh, this.decalMesh]) {
      this.scene.remove(m)
      m.geometry.dispose()
      const mat = m.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.dispose()
    }
  }

  clearDecals(): void {
    for (let i = 0; i < MAX_DECALS; i++) this.decalMesh.setMatrixAt(i, this.hidden)
    this.decalMesh.instanceMatrix.needsUpdate = true
  }

  private spawnDrop(x: number, y: number, z: number, vx: number, vy: number, vz: number, s: number, decal: number): void {
    const d = this.drops.find((p) => !p.alive) ?? this.drops[(Math.random() * MAX_DROPS) | 0]
    const pal = this.palette()
    Object.assign(d, { x, y, z, vx, vy, vz, s: this.gore ? s : s * 1.3, alive: true, decal, c: pal[(Math.random() * pal.length) | 0] })
  }

  private solid(x: number, z: number, y: number): boolean {
    for (const c of this.colliders) {
      if (c.top > y && Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return true
    }
    return false
  }

  update(dt: number): void {
    // фонтаны
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i]
      f.t -= dt
      const p = f.at()
      if (f.t <= 0 || !p) { this.fountains.splice(i, 1); continue }
      f.acc += dt * 60 * Math.min(1, f.t)
      while (f.acc > 1) {
        f.acc -= 1
        this.spawnDrop(p.x, p.y, p.z, (Math.random() - 0.5) * 2.2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2.2,
          0.6 + Math.random() * 0.6, 0.1 + Math.random() * 0.15)
      }
    }
    // капли
    let any = false
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i]
      if (!d.alive) continue
      any = true
      d.vy -= GRAVITY * dt
      const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt
      // об стену — стекает
      if (this.solid(nx, nz, d.y)) { d.vx *= -0.1; d.vz *= -0.1 } else { d.x = nx; d.z = nz }
      d.y += d.vy * dt
      if (d.y <= 0.02) {
        d.alive = false
        if (d.decal > 0) this.decal(d.x, d.z, d.decal)
        this.dropMesh.setMatrixAt(i, this.hidden)
        continue
      }
      this.m4.makeScale(d.s, d.s * (1 + Math.min(Math.abs(d.vy) * 0.08, 1)), d.s).setPosition(d.x, d.y, d.z)
      this.dropMesh.setMatrixAt(i, this.m4)
      this.dropMesh.setColorAt(i, d.c)
    }
    if (any) {
      this.dropMesh.instanceMatrix.needsUpdate = true
      this.dropMesh.instanceColor!.needsUpdate = true
    }
    // части тел
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i]
      g.life -= dt
      if (g.life <= 0) { this.scene.remove(g.mesh); this.gibs.splice(i, 1); continue }
      g.vy -= GRAVITY * dt
      const p = g.mesh.position
      const nx = p.x + g.vx * dt, nz = p.z + g.vz * dt
      if (this.solid(nx, p.z, p.y)) g.vx *= -0.5; else p.x = nx
      if (this.solid(p.x, nz, p.y)) g.vz *= -0.5; else p.z = nz
      p.y += g.vy * dt
      if (p.y < 0.13) {
        p.y = 0.13
        if (g.vy < -1.5) { g.bounces++; this.decal(p.x, p.z, 0.35) }
        g.vy = -g.vy * 0.35
        g.vx *= 0.8; g.vz *= 0.8
        g.spin.multiplyScalar(0.8)
      }
      g.mesh.rotation.x += g.spin.x * dt
      g.mesh.rotation.y += g.spin.y * dt
      g.mesh.rotation.z += g.spin.z * dt
      // кровавый след, пока катится
      const sp = Math.hypot(g.vx, g.vz)
      g.trail += sp * dt
      if (g.trail > 0.35 && p.y < 0.4 && g.bounces > 0) { g.trail = 0; this.decal(p.x, p.z, 0.22) }
    }
    // надписи
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.t -= dt
      f.sprite.position.y += f.vy * dt
      f.sprite.material.opacity = Math.min(1, f.t * 2)
      if (f.t <= 0) {
        this.scene.remove(f.sprite)
        f.sprite.material.map?.dispose()
        f.sprite.material.dispose()
        this.floaters.splice(i, 1)
      }
    }
  }
}

/** Клякса: неровное пятно с брызгами вокруг, белое — цвет задаёт инстанс */
function splatTexture(): THREE.Texture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.beginPath()
  const n = 14
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = S * (0.26 + Math.random() * 0.12)
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r
    if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(S / 2 + Math.cos(a - 0.2) * r * 1.15, S / 2 + Math.sin(a - 0.2) * r * 1.15, x, y)
  }
  g.fill()
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = S * (0.36 + Math.random() * 0.12)
    g.beginPath()
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 2 + Math.random() * 5, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
