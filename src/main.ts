import * as THREE from 'three'
import { GAME, PLAYER_COLORS, CHARACTERS, CHARACTER_ORDER, MATCH, WEAPONS, type CharacterId, type WeaponId } from './config/game'
import { buildOffice } from './scene/office'
import { Renderer, autoQuality, type Quality } from './scene/render'
import { Avatar } from './game/avatar'
import { Match, type MatchHooks } from './game/match'
import { sfx } from './game/sfx'
import { Input } from './game/input'
import { NetRoom, makeRoomCode, readRoomCode } from './net/room'
import { $, showToast, loadName, saveName, loadPref, savePref } from './ui/dom'
import { loadAssets } from './assets'

// ---------- рендер ----------

const host = $('game')
// ?norender — без картинки (автотесты нескольких игроков на одной машине)
const NORENDER = new URLSearchParams(location.search).has('norender')

// ---------- загрузка моделей ----------
await loadAssets((p) => {
  $('lbar-fill').style.width = `${Math.round(p * 100)}%`
})

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
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true })
const muteBtn = $('btn-mute') as HTMLButtonElement
const setMute = (m: boolean) => { sfx.setMuted(m); muteBtn.textContent = m ? '🔇' : '🔊'; savePref('mute', m ? '1' : '0') }
setMute(loadPref('mute') === '1')
muteBtn.addEventListener('click', () => { setMute(!sfx.muted); muteBtn.blur() })

// настройки (fps, звук, кровь, графика) прячутся за шестерёнкой, чтобы не занимать экран
$('btn-settings').addEventListener('click', () => { document.querySelector('.fps')!.classList.toggle('open'); ($('btn-settings') as HTMLButtonElement).blur() })

$('build').textContent = `v${__BUILD__.slice(5).replace('T', ' ')}`

// возраст: младше 12 — конфетти вместо крови, старше — кровь (выбирается в меню, в игре не меняется)
const ageRadios = document.querySelectorAll<HTMLInputElement>('input[name="age"]')
const savedAge = loadPref('age')
for (const r of ageRadios) {
  r.checked = r.value === savedAge
  r.addEventListener('change', () => {
    if (!r.checked) return
    gore = r.value !== 'kid'
    if (match) match.fx.gore = gore
    savePref('age', r.value)
  })
}

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
let gore = loadPref('age') !== 'kid'
const WEAPON_ICON: Record<WeaponId, string> = { cutter: '🔪', stapler: '📎', mop: '🧹', lamp: '💡', moneygun: '💸' }
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// тряска камеры и красная виньетка
let shake = 0
let vignette = 0
let healFlash = 0
let spawnedAt = 0
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
  if (net.peers.size > 0 && match.fighters.size > net.peers.size + 1) { match.removeDummies(); $('invite-card').hidden = true }
  // цвет и лифт — по номеру лифта игрока (1-й зашедший — лифт 1, 2-й — лифт 2…)
  for (const p of net.ordered()) {
    if (p.slot < 0) continue // ещё выбирает лифт — покажем, как только выберет
    const color = PLAYER_COLORS[p.slot % PLAYER_COLORS.length]
    if (match.fighters.has(p.id)) match.restyle(p.id, p.name, color)
    else if (p.id !== net.selfId) {
      match.addRemote(p.id, p.name, p.character, color, p.slot)
      showToast(p.v && p.v !== __BUILD__
        ? `${p.name} зашёл, но версии игры разные — обновите оба страницу`
        : `${p.name} зашёл в офис`, p.v !== __BUILD__ ? 6000 : 2500)
      sfx.play('respawn')
    }
  }
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
    const face = document.createElement('img')
    face.src = PORTRAITS[f.character]
    face.alt = CHARACTERS[f.character].name
    face.title = CHARACTERS[f.character].name
    face.style.borderColor = hex(f.color)
    const nm = document.createElement('span')
    nm.className = 'nm'
    nm.textContent = f.name
    nm.style.color = hex(f.color)
    li.append(face, nm, k)
    if (f.kind === 'local') li.className = 'me'
    ul.appendChild(li)
  }
  const free = GAME.maxPlayers - list.length
  let netLine = ''
  if (net) {
    const r = net.relaysOnline()
    // пока никого нет — показываем, на связи ли серверы поиска: так понятно, где ломается
    netLine = list.length > 1 ? '' : r.open === 0 ? ' · ⚠ нет связи с сервером' : ` · связь ${r.open}/${r.total}`
  }
  $('net-status').textContent = !net
    ? 'тренировка'
    : `до ${MATCH.killsToWin} · ` + (free > 0 ? `мест ${free}` : 'полная') + netLine
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

const PREVIEW = { x: -3.5, z: 5.5 } // свободный пол, без мебели под ногами
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
    if (sel) a.action('SwordSlash', 1.2)
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
  // крупный план: голова и плечи
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
  cam.position.set(0.35, 1.6, 2.35)
  cam.lookAt(0, 1.33, 0)
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
    ].filter(Boolean)
    btn.innerHTML = `<b>${c.name}</b><span class="info"><img src="${PORTRAITS[id]}" alt=""><span class="stats">${parts.join('')}</span></span>`
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
/**
 * Меню в двух видах:
 * — пришёл по ссылке: «Тебя позвали в офис ABCD», большая кнопка «Войти», внизу «Создать свой офис»;
 * — открыл сам: большая кнопка «Создать офис», ниже поле «Код офиса» + «Войти».
 */
function setMenuMode(code: string | null): void {
  $('menu-tagline').textContent = code
    ? `Тебя позвали в офис ${code}`
    : 'Создай офис и позови коллег по ссылке — или войди по коду'
  $('btn-main').textContent = code ? 'Войти' : 'Создать офис'
  $('join-row').hidden = !!code
  $('btn-create').hidden = !code
}
setMenuMode(readRoomCode())
const joinCode = $('join-code') as HTMLInputElement
joinCode.addEventListener('input', () => { joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
$('btn-join').addEventListener('click', () => {
  const c = joinCode.value.trim().toUpperCase()
  if (c.length < 4) { joinCode.focus(); showToast('Введи код офиса — 4 буквы или цифры из ссылки', 2500); return }
  void startGame(c)
})
joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click() })
$('btn-create').addEventListener('click', () => void startGame(makeRoomCode()))

async function startGame(code: string | null): Promise<void> {
  // без выбранного возраста не пускаем: от него зависит, будет кровь или конфетти
  if (![...ageRadios].some((r) => r.checked)) {
    const err = $('menu-error')
    err.textContent = 'Выбери свой возраст'
    err.hidden = false
    document.querySelector('.age')?.classList.add('need')
    return
  }
  $('menu-error').hidden = true
  document.querySelector('.age')?.classList.remove('need')
  myName = nameInput.value.trim().slice(0, 16) || 'Коллега'
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
    onLink: () => renderScore(),
    onPeerHello: () => rosterChanged(),
    onPeerLeave: (id) => {
      const f = match?.fighters.get(id)
      const why = net?.stats.drops[net.stats.drops.length - 1]?.split(': ').pop() ?? ''
      if (f) showToast(`${f.name} ушёл из офиса${why && why !== 'вышел' ? ` (${why})` : ''}`, 3500)
      match?.remove(id)
      rosterChanged()
    },
    onSlotChange: (slot) => {
      if (!match?.local) return
      match.restyle(match.local.id, match.local.name, PLAYER_COLORS[slot])
      // только что появились — переходим к своему лифту
      if (performance.now() - spawnedAt < 5000) match.moveLocalToSpawn(slot)
      rosterChanged()
    },
    onPeerState: (id, s) => match?.onState(id, s),
    onAtk: (id, m) => match?.onAtk(id, m),
    onHurt: (id, m) => match?.onHurt(id, m),
    onDie: (id, m) => match?.onDie(id, m),
    onPick: (id, m) => match?.onPick(id, m),
    onRoomFull: () => backToMenu('В этой комнате уже 4 человека. Создай свою и позови коллег!'),
    onPickupSync: (c) => match?.syncPickups(c),
  })
  match = new Match(scene, office, hooks, net)
  match.setSeed(code)
  const mm = match
  net.helloExtra = () => mm.pickupCounts()
  // карточка-приглашение, пока в комнате никого
  $('ic-code').textContent = code
  $('ic-link').textContent = inviteUrl(code)
  $('invite-card').hidden = false
  match.fx.gore = gore
  // сначала слушаем комнату: кто уже здесь и какие лифты заняты — потом выходим из своего
  $('invite-card').hidden = true
  showToast('Входим в офис…', 2500)
  const room = net
  const linked = await room.ready()
  if (net !== room || !match) return // успели выйти в меню
  if (!linked) showToast('Нет связи с игровыми серверами — проверь интернет или выключи VPN. Пока можно потренироваться', 7000)
  const slot = room.claimSlot()
  if (slot < 0) { backToMenu('В этой комнате уже 4 человека. Создай свою и позови коллег!'); return }
  match.addLocal(room.selfId, myName, myChar, PLAYER_COLORS[slot], slot)
  spawnedAt = performance.now()
  if (room.peers.size === 0) {
    match.addDummies() // пока коллеги не пришли — манекены у кулера
    $('invite-card').hidden = false
  }
  camTarget.set(match.local!.body.x, 0, match.local!.body.z)
  rosterChanged()
  renderScore()
  renderHud(true)
}

function backToMenu(error?: string): void {
  net?.leave()
  net = null
  match?.dispose()
  match = null
  $('death').hidden = $('win').hidden = true
  $('invite-card').hidden = true
  $('feed').textContent = ''
  history.replaceState(null, '', location.pathname)
  $('hud').hidden = true
  $('menu').hidden = false
  setMenuMode(null)
  setPreview(myChar)
  const err = $('menu-error')
  err.hidden = !error
  err.textContent = error ?? ''
}

$('btn-main').addEventListener('click', () => void startGame(readRoomCode() ?? makeRoomCode()))
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-main').click() })

function inviteUrl(code: string): string {
  return `${location.href.split('#')[0].split('?')[0]}#${code}`
}

// одно действие: на телефоне — меню «Поделиться», на компьютере — копируем ссылку
const canShare = !!navigator.share && window.matchMedia('(pointer: coarse)').matches
$('ic-copy').textContent = 'Пригласить'

async function sendInvite(): Promise<void> {
  if (!net) return
  const url = inviteUrl(net.code)
  const text = `${myName} зовёт тебя в «Офис»`
  if (canShare) {
    try { await navigator.share({ title: 'Офис', text, url }); return } catch { /* отменили — скопируем */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`)
    const b = $('ic-copy')
    b.textContent = 'Приглашение скопировано ✓'
    setTimeout(() => { b.textContent = 'Пригласить' }, 2000)
    showToast('Приглашение скопировано — вставь его в чат коллегам', 3000)
  } catch {
    window.prompt('Скопируй ссылку и отправь коллегам:', url)
  }
}
$('ic-copy').addEventListener('click', () => void sendInvite())
// нажатие на ссылку — копирует только ссылку
$('ic-link').addEventListener('click', async () => {
  if (!net) return
  const url = inviteUrl(net.code)
  const el = $('ic-link')
  try {
    await navigator.clipboard.writeText(url)
    el.classList.add('copied')
    el.textContent = 'Ссылка скопирована ✓'
    setTimeout(() => { el.classList.remove('copied'); el.textContent = url }, 1500)
  } catch {
    window.prompt('Скопируй ссылку:', url)
  }
})
$('ic-close').addEventListener('click', () => { $('invite-card').hidden = true })
// «Позвать коллег» просто открывает ту же карточку
$('btn-invite').addEventListener('click', () => {
  const c = $('invite-card')
  c.hidden = !c.hidden
  ;($('btn-invite') as HTMLButtonElement).blur()
})

// ---------- прицел на полу (телефон: пока тянешь правый стик) ----------

const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
const aimMarker = new THREE.Mesh(new THREE.BufferGeometry(), aimMat)
aimMarker.renderOrder = 3
aimMarker.visible = false
scene.add(aimMarker)
let aimFor = ''

function updateAimMarker(me: { body: { x: number; z: number }; weapon: WeaponId }, angle: number | null): void {
  if (angle === null) { aimMarker.visible = false; return }
  const w = WEAPONS[me.weapon]
  if (aimFor !== w.id) {
    aimFor = w.id
    aimMarker.geometry.dispose()
    // ближний бой — сектор шириной в размах удара, дальний — полоса с разбросом
    const arc = ((w.type === 'melee' ? w.arc ?? 90 : Math.max(w.spread ?? 4, 6)) * Math.PI) / 180
    const g = new THREE.CircleGeometry(w.range + 0.4, 24, Math.PI / 2 - arc / 2, arc)
    g.rotateX(-Math.PI / 2)
    aimMarker.geometry = g
  }
  aimMarker.visible = true
  aimMarker.position.set(me.body.x, 0.05, me.body.z)
  aimMarker.rotation.y = angle - Math.PI
}

// ---------- цикл ----------

const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1)
const ray = new THREE.Raycaster()
const aimPoint = new THREE.Vector3()
const timer = new THREE.Timer()
timer.connect(document)
let sendAcc = 0
let fpsAcc = 0, fpsFrames = 0
let scoreAcc = 0
let pendingFire: { angle: number | null; t: number } | null = null
let diagAcc = 0, lastRx = 0

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
    // правый стик: тянешь — целишься (сектор на полу), отпустил — удар; тап — удар по ближайшему
    const fire = input.takeFire()
    if (fire) pendingFire = { angle: fire.aim ? Input.screenToWorldAngle(fire.aim) : null, t: 0.35 }
    if (input.aimStick) aim = Input.screenToWorldAngle(input.aimStick)
    else if (pendingFire && pendingFire.angle !== null) aim = pendingFire.angle
    const cdBefore = me.cooldown
    match.update(dt, {
      move: input.moveDir(), aim,
      attack: input.attacking || !!pendingFire,
      autoAim: !!pendingFire && pendingFire.angle === null,
    })
    if (pendingFire) {
      pendingFire.t -= dt
      // удар случился (перезарядка выросла) или ждали слишком долго — забываем
      if (me.cooldown > cdBefore || pendingFire.t <= 0) pendingFire = null
    }
    updateAimMarker(me, input.aimStick ? aim : null)

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
    diagAcc += dt
    if (net && diagAcc > 1) {
      // диагностика связи в настройках: серверы, входящие сообщения в секунду, обрывы, последняя потеря игрока
      const st = net.stats, r = net.relaysOnline()
      const rx = st.rx.reduce((a, b) => a + b, 0)
      $('netdiag').textContent = `связь ${r.open}/${r.total} · пинг ${st.rtt.map((v) => (v ? Math.round(v) : '–')).join('/')} мс · ↓${Math.round((rx - lastRx) / diagAcc)}/с · обрывы ${st.closes.join('/')}` + (st.drops.length ? ` · ${st.drops[st.drops.length - 1]}` : '')
      lastRx = rx
      diagAcc = 0
    }
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
  if (!NORENDER) gfx.render()
  if (lineup.size && !NORENDER) {
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
window.addEventListener('pagehide', () => net?.leave())
requestAnimationFrame(frame)
;(window as unknown as { __office: unknown }).__office = office
;(window as unknown as { __match: () => Match | null }).__match = () => match
;(window as unknown as { __net: () => NetRoom | null }).__net = () => net
;(window as unknown as { __cam: unknown }).__cam = camera
// всё готово — убираем полоску загрузки, показываем меню
requestAnimationFrame(() => {
  $('menu').style.visibility = ''
  $('loader').classList.add('done')
  setTimeout(() => $('loader').remove(), 400)
})
