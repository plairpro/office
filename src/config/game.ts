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

// Баланс: у каждого одна сильная сторона и одна слабая. «Сила» ≈ живучесть × скорость атаки ≈ 110 у всех,
// а дальше решают скорость бега, уклон, размер и отбрасывание.
export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  // уклонист: мало здоровья, но каждый пятый удар мимо (живучесть ≈ 100)
  accountant: {
    id: 'accountant', name: 'Бухгалтер', blurb: 'Хрупкий, но вёрткий: каждый пятый удар мимо.',
    hp: 80, moveMul: 1.05, attackSpeedMul: 1.1, dodge: 0.2, radius: 0.38, knockbackResist: 0,
  },
  // танк: больше всех здоровья, почти не отлетает, но медленный и крупный
  boss: {
    id: 'boss', name: 'Босс', blurb: 'Самый живучий и почти не отлетает от ударов, но медленный.',
    hp: 130, moveMul: 0.92, attackSpeedMul: 0.85, dodge: 0, radius: 0.48, knockbackResist: 0.7,
  },
  // стеклянная пушка: бьёт быстрее всех, но здоровья меньше всех
  secretary: {
    id: 'secretary', name: 'Секретарь', blurb: 'Печатает 300 знаков в минуту. И бьёт так же — но хрупкий.',
    hp: 75, moveMul: 1.0, attackSpeedMul: 1.45, dodge: 0, radius: 0.4, knockbackResist: 0,
  },
  // бегун: быстрее всех, первым добегает до оружия и кофе; в драке обычный
  courier: {
    id: 'courier', name: 'Стажёр', blurb: 'Бегает по поручениям — быстрее всех добегает до оружия и кофе.',
    hp: 95, moveMul: 1.15, attackSpeedMul: 1.0, dodge: 0, radius: 0.42, knockbackResist: 0,
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
  durability?: number // сколько попаданий выдерживает; сломалось — снова резак
  backstabMultiplier?: number
  effects: Effect[]
  clip: string // анимация атаки из пака Quaternius
  animSpeed: number
}

/** Порядок важен: индекс уходит в сеть */
export const WEAPON_IDS: WeaponId[] = ['cutter', 'stapler', 'mop', 'lamp', 'moneygun']

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // Баланс оружия: чем дальше бьёт и чем сильнее эффект — тем меньше урона в секунду и тем быстрее кончается.
  // Урон/с (без эффектов): резак 45 · степлер 27 · швабра 19 · деньгомёт 16 · лампа 4.
  // Конус: чем мощнее удар, тем точнее надо целиться — резак 70°, лампа 90°, швабра размашистая 140°;
  // у стрелкового — разброс: степлер почти точный (4°), деньгомёт веером (30°, на 5 м — полоса ≈2.7 м).

  // всегда с собой, бесконечный: вплотную, самый большой урон, двойной урон в спину; без эффектов —
  // эффекты только у подобранного оружия (кровь — у степлера)
  cutter: {
    id: 'cutter', name: 'Резак', type: 'melee',
    range: 0.45, damage: 18, cooldown: 0.4, windup: 0.08, arc: 70, backstabMultiplier: 2,
    effects: [],
    clip: 'SwordSlash', animSpeed: 2.6,
  },
  // дальний бой 10 м: очередь скоб, слабее резака, кровотечение 3 с, магазин 12 (≈100 урона на весь)
  stapler: {
    id: 'stapler', name: 'Степлер', type: 'ranged',
    range: 10, damage: 8, cooldown: 0.3, windup: 0, spread: 4, speed: 24, ammo: 12,
    effects: [{ kind: 'bleed', seconds: 3, dps: 1.5 }],
    clip: 'Shoot_OneHanded', animSpeed: 1.8,
  },
  // 2 м: средний урон, широкий размах, замедляет на 3 с и отталкивает; 5 попаданий
  mop: {
    id: 'mop', name: 'Швабра', type: 'melee',
    range: 2.0, damage: 14, cooldown: 0.75, windup: 0.18, arc: 140,
    effects: [{ kind: 'slow', seconds: 3, factor: 0.6 }, { kind: 'knockback', force: 9 }],
    durability: 5,
    clip: 'SwordSlash', animSpeed: 1.5,
  },
  // 1 м: почти без урона, медленная, оглушает на 2 с; 3 попадания
  lamp: {
    id: 'lamp', name: 'Настольная лампа', type: 'melee',
    range: 1.0, damage: 5, cooldown: 1.2, windup: 0.42, arc: 90,
    effects: [{ kind: 'stun', seconds: 2 }],
    durability: 3,
    clip: 'SwordSlash', animSpeed: 0.95,
  },
  // 5 м: веер купюр почти без урона — главное, выбивает оружие из рук на 2 с
  moneygun: {
    id: 'moneygun', name: 'Деньгомёт', type: 'ranged',
    range: 5, damage: 2, cooldown: 0.9, windup: 0, pellets: 7, spread: 30, speed: 15, ammo: 6,
    effects: [{ kind: 'disarm', seconds: 2 }],
    clip: 'Shoot_OneHanded', animSpeed: 0.9,
  },
}
