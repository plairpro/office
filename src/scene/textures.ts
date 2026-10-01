import * as THREE from 'three'

// Процедурные текстуры: рисуются на canvas при загрузке, ничего не скачивается.
// Все текстуры тайлятся по мировым координатам (см. StaticBuilder), масштаб задаётся в метрах.

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!]
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

// детерминированный шум, чтобы у всех игроков одинаково
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Светлый керамогранит 60×60 с тонкими швами. Текстура = 2×2 плитки = 1.2 м */
export function tileTexture(): THREE.CanvasTexture {
  const S = 1024
  const [c, g] = canvas(S)
  const r = rng(7)
  const n = 2
  const step = S / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 240 + Math.floor(r() * 8)
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`
      g.fillRect(i * step, j * step, step, step)
      // лёгкие разводы камня
      for (let k = 0; k < 220; k++) {
        const a = r() * 0.05
        g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(160,150,170,${a * 0.6})`
        const s = 4 + r() * 40
        g.beginPath()
        g.ellipse(i * step + r() * step, j * step + r() * step, s, s * (0.3 + r()), r() * 3, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  g.strokeStyle = 'rgba(190,180,200,0.7)'
  g.lineWidth = 3
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, S); g.stroke()
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(S, i * step); g.stroke()
  }
  return finish(c)
}

/** Ковровая плитка: тёмная, с мелким ворсом. Текстура = 2 м */
export function carpetTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(11)
  g.fillStyle = '#ececec'
  g.fillRect(0, 0, S, S)
  const img = g.getImageData(0, 0, S, S)
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (r() - 0.5) * 14
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d
  }
  g.putImageData(img, 0, 0)
  // квадраты ковровой плитки 50 см с чередованием направления ворса
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i + j) % 2) { g.fillStyle = 'rgba(0,0,0,0.035)'; g.fillRect(i * 128, j * 128, 128, 128) }
    }
  }
  return finish(c)
}

/** Дерево: дубовый шпон с волокнами. Текстура = 1 м, волокна вдоль X */
export function woodTexture(base = [232, 206, 172]): THREE.CanvasTexture {
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(23 + base[0])
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`
  g.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y++) {
    const w = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 4) * 0.5 + 0.5
    const a = 0.05 + w * 0.12 + r() * 0.03
    g.fillStyle = `rgba(150,100,60,${a * 0.6})`
    g.fillRect(0, y, S, 1)
  }
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(140,90,50,${r() * 0.08})`
    g.fillRect(r() * S, r() * S, 10 + r() * 80, 1)
  }
  // стыки досок
  g.fillStyle = 'rgba(120,80,50,0.18)'
  for (let i = 0; i < 4; i++) g.fillRect(0, i * 128, S, 2)
  return finish(c)
}

/** Белый мрамор для столешниц */
export function marbleTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(31)
  g.fillStyle = '#f1efea'
  g.fillRect(0, 0, S, S)
  for (let k = 0; k < 18; k++) {
    g.strokeStyle = `rgba(140,135,130,${0.08 + r() * 0.18})`
    g.lineWidth = 0.6 + r() * 1.8
    g.beginPath()
    let x = r() * S, y = r() * S
    g.moveTo(x, y)
    for (let s = 0; s < 14; s++) {
      x += (r() - 0.3) * 60; y += (r() - 0.5) * 40
      g.lineTo(x, y)
    }
    g.stroke()
  }
  return finish(c)
}

/** Штукатурка стен: едва заметная неровность */
export function plasterTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S)
  const r = rng(41)
  g.fillStyle = '#e9e7e2'
  g.fillRect(0, 0, S, S)
  const img = g.getImageData(0, 0, S, S)
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (r() - 0.5) * 8
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d
  }
  g.putImageData(img, 0, 0)
  return finish(c)
}

/** Ткань (диваны, кресла): плетение */
export function fabricTexture(): THREE.CanvasTexture {
  const S = 128
  const [c, g] = canvas(S)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < S; i += 4) {
    g.fillStyle = 'rgba(0,0,0,0.07)'
    g.fillRect(i, 0, 2, S)
    g.fillRect(0, i + 2, S, 1)
  }
  return finish(c)
}

/** Экран монитора: рабочий стол с окнами */
export function screenTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S)
  const grad = g.createLinearGradient(0, 0, S, S)
  grad.addColorStop(0, '#9fb8ff')
  grad.addColorStop(1, '#ffc6e0')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.fillRect(24, 30, 150, 110)
  g.fillStyle = 'rgba(255,255,255,0.75)'
  g.fillRect(110, 120, 120, 90)
  g.fillStyle = '#3d8bfd'
  for (let i = 0; i < 6; i++) g.fillRect(36, 48 + i * 14, 60 + ((i * 37) % 70), 6)
  g.fillStyle = 'rgba(80,84,120,0.6)'
  g.fillRect(0, S - 18, S, 18)
  return finish(c)
}
