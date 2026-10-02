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
    sendRateHz: 10,
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
  attackSpeedMul: number // скорость атаки персонажа: делит перезарядку и замах оружия (урон — только у оружия)
  dodge: number // шанс уклониться от удара, 0..1
  radius: number // размер хитбокса
  knockbackResist: number // 0 — отлетает полностью, 1 — не отлетает
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  accountant: {
    id: 'accountant', name: 'Бухгалтерша', blurb: 'Хрупкая, но вёрткая. Видела всё.',
    hp: 80, moveMul: 1.03, attackSpeedMul: 1.3, dodge: 0.15, radius: 0.38, knockbackResist: 0,
  },
  boss: {
    id: 'boss', name: 'Босс', blurb: 'Самый живучий и почти не отлетает от ударов, но медленный.',
    hp: 120, moveMul: 0.92, attackSpeedMul: 0.8, dodge: 0, radius: 0.52, knockbackResist: 0.7,
  },
  secretary: {
    id: 'secretary', name: 'Секретарша', blurb: 'Печатает 300 знаков в минуту. И бьёт так же.',
    hp: 90, moveMul: 1.04, attackSpeedMul: 1.5, dodge: 0, radius: 0.38, knockbackResist: 0,
  },
  courier: {
    id: 'courier', name: 'Курьер', blurb: 'Доставка за 30 секунд или пицца бесплатно.',
    hp: 95, moveMul: 1.12, attackSpeedMul: 1.1, dodge: 0, radius: 0.42, knockbackResist: 0,
  },
}

export const CHARACTER_ORDER: CharacterId[] = ['accountant', 'boss', 'secretary', 'courier']

// --- Матч ---

export const MATCH = {
  killsToWin: 10,
  respawnDelay: 3, // секунды до возрождения
  spawnProtect: 1.5, // неуязвимость после возрождения
  pickupRespawn: 12, // оружие на полу появляется снова
  coffeeHeal: 30,
  coffeeBuzz: 5, // секунд «бодрости» после кофе
  coffeeSpeed: 1.25, // во сколько раз быстрее бег под кофеином
  winPause: 7, // сколько висит экран победителя
} as const

// --- Оружие ---

export type Effect =
  | { kind: 'bleed'; seconds: number; dps: number }
  | { kind: 'slow'; seconds: number; factor: number }
  | { kind: 'stun'; seconds: number }
  | { kind: 'disarm'; seconds: number }
  | { kind: 'knockback'; force: number }

export type WeaponId = 'cutter' | 'stapler' | 'mop' | 'lamp' | 'moneygun'

export interface WeaponDef {
  id: WeaponId
  name: string
  type: 'melee' | 'ranged'
  range: number // метры
  damage: number // за попадание (у деньгомёта — за купюру)
  cooldown: number // секунды между атаками
  windup: number // замах перед ударом — видно противнику, можно увернуться
  arc?: number // угол удара в градусах (ближний бой)
  pellets?: number // сколько снарядов за выстрел
  spread?: number // разброс в градусах
  speed?: number // скорость снаряда, м/с
  ammo?: number // патроны; кончились — снова нож
  backstabMultiplier?: number
  effects: Effect[]
  clip: string // анимация атаки из пака KayKit
  animSpeed: number
}

/** Порядок важен: индекс уходит в сеть */
export const WEAPON_IDS: WeaponId[] = ['cutter', 'stapler', 'mop', 'lamp', 'moneygun']

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // всегда с собой: вплотную, сильный урон, кровотечение 10 с, двойной урон в спину
  cutter: {
    id: 'cutter', name: 'Резак', type: 'melee',
    range: 1.0, damage: 22, cooldown: 0.4, windup: 0.08, arc: 80, backstabMultiplier: 2,
    effects: [{ kind: 'bleed', seconds: 10, dps: 2 }],
    clip: '1H_Melee_Attack_Stab', animSpeed: 1.8,
  },
  // дальний бой 10 м: очередь скоб, средний урон, кровотечение 5 с, магазин 12
  stapler: {
    id: 'stapler', name: 'Степлер', type: 'ranged',
    range: 10, damage: 12, cooldown: 0.24, windup: 0, spread: 5, speed: 24, ammo: 12,
    effects: [{ kind: 'bleed', seconds: 5, dps: 1.5 }],
    clip: '1H_Ranged_Shoot', animSpeed: 2.2,
  },
  // ближний бой 2 м: слабый урон, широкий размах, замедляет на 5 с и отталкивает
  mop: {
    id: 'mop', name: 'Швабра', type: 'melee',
    range: 2.0, damage: 7, cooldown: 0.75, windup: 0.18, arc: 150,
    effects: [{ kind: 'slow', seconds: 5, factor: 0.55 }, { kind: 'knockback', force: 9 }],
    clip: '2H_Melee_Attack_Slice', animSpeed: 1.5,
  },
  // вплотную (1 м): сильный удар с заметным замахом, оглушает на 2 с
  lamp: {
    id: 'lamp', name: 'Настольная лампа', type: 'melee',
    range: 1.0, damage: 5, cooldown: 1.2, windup: 0.42, arc: 100,
    effects: [{ kind: 'stun', seconds: 2 }],
    clip: '2H_Melee_Attack_Chop', animSpeed: 1.3,
  },
  // 5 м: веер купюр почти без урона — главное, выбивает оружие из рук на 2 с
  moneygun: {
    id: 'moneygun', name: 'Деньгомёт', type: 'ranged',
    range: 5, damage: 2, cooldown: 0.9, windup: 0, pellets: 7, spread: 32, speed: 15, ammo: 6,
    effects: [{ kind: 'disarm', seconds: 2 }],
    clip: '1H_Ranged_Shoot', animSpeed: 1.6,
  },
}
