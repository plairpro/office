import * as THREE from 'three'
import { GAME, PLAYER_COLORS, CHARACTERS, CHARACTER_ORDER, MATCH, WEAPONS, type CharacterId, type WeaponId } from './config/game'
import { buildOffice } from './scene/office'
import { Renderer, autoQuality, type Quality } from './scene/render'
import { Avatar } from './game/avatar'
import { Match, type MatchHooks } from './game/match'
import { sfx } from './game/sfx'
import { Input } from './game/input'
import { NetRoom, makeRoomCode, readRoomCode, iceServers } from './net/room'
import { $, showToast, loadName, saveName, loadPref, savePref } from './ui/dom'
import { loadAssets } from './assets'

// ---------- рендер ----------

const host = $('game')

// ---------- загрузка моделей ----------
const mainBtn = $('btn-main') as HTMLButtonElement
const mainLabel = mainBtn.textContent
mainBtn.disabled = true
mainBtn.textContent = 'Загружаем офис… 0%'
await loadAssets((p) => { mainBtn.textContent = `Загружаем офис… ${Math.round(p * 100)}%` })
mainBtn.textContent = mainLabel
mainBtn.disabled = false

// ICE-серверы считаем заранее, пока игрок в меню
const ice = iceServers()
const office = buildOffice()
const camera = new THREE.PerspectiveCamera(GAME.camera.fov, 1, 0.5, 120)
const gfx = new Renderer(host, camera, office.sunDir)
const scene = gfx.scene
const renderer = gfx.renderer
scene.add(office.group)

const camOffset = new THREE.Vector3(GAME.camera.offset.x, GAME.camera.offset.y, GAME.camera.offset.z)
const camTarget = new THREE.Vector3()
let camZoom = 0.42
// ?zoom=0.5 — камера ближе (для скриншотов и маленьких экранов)
const ZOOM = Number(new URLSearchParams(location.search).get('zoom')) || 1

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

// звук включается после первого касания/клавиши — так требуют браузеры
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => sfx.unlock(), { capture: true })
const muteBtn = $('btn-mute') as HTMLButtonElement
const setMute = (m: boolean) => { sfx.setMuted(m); muteBtn.textContent = m ? '🔇' : '🔊'; savePref('mute', m ? '1' : '0') }
setMute(loadPref('mute') === '1')
muteBtn.addEventListener('click', () => { setMute(!sfx.muted); muteBtn.blur() })

const goreSelect = $('gore') as HTMLSelectElement
goreSelect.value = loadPref('gore') === 'off' ? 'off' : 'on'
goreSelect.addEventListener('change', () => {
  gore = goreSelect.value === 'on'
  if (match) match.fx.gore = gore
  savePref('gore', goreSelect.value)
  goreSelect.blur()
})

const qSelect = $('quality') as HTMLSelectElement
qSelect.value = gfx.getQuality()
qSelect.addEventListener('change', () => {
  gfx.setQuality(qSelect.value as Quality)
  savePref('quality', qSelect.value)
  qSelect.blur()
})

// ---------- бой ----------

const input = new Input(renderer.domElement)

let match: Match | null = null
let net: NetRoom | null = null
let gore = loadPref('gore') !== 'off'
const WEAPON_ICON: Record<WeaponId, string> = { cutter: '🔪', stapler: '📎', mop: '🧹', lamp: '💡', moneygun: '💸' }
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// тряска камеры и красная виньетка
let shake = 0
let vignette = 0
let healFlash = 0
let deathBy = ''

const hooks: MatchHooks = {
  onKill(killer, victim, w) {
    const li = document.createElement('li')
    const name = (f: { name: string; color: number }) => {
      const b = document.createElement('b')
      b.textContent = f.name
      b.style.color = hex(f.color)
      return b
    }
    if (killer) li.append(name(killer), ` ${WEAPON_ICON[w]} `, name(victim))
    else li.append(name(victim), ' истёк кровью')
    const feed = $('feed')
    feed.prepend(li)
    while (feed.children.length > 5) feed.lastChild!.remove()
    setTimeout(() => li.remove(), 6000)
    renderScore()
  },
  onLocalHurt(n) { vignette = Math.min(1, vignette + 0.35 + n / 60) },
  onLocalDeath(killer) {
    deathBy = killer ? `Тебя уволил(а) ${killer.name}` : 'Истёк(ла) кровью'
    $('death').hidden = false
  },
  onLocalRespawn() { $('death').hidden = true },
  onShake(p) { shake = Math.max(shake, p) },
  onWin(w) {
    $('win-name').textContent = w.name
    $('win-name').style.color = hex(w.color)
    $('win-sub').textContent = w === match?.local ? 'Это ты! Премия и грамота на стене.' : `${CHARACTERS[w.character].name} получает премию`
    $('win').hidden = false
  },
  onRoundReset() { $('win').hidden = true; renderScore() },
  onPickup(kind) {
    renderHud(true)
    if (kind === 'coffee') healFlash = 1
  },
}

function rosterChanged(): void {
  if (!net || !match) return
  if (net.peers.size > 0) match.removeDummies()
  net.ordered().forEach((p, rank) => {
    const color = PLAYER_COLORS[rank % PLAYER_COLORS.length]
    if (match!.fighters.has(p.id)) match!.restyle(p.id, p.name, color)
    else match!.addRemote(p.id, p.name, p.character, color, rank)
  })
  renderScore()
}

/** Таблица: кто сколько убил (до MATCH.killsToWin) */
function renderScore(): void {
  const ul = $('roster')
  ul.textContent = ''
  if (!match) return
  const list = [...match.fighters.values()].filter((f) => f.kind !== 'dummy').sort((a, b) => b.kills - a.kills)
  for (const f of list) {
    const li = document.createElement('li')
    const dot = document.createElement('i')
    dot.style.background = hex(f.color)
    const k = document.createElement('em')
    k.textContent = String(f.kills)
    li.append(dot, document.createTextNode(`${f.name} · ${CHARACTERS[f.character].name}`), k)
    if (f.kind === 'local') li.className = 'me'
    ul.appendChild(li)
  }
  const free = GAME.maxPlayers - list.length
  let netLine = ''
  if (net) {
    const r = net.relaysOnline()
    // пока никого нет — показываем, на связи ли серверы поиска: так понятно, где ломается
    netLine = list.length > 1 ? '' : r.open === 0 ? ' · ⚠ нет связи с серверами поиска' : ` · поиск: ${r.open}/${r.total} серверов`
  }
  $('net-status').textContent = !net
    ? 'Тренировка: манекены у кулера'
    : `До победы ${MATCH.killsToWin} · ` + (free > 0 ? `свободно мест: ${free}` : 'комната заполнена') + netLine
}

let hudKey = ''
function renderHud(force = false): void {
  const f = match?.local
  if (!f) return
  const w = WEAPONS[f.weapon]
  const fx: string[] = []
  if (f.bleed > 0) fx.push('🩸 кровотечение')
  if (f.slow > 0) fx.push('🐌 мокрый пол')
  if (f.stun > 0) fx.push('💫 оглушение')
  if (f.disarm > 0) fx.push('💸 руки заняты')
  if (f.invuln > 0) fx.push('🛡 только из лифта')
  if (f.buzz > 0) fx.push('☕ бодрость')
  const hp = Math.max(0, Math.round(f.hp))
  const key = `${hp}|${f.weapon}|${f.ammo}|${fx.join()}|${f.dead ? Math.ceil(f.respawnIn) : ''}`
  if (key === hudKey && !force) return
  hudKey = key
  ;($('hp-fill') as HTMLElement).style.width = `${(hp / f.maxHp) * 100}%`
  $('hp-text').textContent = `${hp} / ${f.maxHp}`
  $('weapon-name').textContent = `${WEAPON_ICON[f.weapon]} ${w.name}`
  $('ammo').textContent = f.ammo >= 0 ? `× ${f.ammo}` : ''
  $('effects').textContent = fx.join(' · ')
  if (f.dead) $('death-sub').textContent = `${deathBy}. Лифт через ${Math.max(1, Math.ceil(f.respawnIn))}…`
}

// ---------- меню ----------

const PREVIEW = { x: 1.2, z: 1.0 }
// в меню все четверо стоят в ряд лицом к камере, выбранный выходит вперёд
const lineup = new Map<CharacterId, Avatar>()
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }
const FACE_CAMERA = Math.PI / 4
// персонажи меню рисуются отдельным слоем поверх офиса — их не заслоняет мебель
const menuScene = new THREE.Scene()
menuScene.add(new THREE.HemisphereLight(0xffe9e4, 0x9fcfd0, 2.0))
const menuSun = new THREE.DirectionalLight(0xfff0e2, 2.2)
menuSun.position.set(4, 8, 6)
menuScene.add(menuSun)
let myChar: CharacterId = (CHARACTER_ORDER as string[]).includes(loadPref('character') ?? '')
  ? (loadPref('character') as CharacterId)
  : 'courier'

function setPreview(id: CharacterId | null): void {
  if (!id) {
    for (const a of lineup.values()) { menuScene.remove(a.root); a.dispose() }
    lineup.clear()
    return
  }
  CHARACTER_ORDER.forEach((c, i) => {
    let a = lineup.get(c)
    if (!a) {
      a = new Avatar(CHARACTERS[c].name, PLAYER_COLORS[i], c)
      a.showLabel(false)
      menuScene.add(a.root)
      lineup.set(c, a)
    }
    const k = (i - 1.5) * 1.3
    const sel = c === id
    const fwd = sel ? 0.7 : 0
    a.root.position.set(PREVIEW.x + SCREEN_RIGHT.x * k + fwd * Math.SQRT1_2, 0, PREVIEW.z + SCREEN_RIGHT.z * k + fwd * Math.SQRT1_2)
    a.root.scale.setScalar(sel ? 1.12 : 0.92)
    if (sel) a.action('Cheer', 1.2)
  })
}

/** Портреты персонажей для карточек меню — рисуем 3D-модели в маленький холст */
function makePortraits(): Record<CharacterId, string> {
  const out = {} as Record<CharacterId, string>
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  r.setSize(128, 128)
  r.outputColorSpace = THREE.SRGBColorSpace
  r.toneMapping = THREE.NeutralToneMapping
  const sc = new THREE.Scene()
  sc.add(new THREE.HemisphereLight(0xffe9e4, 0x9fcfd0, 2.2))
  const d = new THREE.DirectionalLight(0xfff0e2, 2.2)
  d.position.set(1, 2, 2)
  sc.add(d)
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20)
  cam.position.set(0.55, 1.5, 2.3)
  cam.lookAt(0, 1.3, 0)
  CHARACTER_ORDER.forEach((c, i) => {
    const a = new Avatar('', PLAYER_COLORS[i], c)
    a.animate(0.4, 0, 0.25)
    sc.add(a.root)
    r.render(sc, cam)
    out[c] = r.domElement.toDataURL('image/png')
    sc.remove(a.root)
    a.dispose()
  })
  r.dispose()
  r.forceContextLoss()
  return out
}
const PORTRAITS = makePortraits()

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
    const stat = (icon: string, v: string, good: boolean, title: string) =>
      v ? `<span class="${good ? 'up' : 'down'}" title="${title}">${icon} ${v}</span>` : ''
    const parts = [
      `<span class="${c.hp >= 100 ? 'up' : 'down'}" title="Здоровье">❤️ ${c.hp}</span>`,
      stat('🏃', pct(c.moveMul), c.moveMul > 1, 'Скорость бега'),
      stat('⚔️', pct(c.attackSpeedMul), c.attackSpeedMul > 1, 'Скорость атаки'),
      c.dodge ? `<span class="up" title="Шанс уклониться">🌀 ${Math.round(c.dodge * 100)}%</span>` : '',
      c.knockbackResist ? `<span class="up" title="Не сдвинуть">🪨 ${Math.round(c.knockbackResist * 100)}%</span>` : '',
    ].filter(Boolean)
    btn.innerHTML = `<img src="${PORTRAITS[id]}" alt=""><span class="info"><b>${c.name}</b><span class="stats">${parts.join('')}</span></span>`
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
  $('btn-main').textContent = 'Войти в офис'
}

async function startGame(code: string | null): Promise<void> {
  myName = nameInput.value.trim().slice(0, 16) || 'Стажёр'
  saveName(myName)
  setPreview(null)
  camera.clearViewOffset()
  camTarget.y = 0
  $('menu').hidden = true
  $('hud').hidden = false
  $('btn-attack').hidden = !window.matchMedia('(pointer: coarse)').matches

  if (!code) {
    $('room-code').textContent = 'соло'
    $('btn-invite').hidden = true
    match = new Match(scene, office, hooks, null)
    match.fx.gore = gore
    match.addLocal('me', myName, myChar, PLAYER_COLORS[0], 0)
    match.addDummies()
    camTarget.set(match.local!.body.x, 0, match.local!.body.z)
    renderScore()
    renderHud(true)
    return
  }

  history.replaceState(null, '', `#${code}`)
  $('room-code').textContent = code
  $('btn-invite').hidden = false
  net = new NetRoom(code, myName, myChar, {
    onJoinError: () => showToast('Коллега нашёлся, но сеть не пускает соединение. Пробуем через ретранслятор…', 5000),
    onPeerHello: () => rosterChanged(),
    onPeerLeave: (id) => { match?.remove(id); rosterChanged() },
    onPeerState: (id, s) => match?.onState(id, s),
    onAtk: (id, m) => match?.onAtk(id, m),
    onHurt: (id, m) => match?.onHurt(id, m),
    onDie: (id, m) => match?.onDie(id, m),
    onPick: (id, m) => match?.onPick(id, m),
    onRoomFull: () => backToMenu('В этой комнате уже 4 человека. Создай свою и позови коллег!'),
  }, await ice)
  match = new Match(scene, office, hooks, net)
  match.fx.gore = gore
  // точка появления — по порядку входа; пока никого не видно, считаем себя первым
  match.addLocal(net.selfId, myName, myChar, PLAYER_COLORS[0], 0)
  match.addDummies() // пока коллеги не пришли — манекены у кулера
  camTarget.set(match.local!.body.x, 0, match.local!.body.z)
  setTimeout(() => {
    if (!net || !match?.local) return
    const slot = net.rankOf(net.selfId)
    const sp0 = office.spawns[0]
    // переставляем, только если ещё стоим у стартового лифта
    if (slot > 0 && Math.hypot(match.local.body.x - sp0.x, match.local.body.z - sp0.z) < 2) match.moveLocalToSpawn(slot)
    rosterChanged()
  }, 1500)
  renderScore()
  renderHud(true)
}

function backToMenu(error?: string): void {
  net?.leave()
  net = null
  match?.dispose()
  match = null
  $('death').hidden = $('win').hidden = true
  $('feed').textContent = ''
  history.replaceState(null, '', location.pathname)
  $('hud').hidden = true
  $('menu').hidden = false
  $('btn-main').textContent = 'Войти в офис'
  $('menu-tagline').textContent = 'Быстрый PvP на 2–4 коллег. Без регистрации.'
  setPreview(myChar)
  const err = $('menu-error')
  err.hidden = !error
  err.textContent = error ?? ''
}

$('btn-main').addEventListener('click', () => void startGame(readRoomCode() ?? makeRoomCode()))
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
let scoreAcc = 0

function frame(time: number): void {
  timer.update(time)
  const dt = Math.min(timer.getDelta(), 0.05)
  const me = match?.local

  if (match && me) {
    // прицел мышью; на телефоне — автоприцел по ближайшему
    let aim: number | null = null
    const mouseAim = input.hasMouse && !input.touchMode
    if (mouseAim) {
      ray.setFromCamera(input.mouseNdc, camera)
      if (ray.ray.intersectPlane(aimPlane, aimPoint)) aim = Math.atan2(aimPoint.x - me.body.x, aimPoint.z - me.body.z)
    }
    match.update(dt, { move: input.moveDir(), aim, attack: input.attacking, autoAim: input.touchMode })

    // камера: следует за игроком с небольшим сдвигом к прицелу
    const lead = aim !== null ? GAME.camera.aimLead : 0
    const tx = me.body.x + (aim !== null ? (aimPoint.x - me.body.x) * lead : me.body.vx * 0.12)
    const tz = me.body.z + (aim !== null ? (aimPoint.z - me.body.z) * lead : me.body.vz * 0.12)
    const k = 1 - Math.exp(-GAME.camera.follow * dt)
    camTarget.x += (tx - camTarget.x) * k
    camTarget.z += (tz - camTarget.z) * k

    sendAcc += dt
    if (net && sendAcc >= 1 / GAME.net.sendRateHz) {
      sendAcc = 0
      const s = match.stateOf()
      if (s) net.broadcastState(s)
    }
    renderHud()
    scoreAcc += dt
    if (scoreAcc > 0.5) { scoreAcc = 0; renderScore() }
  } else {
    // в меню камера смотрит на выбранного персонажа
    camTarget.set(PREVIEW.x + 0.35, 0.95, PREVIEW.z + 0.35)
    for (const a of lineup.values()) a.animate(dt, 0, FACE_CAMERA)
    // на широком экране ставим персонажей в центр свободной от меню части
    const w = window.innerWidth, h = window.innerHeight
    const card = document.querySelector('#menu .card')
    const right = w >= 900 && card ? card.getBoundingClientRect().right : 0
    const shift = right ? (right + w) / 2 - w / 2 : 0
    camera.setViewOffset(w, h, -shift, 0, w, h)
  }

  if (me) sfx.setListener(me.body.x, me.body.z)
  sfx.updateMusic(dt, true)

  // виньетка: вспышка при попадании + постоянная при малом здоровье
  vignette = Math.max(0, vignette - dt * 1.6)
  const low = me && !me.dead ? Math.max(0, 0.45 - me.hp / me.maxHp) * 1.2 : 0
  ;($('vignette') as HTMLElement).style.opacity = String(Math.min(1, vignette + low))
  healFlash = Math.max(0, healFlash - dt * 1.8)
  ;($('heal-flash') as HTMLElement).style.opacity = String(healFlash)

  // в меню камера ближе — крупный план персонажа
  camZoom += ((match ? ZOOM : 0.4) - camZoom) * (1 - Math.exp(-4 * dt))
  const far = new URLSearchParams(location.search).has('overview')
  if (far) camTarget.set(0, 0, 0)
  camera.position.copy(camTarget).addScaledVector(camOffset, far ? 2.6 : camZoom)
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.2)
    const a = shake * shake * 0.9
    camera.position.x += (Math.random() - 0.5) * a
    camera.position.y += (Math.random() - 0.5) * a
    camera.position.z += (Math.random() - 0.5) * a
  }
  camera.lookAt(camTarget)
  gfx.render()
  if (lineup.size) {
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(menuScene, camera)
    renderer.autoClear = true
  }

  fpsAcc += dt; fpsFrames++
  if (fpsAcc > 0.5) {
    $('fps').textContent = `${Math.round(fpsFrames / fpsAcc)} fps`
    fpsAcc = 0; fpsFrames = 0
  }
  requestAnimationFrame(frame)
}


window.addEventListener('beforeunload', () => net?.leave())
requestAnimationFrame(frame)
;(window as unknown as { __match: () => Match | null }).__match = () => match
