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

/** Плитка: плоский цвет и мягкие швы. Текстура = 2×2 плитки */
export function tileTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S, S)
  g.fillStyle = 'rgba(250,247,251,1)'
  g.fillRect(0, 0, S / 2, S / 2)
  g.fillRect(S / 2, S / 2, S / 2, S / 2)
  g.strokeStyle = 'rgba(232,226,240,1)'
  g.lineWidth = 3
  g.strokeRect(0, 0, S, S)
  g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke()
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

/** Дерево: плоский светлый цвет с редкими мягкими полосами */
export function woodTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S)
  g.fillStyle = '#ecd2b0'
  g.fillRect(0, 0, S, S)
  g.fillStyle = 'rgba(214,180,140,0.55)'
  for (const y of [30, 34, 96, 150, 154, 210]) g.fillRect(0, y, S, 3)
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
