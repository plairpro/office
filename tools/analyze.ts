// Анализ уровня: насколько простреливается каждая точка, видят ли друг друга респы,
// сколько бежать от каждого респа до кулера. Запуск: npm run dev → /tools/analyze.html
import { loadAssets } from '../src/assets'
import { buildOffice } from '../src/scene/office'
import { blocksShots, type AABB } from '../src/scene/builder'
import { GAME } from '../src/config/game'

const RANGE = 10 // дальность степлера, м
const R = GAME.player.radius

await loadAssets(() => {})
const o = buildOffice()
const { minX, maxX, minZ, maxZ } = o.bounds
const shot = o.colliders.filter(blocksShots)

function walkable(x: number, z: number): boolean {
  if (x < minX + R || x > maxX - R || z < minZ + R || z > maxZ - R) return false
  for (const c of o.colliders) {
    if (Math.abs(x - c.x) < c.hw + R * 0.8 && Math.abs(z - c.z) < c.hd + R * 0.8) return false
  }
  return true
}

/** отрезок пересекает прямоугольник? (метод плит) */
function hits(ax: number, az: number, bx: number, bz: number, c: AABB): boolean {
  const dx = bx - ax, dz = bz - az
  let t0 = 0, t1 = 1
  for (const [p, d, lo, hi] of [[ax, dx, c.x - c.hw, c.x + c.hw], [az, dz, c.z - c.hd, c.z + c.hd]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue }
    let ta = (lo - p) / d, tb = (hi - p) / d
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb)
    if (t0 > t1) return false
  }
  return true
}
const los = (ax: number, az: number, bx: number, bz: number) => !shot.some((c) => hits(ax, az, bx, bz, c))

// ---------- сетка простреливаемости (шаг 1 м) ----------
const STEP = 1
const pts: { x: number; z: number }[] = []
for (let x = minX + 0.5; x < maxX; x += STEP) for (let z = minZ + 0.5; z < maxZ; z += STEP) if (walkable(x, z)) pts.push({ x, z })
const exposure = pts.map((a) => {
  let n = 0
  for (const b of pts) {
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    if (d > 0 && d <= RANGE && los(a.x, a.z, b.x, b.z)) n++
  }
  return n
})
// нормируем на максимум возможного (круг радиусом RANGE), чтобы карты можно было сравнивать
const maxExp = Math.PI * RANGE * RANGE / (STEP * STEP)
// самые длинные линии прострела
let longLines = 0
for (let i = 0; i < pts.length; i += 3) for (let j = i + 3; j < pts.length; j += 3) {
  const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)
  if (d > 18 && los(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) longLines++
}

// ---------- путь по сетке 0.5 м (BFS, 8 направлений) ----------
const G = 0.5
const nx = Math.round((maxX - minX) / G), nz = Math.round((maxZ - minZ) / G)
const free = new Uint8Array(nx * nz)
for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) free[j * nx + i] = walkable(minX + (i + 0.5) * G, minZ + (j + 0.5) * G) ? 1 : 0
function pathFrom(x: number, z: number): Float32Array {
  const dist = new Float32Array(nx * nz).fill(Infinity)
  let si = Math.floor((x - minX) / G), sj = Math.floor((z - minZ) / G)
  // ближайшая свободная клетка
  outer: for (let r = 0; r < 6; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    const i = si + di, j = sj + dj
    if (i >= 0 && j >= 0 && i < nx && j < nz && free[j * nx + i]) { si = i; sj = j; break outer }
  }
  // Дейкстра на ведре — сетка маленькая, хватит простой очереди с релаксацией
  const q: number[] = [sj * nx + si]
  dist[q[0]] = 0
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]
  while (q.length) {
    const k = q.shift()!
    const i = k % nx, j = (k / nx) | 0
    for (const [di, dj, w] of nb) {
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue
      const kk = b * nx + a
      if (!free[kk]) continue
      if (di && dj && (!free[j * nx + a] || !free[b * nx + i])) continue // не срезаем углы
      const nd = dist[k] + w * G
      if (nd < dist[kk] - 1e-6) { dist[kk] = nd; q.push(kk) }
    }
  }
  return dist
}
const at = (d: Float32Array, x: number, z: number) => {
  const i = Math.floor((x - minX) / G), j = Math.floor((z - minZ) / G)
  let best = Infinity
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
    const v = d[(j + dj) * nx + (i + di)]
    if (v !== undefined && v < best) best = v
  }
  return best
}

const spawnInfo = o.spawns.map((s, i) => {
  const d = pathFrom(s.x, s.z)
  const expIdx = pts.reduce((bi, p, k) => (Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(pts[bi].x - s.x, pts[bi].z - s.z) ? k : bi), 0)
  return {
    spawn: i + 1,
    toCooler: +at(d, o.cooler.x, o.cooler.z).toFixed(1),
    toSpawns: o.spawns.map((t) => +at(d, t.x, t.z).toFixed(1)),
    seesSpawns: o.spawns.map((t, j) => j !== i && Math.hypot(t.x - s.x, t.z - s.z) <= 25 && los(s.x, s.z, t.x, t.z)),
    exposure: +(exposure[expIdx] / maxExp).toFixed(2),
  }
})

const avgExp = exposure.reduce((a, b) => a + b, 0) / exposure.length / maxExp
const coolerExp = exposure[pts.reduce((bi, p, k) => (Math.hypot(p.x - o.cooler.x, p.z - o.cooler.z) < Math.hypot(pts[bi].x - o.cooler.x, pts[bi].z - o.cooler.z) ? k : bi), 0)] / maxExp

// ---------- картинка ----------
const PX = 24
const cv = document.createElement('canvas')
cv.width = (maxX - minX) * PX
cv.height = (maxZ - minZ) * PX + 70
const g = cv.getContext('2d')!
const X = (x: number) => (x - minX) * PX, Z = (z: number) => (z - minZ) * PX
g.fillStyle = '#fbf3ea'; g.fillRect(0, 0, cv.width, cv.height)
pts.forEach((p, k) => {
  const v = exposure[k] / maxExp
  // зелёный (закрыто) → жёлтый → красный (простреливается)
  const r = Math.round(v < 0.5 ? 120 + v * 2 * 135 : 255)
  const gr = Math.round(v < 0.5 ? 200 : 200 - (v - 0.5) * 2 * 170)
  g.fillStyle = `rgba(${r},${gr},110,0.75)`
  g.fillRect(X(p.x - 0.5), Z(p.z - 0.5), PX, PX)
})
for (const c of o.colliders) {
  g.fillStyle = blocksShots(c) ? '#3d3a66' : '#b9aedb'
  g.fillRect(X(c.x - c.hw), Z(c.z - c.hd), c.hw * 2 * PX, c.hd * 2 * PX)
}
g.strokeStyle = '#2bb3a0'; g.lineWidth = 3
g.beginPath(); g.arc(X(o.cooler.x), Z(o.cooler.z), o.cooler.radius * PX, 0, Math.PI * 2); g.stroke()
o.spawns.forEach((s, i) => {
  g.fillStyle = ['#e9806e', '#4fb3a9', '#f0b84a', '#9483d1'][i]
  g.beginPath(); g.arc(X(s.x), Z(s.z), 14, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(String(i + 1), X(s.x), Z(s.z) + 1)
})
g.fillStyle = '#3d3a66'; g.font = '15px sans-serif'; g.textAlign = 'left'
const y0 = (maxZ - minZ) * PX + 22
g.fillText(`Зелёное — закрыто, красное — простреливается (дальность ${RANGE} м). Тёмное — стены/укрытия выше груди, светлое — низкие (только движение).`, 12, y0)
g.fillText(`Средняя открытость ${(avgExp * 100).toFixed(0)}% · зона кулера ${(coolerExp * 100).toFixed(0)}% · линий прострела длиннее 18 м: ${longLines}`, 12, y0 + 24)

;(window as unknown as { __result: unknown }).__result = {
  image: cv.toDataURL('image/png'),
  avgExposure: +avgExp.toFixed(2), coolerExposure: +coolerExp.toFixed(2), longLines,
  spawns: spawnInfo, walkableCells: pts.length,
}
document.body.appendChild(cv)
