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
}

export interface PeerInfo {
  id: string
  name: string
  joinedAt: number
  character: CharacterId
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
const PEER_TIMEOUT = 6000 // молчит дольше — считаем, что ушёл

type Envelope = { f: string; s: number; k: string; d: unknown; to?: string }

export const selfId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)

/**
 * Комната: все участники подписаны на один топик и рассылают туда свои сообщения.
 * Своего сервера нет — только чужие бесплатные брокеры.
 */
export class NetRoom {
  readonly selfId = selfId
  readonly joinedAt = Date.now()
  readonly peers = new Map<string, PeerInfo>()
  private clients: MqttClient[] = []
  private seq = 0
  private seenSets = new Map<string, Set<number>>()
  private lastHeard = new Map<string, number>()
  private timer = 0
  private left = false
  private topic: string
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

    for (const url of BROKERS) {
      const c = mqtt.connect(url, {
        clientId: `or_${selfId}_${Math.random().toString(36).slice(2, 6)}`,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 20,
        // если вкладку закрыли — брокер сам сообщит остальным
        will: { topic: this.topic, payload: JSON.stringify({ f: selfId, s: -1, k: 'bye', d: null }), qos: 0, retain: false },
      })
      c.on('connect', () => {
        c.subscribe(this.topic, { qos: 0 })
        this.hello()
        ev.onLink?.()
      })
      c.on('close', () => ev.onLink?.())
      c.on('error', (e) => console.warn('[net]', url, e.message))
      c.on('message', (_t, buf) => this.receive(buf))
      this.clients.push(c)
    }
    // раз в 2 секунды — «я тут»: так находим друг друга и замечаем ушедших
    this.timer = window.setInterval(() => {
      this.hello()
      const now = Date.now()
      for (const [id, t] of this.lastHeard) if (now - t > PEER_TIMEOUT) this.drop(id)
    }, 2000)
  }

  private hello(to?: string): void {
    this.send('hello', { name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter } satisfies Hello, to)
  }

  private send(k: string, d: unknown, to?: string): void {
    if (this.left) return
    const env: Envelope = { f: selfId, s: ++this.seq, k, d }
    if (to) env.to = to
    const payload = JSON.stringify(env)
    for (const c of this.clients) if (c.connected) c.publish(this.topic, payload, { qos: 0 })
  }

  private receive(buf: Uint8Array): void {
    let env: Envelope
    try { env = JSON.parse(new TextDecoder().decode(buf)) } catch { return }
    if (!env || typeof env.f !== 'string' || env.f === selfId || typeof env.k !== 'string') return
    if (env.to && env.to !== selfId) return
    if (env.k === 'bye') { this.drop(env.f); return }
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
        const isNew = !this.peers.has(id)
        const ch = String(d?.character)
        const info: PeerInfo = {
          id,
          name: String(d?.name ?? '').slice(0, 16) || 'Коллега',
          joinedAt: Number(d?.joinedAt) || Date.now(),
          character: ch in CHARACTERS ? (ch as CharacterId) : 'courier',
        }
        this.peers.set(id, info)
        if (isNew) {
          this.hello(id) // новичку сразу отвечаем, не дожидаясь таймера
          this.ev.onPeerHello(info)
          if (this.rankOf(this.selfId) >= GAME.maxPlayers) { this.leave(); this.ev.onRoomFull() }
        }
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

  private drop(id: string): void {
    this.lastHeard.delete(id)
    this.seenSets.delete(id)
    if (this.peers.delete(id)) this.ev.onPeerLeave(id)
  }

  /** Все участники по порядку входа: от этого зависят цвет и точка появления */
  ordered(): PeerInfo[] {
    return [
      { id: this.selfId, name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter },
      ...this.peers.values(),
    ].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
  }

  /** Сколько серверов сейчас на связи */
  relaysOnline(): { open: number; total: number } {
    return { open: this.clients.filter((c) => c.connected).length, total: this.clients.length }
  }

  rankOf(id: string): number {
    return this.ordered().findIndex((p) => p.id === id)
  }

  broadcastState(s: StatePacket): void {
    if (this.peers.size) this.send('st', s)
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

