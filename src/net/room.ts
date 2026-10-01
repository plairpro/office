import { joinRoom, selfId, type Room } from 'trystero'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'

/** Сжатое состояние игрока: x, z, угол взгляда, скорость */
export type StatePacket = [number, number, number, number, number]

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
      if (Array.isArray(s) && s.length === 5 && this.peers.has(peerId)) ev.onPeerState(peerId, s)
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
