import * as THREE from 'three'
import { GAME, PLAYER_COLORS, CHARACTERS, CHARACTER_ORDER, type CharacterId } from './config/game'
import { buildOffice } from './scene/office'
import { Renderer, autoQuality, type Quality } from './scene/render'
import { Avatar, stepBody, type Body } from './game/avatar'
import { Input } from './game/input'
import { NetRoom, makeRoomCode, readRoomCode, type StatePacket } from './net/room'
import { $, showToast, loadName, saveName, loadPref, savePref } from './ui/dom'
import { loadAssets } from './assets'

// ---------- рендер ----------

const host = $('game')

// ---------- загрузка моделей ----------
const mainBtn = $('btn-main') as HTMLButtonElement
const soloBtn = $('btn-solo') as HTMLButtonElement
const mainLabel = mainBtn.textContent
mainBtn.disabled = soloBtn.disabled = true
mainBtn.textContent = 'Загружаем офис… 0%'
await loadAssets((p) => { mainBtn.textContent = `Загружаем офис… ${Math.round(p * 100)}%` })
mainBtn.textContent = mainLabel
mainBtn.disabled = soloBtn.disabled = false

const office = buildOffice()
const camera = new THREE.PerspectiveCamera(GAME.camera.fov, 1, 0.5, 120)
const gfx = new Renderer(host, camera, office.sunDir)
const scene = gfx.scene
const renderer = gfx.renderer
scene.add(office.group)

const camOffset = new THREE.Vector3(GAME.camera.offset.x, GAME.camera.offset.y, GAME.camera.offset.z)
const camTarget = new THREE.Vector3()
let camZoom = 0.42

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight
  camera.aspect = w / h
  // на узком экране (телефон вертикально) отъезжаем, чтобы видеть больше
  camera.fov = GAME.camera.fov * (w / h < 1 ? 1.45 : 1)
  camera.updateProjectionMatrix()
  gfx.resize()
}
window.addEventListener('resize', resize)

const savedQ = new URLSearchParams(location.search).get('q') ?? loadPref('quality')
gfx.setQuality(savedQ === 'low' || savedQ === 'medium' || savedQ === 'high' ? savedQ : autoQuality())
resize()

const qSelect = $('quality') as HTMLSelectElement
qSelect.value = gfx.getQuality()
qSelect.addEventListener('change', () => {
  gfx.setQuality(qSelect.value as Quality)
  savePref('quality', qSelect.value)
  qSelect.blur()
})

// ---------- игроки ----------

const input = new Input(renderer.domElement)

interface Local { avatar: Avatar; body: Body; facing: number; character: CharacterId }
interface Remote { avatar: Avatar; body: Body; target: Body; facing: number; lastAt: number }

let me: Local | null = null
const remotes = new Map<string, Remote>()
let net: NetRoom | null = null

function spawnLocal(name: string, slot: number): void {
  const sp = office.spawns[slot % office.spawns.length]
  const avatar = new Avatar(name, PLAYER_COLORS[slot], myChar, slot)
  avatar.root.position.set(sp.x, 0, sp.z)
  scene.add(avatar.root)
  me = { avatar, body: { x: sp.x, z: sp.z, vx: 0, vz: 0 }, facing: sp.rot, character: myChar }
  camTarget.set(sp.x, 0, sp.z)
}

function rosterChanged(): void {
  if (!net || !me) return
  const list = net.ordered()
  list.forEach((p, rank) => {
    const color = PLAYER_COLORS[rank % PLAYER_COLORS.length]
    if (p.id === net!.selfId) {
      me!.avatar.setColor(color)
      me!.avatar.setName(p.name, color)
    } else {
      let r = remotes.get(p.id)
      if (!r) {
        const sp = office.spawns[rank % office.spawns.length]
        const avatar = new Avatar(p.name, color, p.character, rank)
        avatar.root.position.set(sp.x, 0, sp.z)
        scene.add(avatar.root)
        const b = { x: sp.x, z: sp.z, vx: 0, vz: 0 }
        r = { avatar, body: { ...b }, target: { ...b }, facing: sp.rot, lastAt: performance.now() }
        remotes.set(p.id, r)
      } else {
        r.avatar.setColor(color)
        r.avatar.setName(p.name, color)
      }
    }
  })
  renderRoster()
}

function removeRemote(id: string): void {
  const r = remotes.get(id)
  if (!r) return
  scene.remove(r.avatar.root)
  r.avatar.dispose()
  remotes.delete(id)
}

function renderRoster(): void {
  const ul = $('roster')
  ul.textContent = ''
  const list = net ? net.ordered() : [{ id: 'me', name: myName, joinedAt: 0, character: myChar }]
  list.forEach((p, i) => {
    const li = document.createElement('li')
    const dot = document.createElement('i')
    dot.style.background = '#' + PLAYER_COLORS[i % 4].toString(16).padStart(6, '0')
    li.append(dot, document.createTextNode(`${p.name} · ${CHARACTERS[p.character].name}`))
    if (!net || p.id === net.selfId) li.className = 'me'
    ul.appendChild(li)
  })
  const free = GAME.maxPlayers - list.length
  $('net-status').textContent = !net
    ? 'Тренировка в одиночку'
    : free > 0 ? `Ждём коллег: свободно мест — ${free}` : 'Комната заполнена'
}

// ---------- меню ----------

const PREVIEW = { x: 0, z: 2.6 }
let preview: Avatar | null = null
let myChar: CharacterId = (CHARACTER_ORDER as string[]).includes(loadPref('character') ?? '')
  ? (loadPref('character') as CharacterId)
  : 'courier'

function setPreview(id: CharacterId | null): void {
  if (preview) { scene.remove(preview.root); preview.dispose(); preview = null }
  if (!id) return
  preview = new Avatar(CHARACTERS[id].name, PLAYER_COLORS[0], id)
  preview.root.position.set(PREVIEW.x, 0, PREVIEW.z)
  preview.root.rotation.y = 0.8
  scene.add(preview.root)
}

function pct(mul: number): string {
  const v = Math.round((mul - 1) * 100)
  return v === 0 ? '' : v > 0 ? `+${v}%` : `${v}%`
}

function renderCharacters(): void {
  const wrap = $('chars')
  wrap.textContent = ''
  for (const id of CHARACTER_ORDER) {
    const c = CHARACTERS[id]
    const btn = document.createElement('button')
    btn.className = 'char'
    btn.type = 'button'
    btn.setAttribute('aria-pressed', String(id === myChar))
    const stat = (label: string, v: string, good: boolean) =>
      v ? `<span class="${good ? 'up' : 'down'}">${label} ${v}</span>` : ''
    const parts = [
      `<span class="${c.hp >= 100 ? 'up' : 'down'}">❤ ${c.hp}</span>`,
      stat('бег', pct(c.moveMul), c.moveMul > 1),
      stat('атака', pct(c.attackSpeedMul), c.attackSpeedMul > 1),
      c.dodge ? `<span class="up">уклон ${Math.round(c.dodge * 100)}%</span>` : '',
    ].filter(Boolean)
    btn.innerHTML = `<b>${c.name}</b><span class="stats">${parts.join(' · ')}</span><small>${c.blurb}</small>`
    btn.addEventListener('click', () => {
      myChar = id
      savePref('character', id)
      renderCharacters()
      setPreview(id)
    })
    wrap.appendChild(btn)
  }
}
renderCharacters()
setPreview(myChar)


let myName = loadName()
const nameInput = $('name') as HTMLInputElement
nameInput.value = myName
const invitedCode = readRoomCode()
if (invitedCode) {
  $('menu-tagline').textContent = `Тебя позвали в комнату ${invitedCode}. Залетай!`
  $('btn-main').textContent = 'Войти в матч'
}

function startGame(code: string | null): void {
  myName = nameInput.value.trim().slice(0, 16) || 'Стажёр'
  saveName(myName)
  setPreview(null)
  $('menu').hidden = true
  $('hud').hidden = false

  if (!code) {
    $('room-code').textContent = 'соло'
    $('btn-invite').hidden = true
    spawnLocal(myName, 0)
    renderRoster()
    return
  }

  history.replaceState(null, '', `#${code}`)
  $('room-code').textContent = code
  $('btn-invite').hidden = false
  net = new NetRoom(code, myName, myChar, {
    onPeerHello: () => rosterChanged(),
    onPeerLeave: (id) => { removeRemote(id); rosterChanged() },
    onPeerState: (id, s) => {
      const r = remotes.get(id)
      if (!r) return
      r.target = { x: s[0], z: s[1], vx: s[3], vz: s[4] }
      r.facing = s[2]
      r.lastAt = performance.now()
    },
    onRoomFull: () => backToMenu('В этой комнате уже 4 человека. Создай свою и позови коллег!'),
  })
  // точка появления — по порядку входа; пока никого не видно, считаем себя первым
  spawnLocal(myName, 0)
  setTimeout(() => {
    if (!net || !me) return
    const slot = net.rankOf(net.selfId)
    const sp = office.spawns[slot % office.spawns.length]
    // переставляем, только если ещё стоим у стартового лифта
    const sp0 = office.spawns[0]
    if (slot > 0 && Math.hypot(me.body.x - sp0.x, me.body.z - sp0.z) < 2) {
      me.body.x = sp.x; me.body.z = sp.z
    }
    rosterChanged()
  }, 1500)
  renderRoster()
}

function backToMenu(error?: string): void {
  net?.leave()
  net = null
  for (const id of [...remotes.keys()]) removeRemote(id)
  if (me) { scene.remove(me.avatar.root); me.avatar.dispose(); me = null }
  history.replaceState(null, '', location.pathname)
  $('hud').hidden = true
  $('menu').hidden = false
  $('btn-main').textContent = 'Создать матч'
  $('menu-tagline').textContent = 'Быстрый PvP на 2–4 коллег. Без регистрации.'
  setPreview(myChar)
  const err = $('menu-error')
  err.hidden = !error
  err.textContent = error ?? ''
}

$('btn-main').addEventListener('click', () => startGame(readRoomCode() ?? makeRoomCode()))
$('btn-solo').addEventListener('click', () => startGame(null))
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-main').click() })

$('btn-invite').addEventListener('click', async () => {
  if (!net) return
  const url = `${location.href.split('#')[0]}#${net.code}`
  const text = `${myName} вызывает тебя на офисную разборку! Комната ${net.code}`
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && navigator.share) {
    try { await navigator.share({ title: 'Офисная ярость', text, url }); return } catch { /* отменили */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    showToast(location.protocol === 'file:'
      ? 'Это локальный файл: ссылка сработает только на этом компьютере. Открой её во втором окне'
      : 'Ссылка скопирована — кинь её в рабочий чат', 4500)
  } catch {
    window.prompt('Скопируй ссылку и отправь коллегам:', url)
  }
})

// ---------- цикл ----------

const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1)
const ray = new THREE.Raycaster()
const aimPoint = new THREE.Vector3()
const timer = new THREE.Timer()
timer.connect(document)
let sendAcc = 0
let fpsAcc = 0, fpsFrames = 0

function frame(time: number): void {
  timer.update(time)
  const dt = Math.min(timer.getDelta(), 0.05)

  if (me) {
    const dir = input.moveDir()
    const ch = CHARACTERS[me.character]
    stepBody(me.body, dir.x, dir.z, dt, office.colliders, ch.moveMul, ch.radius)
    const speed = Math.hypot(me.body.vx, me.body.vz)

    // взгляд: на мышь, а на телефоне — по направлению движения
    let hasAim = false
    if (input.hasMouse && !input.touchActive) {
      ray.setFromCamera(input.mouseNdc, camera)
      if (ray.ray.intersectPlane(aimPlane, aimPoint)) {
        me.facing = Math.atan2(aimPoint.x - me.body.x, aimPoint.z - me.body.z)
        hasAim = true
      }
    } else if (speed > 0.5) {
      me.facing = Math.atan2(me.body.vx, me.body.vz)
    }
    me.avatar.root.position.set(me.body.x, 0, me.body.z)
    me.avatar.animate(dt, speed, me.facing)

    // камера: следует за игроком с небольшим сдвигом к прицелу
    const lead = hasAim ? GAME.camera.aimLead : 0
    const tx = me.body.x + (hasAim ? (aimPoint.x - me.body.x) * lead : me.body.vx * 0.12)
    const tz = me.body.z + (hasAim ? (aimPoint.z - me.body.z) * lead : me.body.vz * 0.12)
    const k = 1 - Math.exp(-GAME.camera.follow * dt)
    camTarget.x += (tx - camTarget.x) * k
    camTarget.z += (tz - camTarget.z) * k

    sendAcc += dt
    if (net && sendAcc >= 1 / GAME.net.sendRateHz) {
      sendAcc = 0
      const r = (n: number) => Math.round(n * 100) / 100
      const s: StatePacket = [r(me.body.x), r(me.body.z), r(me.facing), r(me.body.vx), r(me.body.vz)]
      net.broadcastState(s)
    }
  } else {
    // в меню камера смотрит на выбранного персонажа
    camTarget.set(PREVIEW.x - 2.2, 0, PREVIEW.z + 2.2)
    if (preview) {
      preview.root.rotation.y += dt * 0.6
      preview.animate(dt, 0, 0)
    }
  }

  // чужие игроки: экстраполяция по скорости + сглаживание
  const now = performance.now()
  for (const r of remotes.values()) {
    const age = Math.min((now - r.lastAt) / 1000, 0.25)
    const px = r.target.x + r.target.vx * age
    const pz = r.target.z + r.target.vz * age
    const k = 1 - Math.exp(-14 * dt)
    r.body.x += (px - r.body.x) * k
    r.body.z += (pz - r.body.z) * k
    r.avatar.root.position.set(r.body.x, 0, r.body.z)
    const speed = age < 0.25 ? Math.hypot(r.target.vx, r.target.vz) : 0
    r.avatar.animate(dt, speed, lerpAngle(r.avatar.root.userData.f ?? r.facing, r.facing, k))
    r.avatar.root.userData.f = r.facing
  }

  // в меню камера ближе — крупный план персонажа
  camZoom += ((me ? 1 : 0.42) - camZoom) * (1 - Math.exp(-4 * dt))
  const far = new URLSearchParams(location.search).has('overview')
  if (far) camTarget.set(0, 0, 0)
  camera.position.copy(camTarget).addScaledVector(camOffset, far ? 2.6 : camZoom)
  camera.lookAt(camTarget)
  gfx.render()

  fpsAcc += dt; fpsFrames++
  if (fpsAcc > 0.5) {
    $('fps').textContent = `${Math.round(fpsFrames / fpsAcc)} fps`
    fpsAcc = 0; fpsFrames = 0
  }
  requestAnimationFrame(frame)
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

window.addEventListener('beforeunload', () => net?.leave())
requestAnimationFrame(frame)
