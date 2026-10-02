import { joinRoom, selfId, type Room } from 'trystero'
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
}

/**
 * P2P-комната через Trystero. Браузеры находят друг друга через публичные
 * сигнальные релеи (Nostr), дальше общаются напрямую по WebRTC — свой сервер не нужен.
 */
export class NetRoom {
  readonly selfId = selfId
  readonly joinedAt = Date.now()
  readonly peers = new Map<string, PeerInfo>()
  private room: Room
  private sendState: (s: StatePacket) => void
  readonly atk: (m: AtkMsg) => void
  readonly hurt: (m: HurtMsg) => void
  readonly die: (m: DieMsg) => void
  readonly pick: (m: PickMsg) => void
  private left = false

  constructor(
    readonly code: string,
    private myName: string,
    private myCharacter: CharacterId,
    ev: NetEvents,
  ) {
    this.room = joinRoom({ appId: GAME.net.appId }, `room-${code}`)

    const hello = this.room.makeAction<Hello>('hello')
    const state = this.room.makeAction<StatePacket>('st')
    this.sendState = (s) => { if (!this.left) void state.send(s) }
    const atk = this.room.makeAction<AtkMsg>('atk')
    const hurt = this.room.makeAction<HurtMsg>('hurt')
    const die = this.room.makeAction<DieMsg>('die')
    const pick = this.room.makeAction<PickMsg>('pick')
    const sender = <T,>(a: { send: (d: T) => unknown }) => (d: T) => { if (!this.left && this.peers.size) void a.send(d) }
    this.atk = sender(atk)
    this.hurt = sender(hurt)
    this.die = sender(die)
    this.pick = sender(pick)
    const known = (id: string) => this.peers.has(id)
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    atk.onMessage = (m, { peerId }) => {
      if (known(peerId) && m && num(m.w) && num(m.x) && num(m.z) && num(m.a) && num(m.s)) ev.onAtk(peerId, m)
    }
    hurt.onMessage = (m, { peerId }) => {
      if (known(peerId) && m && num(m.n) && num(m.dx) && num(m.dz) && num(m.w) && num(m.k)) ev.onHurt(peerId, { ...m, by: String(m.by) })
    }
    die.onMessage = (m, { peerId }) => {
      if (known(peerId) && m && num(m.w) && Array.isArray(m.hv) && m.hv.length === 3 && m.hv.every(num)) ev.onDie(peerId, { ...m, by: String(m.by) })
    }
    pick.onMessage = (m, { peerId }) => {
      if (known(peerId) && m && num(m.i)) ev.onPick(peerId, m)
    }

    this.room.onPeerJoin = (id) => {
      void hello.send({ name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter }, { target: id })
    }
    this.room.onPeerLeave = (id) => {
      this.peers.delete(id)
      ev.onPeerLeave(id)
    }
    hello.onMessage = (data, { peerId }) => {
      const info: PeerInfo = {
        id: peerId,
        name: String(data.name).slice(0, 16) || 'Коллега',
        joinedAt: Number(data.joinedAt) || Date.now(),
        character: data.character in CHARACTERS ? data.character : 'courier',
      }
      this.peers.set(peerId, info)
      ev.onPeerHello(info)
      // комната на 4: если я пришёл позже четвёртого — ухожу сам
      if (this.rankOf(this.selfId) >= GAME.maxPlayers) {
        this.leave()
        ev.onRoomFull()
      }
    }
    state.onMessage = (s, { peerId }) => {
      if (Array.isArray(s) && s.length === STATE_LEN && s.every((v) => typeof v === 'number' && Number.isFinite(v)) && this.peers.has(peerId)) ev.onPeerState(peerId, s)
    }
  }

  /** Все участники по порядку входа: от этого зависят цвет и точка появления */
  ordered(): PeerInfo[] {
    return [
      { id: this.selfId, name: this.myName, joinedAt: this.joinedAt, character: this.myCharacter },
      ...this.peers.values(),
    ]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
  }

  rankOf(id: string): number {
    return this.ordered().findIndex((p) => p.id === id)
  }

  broadcastState(s: StatePacket): void {
    if (this.peers.size) this.sendState(s)
  }

  leave(): void {
    if (this.left) return
    this.left = true
    void this.room.leave()
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
