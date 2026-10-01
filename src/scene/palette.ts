/**
 * Палитра в духе Monument Valley: нежные пыльные тона, тени — индиго, а не серые.
 * Единственный по-настоящему насыщенный цвет в игре — кровь (RED). На этом контрасте всё и держится.
 */
export const MV = {
  cream: 0xf4e6d6,
  creamLight: 0xfbf3ea,
  blush: 0xf2b9b3,
  coral: 0xe9877a,
  peach: 0xf6c49d,
  mustard: 0xf0c26c,
  mint: 0xa9dfcf,
  teal: 0x5fb3aa,
  tealDeep: 0x3f8f8c,
  sky: 0xbcd9ee,
  lilac: 0xc8b5e6,
  lavender: 0x9d8fd0,
  plum: 0x7c5a8c,
  indigo: 0x4d4a7d,
  indigoDeep: 0x2f2d55,
  white: 0xfdf8f2,
} as const

/** Кровь — намеренно вне палитры */
export const RED = 0xd3122a

/** Палитра для цветокоррекции атласов: всё сводится к этим тонам */
export const GRADE_PALETTE: number[] = [
  MV.cream, MV.creamLight, MV.blush, MV.coral, MV.peach, MV.mustard, MV.mint, MV.teal,
  MV.sky, MV.lilac, MV.lavender, MV.plum, MV.indigo, MV.white,
]
