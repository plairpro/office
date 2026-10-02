import mqtt, { type MqttClient } from 'mqtt'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'

/**
 * Сжатое состояние игрока, 20 раз в секунду:
 * x, z, угол взгляда, скорость x/z, оружие (индекс WEAPON_IDS), флаги, здоровье, убийства, номер раунда
 */
export type StatePacket = [number, number, number, number, number, number, number, number, number, number]
export const STATE_LEN = 10
/** Флаги состояния */
export const F_DEAD = 1, F_STUN = 2, F_INVULN = 4, F_BLEED = 8, F_SLOW = 16

/** Атака: оружие, откуда, куда, зерно разброса (снаряды у всех летят одинаково) */
export type AtkMsg = { w: number; x: number; z: number; a: number; s: number }
/** Попадание — рассылает тот, в кого попали: урон, направление, оружие, вид (0 — удар, 1 — уклон, 2 — в спину), кто */
export type HurtMsg = { n: number; dx: number; dz: number; w: number; k: number; by: string }
/** Смерть — рассылает погибший: кто убил, чем, как полетела голова */
export type DieMsg = { by: string; w: number; hv: [number, number, number] }
/** Подобрал предмет с пола */
export type PickMsg = { i: number }

export type Hello = {
  name: string
  joinedAt: number
  character: CharacterId
  slot: number // номер лифта 0..3, -1 — ещё не выбрал
  v: string // версия игры
}

export interface PeerInfo {
  id: string
  name: string
  joinedAt: number
  character: CharacterId
  slot: number
  v?: string
}

export interface NetEvents {
  onPeerHello(info: PeerInfo): void
  onPeerLeave(id: string): void
  onPeerState(id: string, s: StatePacket): void
  onRoomFull(): void
  onAtk(id: string, m: AtkMsg): void
  onHurt(id: string, m: HurtMsg): void
  onDie(id: string, m: DieMsg): void
  onPick(id: string, m: PickMsg): void
  /** изменилось число серверов на связи */
  onLink?(): void
  /** мой лифт пришлось сменить (двое зашли одновременно) */
  onSlotChange?(slot: number): void
}

/**
 * Публичные MQTT-брокеры: обычный WebSocket, работает везде, где открываются сайты
 * (в отличие от прямых WebRTC-соединений, которые режут мобильные операторы и офисные сети).
 * Подключаемся сразу к нескольким и шлём во все — игра живёт, пока жив хоть один. Повторы отбрасываем.
 */
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
]

const PREFIX = `office-rage/${GAME.net.appId}`
const PEER_TIMEOUT = 15000 // молчит дольше — считаем, что ушёл

type Envelope = { f: string; s: number; k: string; d: unknown; to?: string }

/** Новый id на каждый вход в офис: иначе после повторного входа номера сообщений начинаются заново
 *  и остальные игроки отбрасывают их как уже полученные (игрок «пропадает», удары не доходят) */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)

/**
 * Комната: все участники подписаны на один топик и рассылают туда свои сообщения.
 * Своего сервера нет — только чужие бесплатные брокеры.
 */
export class NetRoom {
  readonly selfId = newId()
  readonly joinedAt = Date.now()
  readonly peers = new Map<string, PeerInfo>()
  private clients: MqttClient[] = []
  private seq = 0
  private seenSets = new Map<string, Set<number>>()
  private lastHeard = new Map<string, number>()
  private timer = 0
  private left = false
  private topic: string
  mySlot = -1
  /** диагностика: что приходит с каждого брокера, обрывы, почему кого-то потеряли */
  readonly stats = { rx: [0, 0], tx: 0, closes: [0, 0], drops: [] as string[], rtt: [0, 0] }
  readonly atk: (m: AtkMsg) => void
  readonly hurt: (m: HurtMsg) => void
  readonly die: (m: DieMsg) => void
  readonly pick: (m: PickMsg) => void

  constructor(
    readonly code: string,
    private myName: string,
    private myCharacter: CharacterId,
    private ev: NetEvents,
  ) {
    this.topic = `${PREFIX}/${code}`
    this.atk = (m) => this.send('atk', m)
    this.hurt = (m) => this.send('hurt', m)
    this.die = (m) => this.send('die', m)
    this.pick = (m) => this.send('pick', m)

    BROKERS.forEach((url, bi) => {
      const c = mqtt.connect(url, {
        clientId: `or_${this.selfId}_${Math.random().toString(36).slice(2, 6)}`,
        clean: true,
        protocolVersion: 5, // MQTT 5: можно не получать обратно свои же сообщения (вдвое меньше входящего трафика)
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 20,
        // если вкладку закрыли — брокер сам сообщит остальным
        will: { topic: this.topic, payload: JSON.stringify({ f: this.selfId, s: -1, k: 'bye', d: null }), qos: 0, retain: false },
      })
      c.on('connect', () => {
        c.subscribe(this.topic, { qos: 0, nl: true })
        c.subscribe(`${this.topic}/ping/${this.selfId}`, { qos: 0 })
        this.hello()
        ev.onLink?.()
      })
      c.on('close', () => { this.stats.closes[bi]++; ev.onLink?.() })
      c.on('error', (e) => console.warn('[net]', url, e.message))
      c.on('message', (t, buf) => { if (t === this.topic) this.stats.rx[bi]++; this.receive(buf, bi) })
      this.clients.push(c)
    })
    // раз в 2 секунды — «я тут»: так находим друг друга и замечаем ушедших
    this.timer = window.setInterval(() => {
      this.hello()
      // пинг: шлём себе через каждый брокер и меряем, через сколько вернулось
      this.clients.forEach((c, bi) => {
        if (c.connected) c.publish(`${this.topic}/ping/${this.selfId}`, JSON.stringify({ f: this.selfId, s: 0, k: 'ping', d: [bi, performance.now()] }), { qos: 0 })
      })
      const now = Date.now()
      for (const [id, t] of this.lastHeard) if (now - t > PEER_TIMEOUT) this.drop(id, `тишина ${now - t} мс`)
    }, 2000)
  }

  private hello(to?: string): void {
    this.send('hello', { name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter, slot: this.mySlot, v: __BUILD__ } satisfies Hello, to)
  }

  private send(k: string, d: unknown, to?: string, one = false): void {
    if (this.left) return
    const env: Envelope = { f: this.selfId, s: ++this.seq, k, d }
    if (to) env.to = to
    const payload = JSON.stringify(env)
    if (one) {
      // частые сообщения — через самый быстрый из живых брокеров
      let best = -1
      this.clients.forEach((c, i) => {
        if (c.connected && (best < 0 || (this.stats.rtt[i] || 9999) < (this.stats.rtt[best] || 9999))) best = i
      })
      if (best >= 0) this.clients[best].publish(this.topic, payload, { qos: 0 })
    } else {
      for (const c of this.clients) if (c.connected) c.publish(this.topic, payload, { qos: 0 })
    }
    this.stats.tx++
  }

  private receive(buf: Uint8Array, bi: number): void {
    let env: Envelope
    try { env = JSON.parse(new TextDecoder().decode(buf)) } catch { return }
    if (env?.k === 'ping' && env.f === this.selfId && Array.isArray(env.d) && env.d[0] === bi) {
      const rtt = performance.now() - Number(env.d[1])
      this.stats.rtt[bi] = this.stats.rtt[bi] ? this.stats.rtt[bi] * 0.7 + rtt * 0.3 : rtt
      return
    }
    if (!env || typeof env.f !== 'string' || env.f === this.selfId || typeof env.k !== 'string') return
    if (env.to && env.to !== this.selfId) return
    if (env.k === 'bye') {
      // «прощание» от брокера (s = -1) приходит и при коротком обрыве с одним из брокеров —
      // если игрок только что был слышен через другой, не выкидываем его
      if (env.s >= 0 || Date.now() - (this.lastHeard.get(env.f) ?? 0) > 3000) this.drop(env.f, env.s >= 0 ? 'вышел' : 'брокер: обрыв')
      return
    }
    // одно и то же сообщение приходит от каждого брокера — пропускаем повторы
    let set = this.seenSets.get(env.f)
    if (!set) { set = new Set(); this.seenSets.set(env.f, set) }
    if (set.has(env.s)) return
    set.add(env.s)
    if (set.size > 400) { const old = [...set].slice(0, 200); for (const x of old) set.delete(x) }
    this.lastHeard.set(env.f, Date.now())
    const id = env.f
    const d = env.d as Record<string, unknown>
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    switch (env.k) {
      case 'hello': {
        const prev = this.peers.get(id)
        const ch = String(d?.character)
        const slot = Number(d?.slot)
        const info: PeerInfo = {
          id,
          name: String(d?.name ?? '').slice(0, 16) || 'Коллега',
          joinedAt: Number(d?.joinedAt) || Date.now(),
          character: ch in CHARACTERS ? (ch as CharacterId) : 'courier',
          slot: Number.isInteger(slot) && slot >= 0 && slot < GAME.maxPlayers ? slot : -1,
          v: String(d?.v ?? 'старая'),
        }
        this.peers.set(id, info)
        if (!prev) this.hello(id) // новичку сразу отвечаем, не дожидаясь таймера
        // двое заняли один лифт — уступает тот, кто зашёл позже
        if (info.slot >= 0 && info.slot === this.mySlot &&
          (info.joinedAt < this.joinedAt || (info.joinedAt === this.joinedAt && id < this.selfId))) {
          const free = this.freeSlot()
          if (free < 0) { this.leave(); this.ev.onRoomFull(); return }
          this.mySlot = free
          this.hello()
          this.ev.onSlotChange?.(free)
        }
        if (!prev || prev.slot !== info.slot || prev.name !== info.name) this.ev.onPeerHello(info)
        break
      }
      case 'st': {
        const s = env.d
        if (this.peers.has(id) && Array.isArray(s) && s.length === STATE_LEN && s.every(num)) this.ev.onPeerState(id, s as StatePacket)
        break
      }
      case 'atk':
        if (this.peers.has(id) && d && num(d.w) && num(d.x) && num(d.z) && num(d.a) && num(d.s)) this.ev.onAtk(id, d as unknown as AtkMsg)
        break
      case 'hurt':
        if (this.peers.has(id) && d && num(d.n) && num(d.dx) && num(d.dz) && num(d.w) && num(d.k)) this.ev.onHurt(id, { ...(d as unknown as HurtMsg), by: String(d.by) })
        break
      case 'die':
        if (this.peers.has(id) && d && num(d.w) && Array.isArray(d.hv) && d.hv.length === 3 && d.hv.every(num)) this.ev.onDie(id, { ...(d as unknown as DieMsg), by: String(d.by) })
        break
      case 'pick':
        if (this.peers.has(id) && d && num(d.i)) this.ev.onPick(id, d as unknown as PickMsg)
        break
    }
  }

  private drop(id: string, why = ''): void {
    if (this.peers.has(id)) this.stats.drops.push(`${new Date().toLocaleTimeString()} ${this.peers.get(id)?.name}: ${why}`)
    this.lastHeard.delete(id)
    this.seenSets.delete(id)
    if (this.peers.delete(id)) this.ev.onPeerLeave(id)
  }

  /** Свободный лифт с наименьшим номером, -1 — мест нет */
  private freeSlot(): number {
    const used = new Set([...this.peers.values()].map((p) => p.slot))
    for (let i = 0; i < GAME.maxPlayers; i++) if (!used.has(i)) return i
    return -1
  }

  /** Занять лифт: первый пришедший — лифт 1, второй — 2 и так далее */
  claimSlot(): number {
    this.mySlot = this.freeSlot()
    if (this.mySlot >= 0) this.hello()
    return this.mySlot
  }

  /** Все участники по номеру лифта */
  ordered(): PeerInfo[] {
    return [
      { id: this.selfId, name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter, slot: this.mySlot },
      ...this.peers.values(),
    ].sort((a, b) => a.slot - b.slot || a.joinedAt - b.joinedAt)
  }

  /** Сколько серверов сейчас на связи */
  relaysOnline(): { open: number; total: number } {
    return { open: this.clients.filter((c) => c.connected).length, total: this.clients.length }
  }

  broadcastState(s: StatePacket): void {
    // позиции — самые частые сообщения: шлём через один брокер (первый живой), чтобы не упереться в лимиты.
    // Удары, урон и смерть идут через оба — их терять нельзя
    if (this.peers.size) this.send('st', s, undefined, true)
  }

  leave(): void {
    if (this.left) return
    this.send('bye', null)
    this.left = true
    clearInterval(this.timer)
    for (const c of this.clients) c.end(true)
  }
}

/** Код комнаты: без похожих символов (0/O, 1/I) */
export function makeRoomCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint32Array(GAME.net.roomCodeLength)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => abc[n % abc.length]).join('')
}

export function readRoomCode(): string | null {
  const m = location.hash.match(/^#([A-Z0-9]{4,8})$/i)
  return m ? m[1].toUpperCase() : null
}

