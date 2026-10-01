// Все игровые параметры — здесь, а не в коде. Баланс правим только в этом файле.

export const GAME = {
  maxPlayers: 4,
  player: {
    radius: 0.42,
    speed: 6.2, // м/с
    accel: 40, // насколько резко набирает скорость
    maxHp: 100,
  },
  net: {
    appId: 'office-rage-plairpro-v1',
    sendRateHz: 20,
    roomCodeLength: 4,
  },
  camera: {
    fov: 32,
    offset: { x: 15.5, y: 23, z: 15.5 }, // изометрический угол
    aimLead: 0.18, // насколько камера смещается в сторону прицела
    follow: 8, // скорость следования
  },
} as const

/** Цвета рубашек игроков по слотам */
export const PLAYER_COLORS = [0xe8505b, 0x3d8bfd, 0xf5b700, 0x2bb673] as const

// --- Оружие (используется со следующего этапа) ---

export type Effect =
  | { kind: 'bleed'; seconds: number; dps: number }
  | { kind: 'slow'; seconds: number; factor: number }
  | { kind: 'stun'; seconds: number }
  | { kind: 'disarm'; seconds: number }
  | { kind: 'knockback'; force: number }

export interface WeaponDef {
  id: string
  name: string
  type: 'melee' | 'ranged'
  range: number // метры
  damage: number
  cooldown: number // секунды между атаками
  windup?: number // замах перед ударом (видно противнику)
  arc?: number // угол удара в градусах (ближний бой)
  pellets?: number // дробь
  spread?: number // разброс в градусах
  ammo?: number
  backstabMultiplier?: number
  effects: Effect[]
}

export const WEAPONS: Record<string, WeaponDef> = {
  cutter: {
    id: 'cutter', name: 'Канцелярский нож', type: 'melee',
    range: 1.1, damage: 18, cooldown: 0.35, arc: 70, backstabMultiplier: 2,
    effects: [{ kind: 'bleed', seconds: 10, dps: 2 }],
  },
  stapler: {
    id: 'stapler', name: 'Степлер', type: 'ranged',
    range: 10, damage: 12, cooldown: 0.22, spread: 4, ammo: 12,
    effects: [{ kind: 'bleed', seconds: 5, dps: 1.5 }],
  },
  mop: {
    id: 'mop', name: 'Швабра', type: 'melee',
    range: 2.2, damage: 10, cooldown: 0.7, arc: 140,
    effects: [{ kind: 'slow', seconds: 5, factor: 0.6 }, { kind: 'knockback', force: 6 }],
  },
  lamp: {
    id: 'lamp', name: 'Настольная лампа', type: 'melee',
    range: 1.2, damage: 35, cooldown: 1.1, windup: 0.45, arc: 90,
    effects: [{ kind: 'stun', seconds: 0.7 }],
  },
  moneygun: {
    id: 'moneygun', name: 'Деньгомёт', type: 'ranged',
    range: 5, damage: 5, cooldown: 0.9, pellets: 6, spread: 28, ammo: 6,
    effects: [{ kind: 'disarm', seconds: 1.5 }],
  },
}
