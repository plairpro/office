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
    offset: { x: 10.5, y: 15, z: 10.5 }, // изометрический угол
    aimLead: 0.18, // насколько камера смещается в сторону прицела
    follow: 8, // скорость следования
  },
} as const

/** Цвета рубашек игроков по слотам */
// цвета игроков — из палитры Monument Valley, но достаточно разные, чтобы различать в бою
export const PLAYER_COLORS = [0xe9806e, 0x4fb3a9, 0xf0b84a, 0x9483d1] as const

// --- Персонажи ---

export type CharacterId = 'accountant' | 'boss' | 'secretary' | 'courier'

export interface CharacterDef {
  id: CharacterId
  name: string
  blurb: string
  hp: number
  moveMul: number // множитель скорости бега
  attackSpeedMul: number // множитель скорости атаки (больше — быстрее)
  dodge: number // шанс уклониться от удара, 0..1
  radius: number // размер хитбокса
  knockbackResist: number // 0 — отлетает полностью, 1 — не отлетает
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  accountant: {
    id: 'accountant', name: 'Бухгалтерша', blurb: 'Хрупкая, но вёрткая. Видела всё.',
    hp: 80, moveMul: 1.03, attackSpeedMul: 1.15, dodge: 0.15, radius: 0.38, knockbackResist: 0,
  },
  boss: {
    id: 'boss', name: 'Босс', blurb: 'Медленный, но его не сдвинуть.',
    hp: 150, moveMul: 0.92, attackSpeedMul: 0.95, dodge: 0, radius: 0.52, knockbackResist: 0.7,
  },
  secretary: {
    id: 'secretary', name: 'Секретарша', blurb: 'Печатает 300 знаков в минуту. И бьёт так же.',
    hp: 90, moveMul: 1.04, attackSpeedMul: 1.25, dodge: 0, radius: 0.38, knockbackResist: 0,
  },
  courier: {
    id: 'courier', name: 'Курьер', blurb: 'Доставка за 30 секунд или пицца бесплатно.',
    hp: 95, moveMul: 1.12, attackSpeedMul: 1.05, dodge: 0, radius: 0.42, knockbackResist: 0,
  },
}

export const CHARACTER_ORDER: CharacterId[] = ['accountant', 'boss', 'secretary', 'courier']

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
