import * as THREE from 'three'
import {
  CHARACTERS, MATCH, WEAPONS, WEAPON_IDS,
  type CharacterId, type WeaponId, type WeaponDef,
} from '../config/game'
import type { Office, PickupSpot } from '../scene/office'
import { blocksShots, type AABB } from '../scene/builder'
import { MV } from '../scene/palette'
import { Avatar, stepBody, type Body } from './avatar'
import { Fx } from './fx'
import { weaponMesh, projectileMesh } from './weapons3d'
import { sfx, type SoundName } from './sfx'
import {
  F_BLEED, F_DEAD, F_INVULN, F_SLOW, F_STUN,
  type AtkMsg, type DieMsg, type HurtMsg, type PickMsg, type StatePacket,
} from '../net/room'

/**
 * Бой. Сеть без сервера, поэтому попадания считает тот, В КОГО попали:
 * атакующий рассылает «замахнулся/выстрелил», каждый у себя проверяет, задело ли его,
 * и рассылает «мне попали» / «я умер». Так никто не спорит о своём здоровье,
 * а честность для игры с коллегами нам не критична.
 */

export type FighterKind = 'local' | 'remote' | 'dummy'

export interface Fighter {
  id: string
  name: string
  character: CharacterId
  color: number
  kind: FighterKind
  avatar: Avatar
  body: Body
  facing: number
  hp: number
  maxHp: number
  weapon: WeaponId
  ammo: number // -1 — без счёта
  dead: boolean
  kills: number
  // чужие: куда тянем
  target: Body
  lastAt: number
  flags: number
  // свои и манекены: таймеры
  cooldown: number
  respawnIn: number
  invuln: number
  bleed: number
  bleedDps: number
  bleedBy: string
  bleedAcc: number
  slow: number
  slowFactor: number
  stun: number
  disarm: number
  dripAcc: number
  lastBy: string
  lastW: WeaponId
  turnIn: number // манекены иногда поворачиваются
  buzz: number // бодрость после кофе
  home: { x: number; z: number; f: number }
}

export interface Controls {
  move: { x: number; z: number }
  aim: number | null // угол взгляда от мыши
  attack: boolean
  autoAim: boolean // телефон: целимся в ближайшего
}

export interface NetSink {
  atk(m: AtkMsg): void
  hurt(m: HurtMsg): void
  die(m: DieMsg): void
  pick(m: PickMsg): void
}

export interface MatchHooks {
  onKill(killer: Fighter | null, victim: Fighter, weapon: WeaponId): void
  onLocalHurt(amount: number): void
  onLocalDeath(killer: Fighter | null): void
  onLocalRespawn(): void
  onShake(power: number): void
  onWin(winner: Fighter): void
  onRoundReset(): void
  onPickup(kind: PickupSpot['kind']): void
}

interface Projectile {
  mesh: THREE.Object3D
  x: number; z: number; vx: number; vz: number
  left: number
  owner: string
  w: WeaponId
}

interface PendingMelee { t: number; by: string; w: WeaponId; a: number }

interface Pickup { spot: PickupSpot; mesh: THREE.Group; ring: THREE.Sprite; extras: THREE.Object3D[]; respawnIn: number }

const DEG = Math.PI / 180
const SHOT_Y = 1.15
const HIT_SOUND: Record<WeaponId, SoundName> = { cutter: 'hitCut', stapler: 'hitStaple', mop: 'hitBroom', lamp: 'hitLamp', moneygun: 'hitMoney' }

export class Match {
  readonly fighters = new Map<string, Fighter>()
  local: Fighter | null = null
  readonly fx: Fx
  round = 0
  winIn = 0 // > 0 — висит экран победителя
  private projectiles: Projectile[] = []
  private pending: PendingMelee[] = []
  private pickups: Pickup[] = []
  private shotWalls: AABB[]
  private projTemplates: Record<'staple' | 'bill', THREE.Mesh>
  private time = 0

  constructor(
    private scene: THREE.Scene,
    private office: Office,
    private hooks: MatchHooks,
    private net: NetSink | null,
  ) {
    this.fx = new Fx(scene, office.colliders)
    this.shotWalls = office.colliders.filter(blocksShots)
    this.projTemplates = { staple: projectileMesh('staple'), bill: projectileMesh('bill') }
    for (const spot of office.pickups) {
      const mesh = new THREE.Group()
      const item = weaponMesh(spot.kind)
      item.scale.setScalar(spot.kind === 'coffee' ? 2.2 : spot.kind === 'mop' ? 1 : 2)
      item.position.y = 0.75
      if (spot.kind === 'mop') { item.rotation.x = -0.9; item.position.set(0, 0.4, -0.5) }
      mesh.add(item)
      // свечение вокруг предмета вместо кольца на полу
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: spot.kind === 'coffee' ? 0x9ff0d0 : 0xffe29a,
        transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      ring.userData.size = spot.kind === 'mop' ? 1.5 : 1.1
      ring.position.set(0, spot.kind === 'mop' ? 0.45 : 0.78, spot.kind === 'mop' ? 0.1 : 0)
      mesh.add(ring)
      const extras: THREE.Object3D[] = []
      if (spot.kind === 'coffee') {
        // пар над стаканом и парящий «+»: сразу понятно, что это лечит
        for (let i = 0; i < 4; i++) {
          const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false, opacity: 0.7 }))
          puff.userData.phase = i / 4
          mesh.add(puff)
          extras.push(puff)
        }
        const plus = new THREE.Sprite(new THREE.SpriteMaterial({ map: plusTexture(), transparent: true, depthTest: false }))
        plus.scale.set(0.42, 0.42, 1)
        plus.renderOrder = 12
        plus.userData.plus = true
        mesh.add(plus)
        extras.push(plus)
      }
      mesh.position.set(spot.x, 0, spot.z)
      scene.add(mesh)
      this.pickups.push({ spot, mesh, ring, extras, respawnIn: 0 })
    }
  }

  // ---------- участники ----------

  private makeFighter(id: string, name: string, character: CharacterId, color: number, kind: FighterKind, x: number, z: number, f: number): Fighter {
    const avatar = new Avatar(name, color, character)
    avatar.root.position.set(x, 0, z)
    avatar.setWeapon('cutter')
    this.scene.add(avatar.root)
    const hp = CHARACTERS[character].hp
    const fighter: Fighter = {
      id, name, character, color, kind, avatar,
      body: { x, z, vx: 0, vz: 0 }, facing: f, hp, maxHp: hp,
      weapon: 'cutter', ammo: -1, dead: false, kills: 0,
      target: { x, z, vx: 0, vz: 0 }, lastAt: performance.now(), flags: 0,
      cooldown: 0, respawnIn: 0, invuln: kind === 'local' ? MATCH.spawnProtect : 0,
      bleed: 0, bleedDps: 0, bleedBy: '', bleedAcc: 0, slow: 0, slowFactor: 1, stun: 0, disarm: 0, dripAcc: 0,
      lastBy: '', lastW: 'cutter', buzz: 0, turnIn: 2 + Math.random() * 3, home: { x, z, f },
    }
    this.fighters.set(id, fighter)
    return fighter
  }

  addLocal(id: string, name: string, character: CharacterId, color: number, spawn: number): Fighter {
    const sp = this.office.spawns[spawn % this.office.spawns.length]
    this.local = this.makeFighter(id, name, character, color, 'local', sp.x, sp.z, sp.rot)
    return this.local
  }

  addRemote(id: string, name: string, character: CharacterId, color: number, spawn: number): Fighter {
    const sp = this.office.spawns[spawn % this.office.spawns.length]
    return this.makeFighter(id, name, character, color, 'remote', sp.x, sp.z, sp.rot)
  }

  /** Манекены для тренировки в одиночку — стоят у кулера, поворачиваются, умирают как настоящие */
  addDummies(): void {
    const spots: [number, number, CharacterId][] = [[0, -1.9, 'boss'], [-2.3, 0.3, 'secretary'], [2.3, 0.3, 'accountant'], [-6.6, -7.6, 'courier']]
    spots.forEach(([x, z, c], i) => this.makeFighter(`dummy${i}`, 'Манекен', c, MV.lavender, 'dummy', x, z, Math.random() * 6))
  }

  removeDummies(): void {
    for (const f of [...this.fighters.values()]) if (f.kind === 'dummy') this.remove(f.id)
  }

  remove(id: string): void {
    const f = this.fighters.get(id)
    if (!f) return
    this.scene.remove(f.avatar.root)
    f.avatar.dispose()
    this.fighters.delete(id)
    if (f === this.local) this.local = null
  }

  restyle(id: string, name: string, color: number): void {
    const f = this.fighters.get(id)
    if (!f) return
    f.name = name
    if (f.color !== color) { f.color = color; f.avatar.setColor(color) }
    f.avatar.setName(name, color)
  }

  /** Переставить своего на нужный лифт (когда узнали свой номер в комнате) */
  moveLocalToSpawn(slot: number): void {
    const f = this.local
    if (!f) return
    const sp = this.office.spawns[slot % this.office.spawns.length]
    f.body.x = sp.x; f.body.z = sp.z; f.facing = sp.rot
  }

  dispose(): void {
    for (const id of [...this.fighters.keys()]) this.remove(id)
    for (const p of this.projectiles) this.scene.remove(p.mesh)
    for (const p of this.pickups) this.scene.remove(p.mesh)
    this.fx.clearDecals()
    this.fx.dispose()
  }

  // ---------- кадр ----------

  update(dt: number, ctl: Controls): void {
    this.time += dt
    const me = this.local
    if (me) this.updateLocal(me, dt, ctl)
    for (const f of this.fighters.values()) {
      if (f.kind === 'remote') this.updateRemote(f, dt)
      else if (f.kind === 'dummy') this.updateDummy(f, dt)
    }
    this.updatePending(dt)
    this.updateProjectiles(dt)
    this.updatePickups(dt)
    this.updateWin(dt)
    this.fx.update(dt)
  }

  private updateLocal(f: Fighter, dt: number, ctl: Controls): void {
    const ch = CHARACTERS[f.character]
    if (f.dead) {
      f.respawnIn -= dt
      f.avatar.animate(dt, 0, f.facing)
      if (f.respawnIn <= 0 && this.winIn <= 0) this.respawn(f)
      return
    }
    this.tickEffects(f, dt)
    if (f.dead) return

    const stunned = f.stun > 0
    const mul = ch.moveMul * (f.slow > 0 ? f.slowFactor : 1) * (f.buzz > 0 ? MATCH.coffeeSpeed : 1)
    stepBody(f.body, stunned ? 0 : ctl.move.x, stunned ? 0 : ctl.move.z, dt, this.office.colliders, mul, ch.radius)
    const speed = Math.hypot(f.body.vx, f.body.vz)

    if (!stunned) {
      if (ctl.autoAim) {
        const t = this.autoTarget(f)
        if (t) f.facing = Math.atan2(t.body.x - f.body.x, t.body.z - f.body.z)
        else if (speed > 0.5) f.facing = Math.atan2(f.body.vx, f.body.vz)
      } else if (ctl.aim !== null) f.facing = ctl.aim
      else if (speed > 0.5) f.facing = Math.atan2(f.body.vx, f.body.vz)
    }

    // атака
    f.cooldown -= dt
    if (ctl.attack && f.cooldown <= 0 && !stunned && f.disarm <= 0 && this.winIn <= 0) {
      const w = WEAPONS[f.weapon]
      f.cooldown = w.cooldown / ch.attackSpeedMul
      const seed = (Math.random() * 2 ** 31) | 0
      const r2 = (n: number) => Math.round(n * 100) / 100
      const m: AtkMsg = { w: WEAPON_IDS.indexOf(w.id), x: r2(f.body.x), z: r2(f.body.z), a: r2(f.facing), s: seed }
      this.startAttack(f, m)
      this.net?.atk(m)
      if (w.id === 'lamp') this.hooks.onShake(0.15)
      if (f.ammo > 0 && --f.ammo === 0) { this.equip(f, 'cutter'); sfx.play('empty') }
    }

    f.avatar.root.position.set(f.body.x, 0, f.body.z)
    f.avatar.animate(dt, speed, f.facing)
    f.avatar.blink(f.invuln <= 0 || Math.floor(this.time * 12) % 2 === 0)
    f.avatar.setHp(null)
  }

  private updateRemote(f: Fighter, dt: number): void {
    const now = performance.now()
    const age = Math.min((now - f.lastAt) / 1000, 0.25)
    const px = f.target.x + f.target.vx * age
    const pz = f.target.z + f.target.vz * age
    const k = 1 - Math.exp(-14 * dt)
    f.body.x += (px - f.body.x) * k
    f.body.z += (pz - f.body.z) * k
    f.avatar.root.position.set(f.body.x, 0, f.body.z)
    const speed = age < 0.25 && !(f.flags & F_STUN) ? Math.hypot(f.target.vx, f.target.vz) : 0
    const prev = f.avatar.root.userData.f ?? f.facing
    const face = lerpAngle(prev, f.facing, k)
    f.avatar.root.userData.f = face
    f.avatar.animate(dt, speed, face)
    f.avatar.blink(!(f.flags & F_INVULN) || Math.floor(this.time * 12) % 2 === 0)
    f.avatar.setHp(f.dead ? null : f.hp / f.maxHp)
    if (f.flags & F_BLEED && !f.dead) {
      f.dripAcc += dt
      if (f.dripAcc > 0.18) { f.dripAcc = 0; this.fx.drip(f.body.x, f.body.z) }
    }
  }

  private updateDummy(f: Fighter, dt: number): void {
    if (f.dead) {
      f.respawnIn -= dt
      f.avatar.animate(dt, 0, f.facing)
      if (f.respawnIn <= 0) {
        f.dead = false
        f.hp = f.maxHp
        f.bleed = f.slow = f.stun = 0
        f.body.x = f.home.x; f.body.z = f.home.z
        f.avatar.revive()
      }
      return
    }
    this.tickEffects(f, dt)
    if (f.dead) return
    // манекен стоит, но его можно отпихнуть шваброй
    stepBody(f.body, 0, 0, dt, this.office.colliders, 1, CHARACTERS[f.character].radius)
    f.turnIn -= dt
    if (f.turnIn <= 0 && f.stun <= 0) { f.turnIn = 2 + Math.random() * 4; f.home.f = Math.random() * Math.PI * 2 }
    f.facing = lerpAngle(f.facing, f.home.f, 1 - Math.exp(-3 * dt))
    f.avatar.root.position.set(f.body.x, 0, f.body.z)
    f.avatar.animate(dt, Math.hypot(f.body.vx, f.body.vz), f.facing)
    f.avatar.setHp(f.hp / f.maxHp)
  }

  /** Кровотечение, замедление, оглушение, обезоруживание, неуязвимость */
  private tickEffects(f: Fighter, dt: number): void {
    f.invuln = Math.max(0, f.invuln - dt)
    f.slow = Math.max(0, f.slow - dt)
    f.buzz = Math.max(0, f.buzz - dt)
    f.stun = Math.max(0, f.stun - dt)
    f.disarm = Math.max(0, f.disarm - dt)
    if (f.bleed > 0) {
      f.bleed -= dt
      f.bleedAcc += dt
      f.dripAcc += dt
      if (f.dripAcc > 0.18) { f.dripAcc = 0; this.fx.drip(f.body.x, f.body.z) }
      if (f.bleedAcc >= 0.5) {
        const n = f.bleedDps * f.bleedAcc
        f.bleedAcc = 0
        f.hp -= n
        if (f.hp <= 0) this.kill(f, f.bleedBy, f.lastW, 0, 0)
      }
    }
  }

  private autoTarget(f: Fighter): Fighter | null {
    const w = WEAPONS[f.weapon]
    let best: Fighter | null = null, bestD = w.range + 3
    for (const o of this.fighters.values()) {
      if (o === f || o.dead) continue
      const d = Math.hypot(o.body.x - f.body.x, o.body.z - f.body.z)
      if (d < bestD && this.los(f.body.x, f.body.z, o.body.x, o.body.z)) { best = o; bestD = d }
    }
    return best
  }

  // ---------- атаки ----------

  /** Начало атаки — у атакующего и у всех, кто получил сообщение */
  private startAttack(f: Fighter, m: AtkMsg): void {
    const w = WEAPONS[WEAPON_IDS[m.w] ?? 'cutter']
    const asm = CHARACTERS[f.character].attackSpeedMul
    f.avatar.action(w.clip, w.animSpeed * asm)
    if (f.kind !== 'local') f.facing = m.a
    sfx.play(w.id === 'stapler' ? 'staple' : w.id === 'moneygun' ? 'money' : w.id === 'lamp' || w.id === 'mop' ? 'swingHeavy' : 'swing', m.x, m.z)
    if (w.type === 'ranged') {
      const rng = mulberry32(m.s)
      const n = w.pellets ?? 1
      for (let i = 0; i < n; i++) {
        const a = m.a + (rng() - 0.5) * (w.spread ?? 0) * DEG
        const sp = (w.speed ?? 20) * (0.9 + rng() * 0.2)
        const kind = w.id === 'moneygun' ? 'bill' : 'staple'
        const mesh = this.projTemplates[kind].clone()
        const sx = m.x + Math.sin(m.a) * 0.45, sz = m.z + Math.cos(m.a) * 0.45
        mesh.position.set(sx, SHOT_Y, sz)
        mesh.rotation.y = a
        this.scene.add(mesh)
        this.projectiles.push({ mesh, x: sx, z: sz, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, left: w.range, owner: f.id, w: w.id })
      }
    } else {
      this.pending.push({ t: w.windup / asm, by: f.id, w: w.id, a: m.a })
    }
  }

  private updatePending(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      p.t -= dt
      if (p.t > 0) continue
      this.pending.splice(i, 1)
      const by = this.fighters.get(p.by)
      if (!by || by.dead) continue
      const w = WEAPONS[p.w]
      // засчитываем только себе (и манекенам, если бьём мы)
      for (const v of this.victimsOf(by)) {
        const r = this.meleeCheck(by.body.x, by.body.z, p.a, w, v)
        if (r) this.receiveHit(v, w, by.id, r.dx, r.dz, r.back)
      }
    }
  }

  /** Кого этот атакующий может задеть с точки зрения нашего клиента */
  private *victimsOf(by: Fighter): Generator<Fighter> {
    for (const v of this.fighters.values()) {
      if (v === by || v.dead) continue
      if (v.kind === 'local' || (v.kind === 'dummy' && by.kind === 'local')) yield v
    }
  }

  private meleeCheck(ax: number, az: number, a: number, w: WeaponDef, v: Fighter): { dx: number; dz: number; back: boolean } | null {
    const r = CHARACTERS[v.character].radius
    const dx = v.body.x - ax, dz = v.body.z - az
    const d = Math.hypot(dx, dz)
    if (d > w.range + r + 0.3) return null // +0.3 — запас на задержку сети
    const ang = Math.atan2(dx, dz)
    const diff = Math.abs(wrap(ang - a))
    if (d > r + 0.35 && diff > ((w.arc ?? 90) / 2) * DEG + Math.atan2(r, d)) return null
    if (!this.los(ax, az, v.body.x, v.body.z)) return null
    const nx = d > 1e-3 ? dx / d : Math.sin(a), nz = d > 1e-3 ? dz / d : Math.cos(a)
    // удар в спину: жертва смотрит туда же, куда летит удар
    const back = Math.sin(v.facing) * nx + Math.cos(v.facing) * nz > 0.45
    return { dx: nx, dz: nz, back }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const step = Math.min(Math.hypot(p.vx, p.vz) * dt, p.left)
      const sp = Math.hypot(p.vx, p.vz)
      const ex = p.x + (p.vx / sp) * step, ez = p.z + (p.vz / sp) * step
      let hitT = 1
      for (const c of this.shotWalls) {
        const t = segAABB(p.x, p.z, ex, ez, c)
        if (t !== null && t < hitT) hitT = t
      }
      // кого задели раньше стены
      let victim: Fighter | null = null
      for (const v of this.fighters.values()) {
        if (v.id === p.owner || v.dead) continue
        const t = segCircle(p.x, p.z, ex, ez, v.body.x, v.body.z, CHARACTERS[v.character].radius + 0.08)
        if (t !== null && t <= hitT) { hitT = t; victim = v }
      }
      const owner = this.fighters.get(p.owner)
      if (victim) {
        const local = victim.kind === 'local' || (victim.kind === 'dummy' && owner?.kind === 'local')
        if (local && victim.invuln <= 0) {
          const d = Math.hypot(p.vx, p.vz)
          this.receiveHit(victim, WEAPONS[p.w], p.owner, p.vx / d, p.vz / d, false)
        }
        this.killProjectile(i)
        continue
      }
      if (hitT < 1) {
        this.killProjectile(i)
        continue
      }
      p.x = ex; p.z = ez
      p.left -= step
      p.mesh.position.set(p.x, SHOT_Y - (1 - p.left / WEAPONS[p.w].range) * 0.25, p.z)
      if (p.w === 'moneygun') { p.mesh.rotation.x += dt * 9; p.mesh.rotation.z += dt * 6 }
      if (p.left <= 0) this.killProjectile(i)
    }
  }

  private killProjectile(i: number): void {
    this.scene.remove(this.projectiles[i].mesh)
    this.projectiles.splice(i, 1)
  }

  // ---------- урон (считаем только для своего бойца и своих манекенов) ----------

  private receiveHit(v: Fighter, w: WeaponDef, byId: string, dx: number, dz: number, back: boolean): void {
    if (v.dead || v.invuln > 0) return
    const ch = CHARACTERS[v.character]
    const wIdx = WEAPON_IDS.indexOf(w.id)
    if (ch.dodge && Math.random() < ch.dodge) {
      this.fx.floatText('Уклон!', v.body.x, 2.2, v.body.z, '#4fb3a9')
      v.avatar.action('Dodge_Forward', 2)
      sfx.play('dodge', v.body.x, v.body.z)
      if (v.kind === 'local') this.net?.hurt({ n: 0, dx, dz, w: wIdx, k: 1, by: byId })
      return
    }
    const mult = back && w.backstabMultiplier ? w.backstabMultiplier : 1
    const n = Math.round(w.damage * mult)
    v.hp -= n
    v.lastBy = byId
    v.lastW = w.id
    for (const e of w.effects) {
      if (e.kind === 'bleed') { v.bleed = Math.max(v.bleed, e.seconds); v.bleedDps = e.dps; v.bleedBy = byId }
      else if (e.kind === 'slow') { v.slow = e.seconds; v.slowFactor = e.factor }
      else if (e.kind === 'stun') v.stun = e.seconds
      else if (e.kind === 'disarm') {
        if (v.disarm <= 0 && v.kind === 'local') this.fx.floatText('Обезоружен!', v.body.x, 2.5, v.body.z, '#9d8fd0')
        v.disarm = e.seconds
      } else if (e.kind === 'knockback') {
        const k = e.force * (1 - ch.knockbackResist)
        v.body.vx += dx * k; v.body.vz += dz * k
      }
    }
    this.hitFx(v, n, dx, dz, back ? 2 : 0, w.id)
    if (v.kind === 'local') {
      this.net?.hurt({ n, dx: round2(dx), dz: round2(dz), w: wIdx, k: back ? 2 : 0, by: byId })
      this.hooks.onLocalHurt(n)
      this.hooks.onShake(Math.min(0.5, 0.12 + n / 80))
    }
    if (v.hp <= 0) this.kill(v, byId, w.id, dx, dz)
  }

  /** Брызги, вспышка, цифра урона — одинаково у всех */
  private hitFx(v: Fighter, n: number, dx: number, dz: number, k: number, w: WeaponId): void {
    const heavy = w === 'lamp' ? 1.8 : w === 'moneygun' ? 0.5 : 1
    this.fx.hit(v.body.x, 1.2, v.body.z, dx, dz, heavy * (k === 2 ? 1.8 : 1))
    v.avatar.flash()
    sfx.play(HIT_SOUND[w], v.body.x, v.body.z)
    if (w === 'lamp' || k === 2) v.avatar.action('Hit_A', 1.6)
    const txt = k === 2 ? `В спину! ${n}` : String(n)
    this.fx.floatText(txt, v.body.x + (Math.random() - 0.5) * 0.4, 2.3, v.body.z, k === 2 ? '#d3122a' : '#7c5a8c')
    if (w === 'lamp') this.fx.floatText('★ ★ ★', v.body.x, 2.05, v.body.z, '#f0c26c')
  }

  /** Смерть своего бойца или манекена */
  private kill(v: Fighter, byId: string, w: WeaponId, dx: number, dz: number): void {
    if (v.dead) return
    v.hp = 0
    v.dead = true
    v.respawnIn = MATCH.respawnDelay
    v.bleed = v.slow = v.stun = v.disarm = 0
    const hv: [number, number, number] = [round2(dx * 3 + (Math.random() - 0.5) * 2), round2(5 + Math.random() * 2), round2(dz * 3 + (Math.random() - 0.5) * 2)]
    this.deathFx(v, byId, w, hv)
    if (v.kind === 'local') {
      this.net?.die({ by: byId, w: WEAPON_IDS.indexOf(w), hv })
      this.hooks.onLocalDeath(this.fighters.get(byId) ?? null)
      this.hooks.onShake(0.6)
    }
  }

  /** Как умирают в «Офисной ярости»: голова отдельно, фонтан, лужа на весь матч */
  private deathFx(v: Fighter, byId: string, w: WeaponId, hv: [number, number, number]): void {
    v.dead = true
    v.hp = 0
    const gore = this.fx.gore
    const head = v.avatar.die(gore)
    this.fx.burst(v.body.x, 1.1, v.body.z, gore ? 1 : 0.6)
    if (head && gore) {
      this.fx.gib(this.headGib(v), head.x, head.y, head.z, hv[0], hv[1], hv[2])
      const av = v.avatar
      this.fx.fountain(() => (av.dead ? av.neck() : null), 1.8)
    }
    // убийце — очко (у себя считаем сразу, остальным он сам разошлёт счёт)
    const killer = this.fighters.get(byId) ?? null
    if (killer && killer !== v) killer.kills++
    sfx.play('death', v.body.x, v.body.z)
    if (killer && killer.kind === 'local' && killer !== v) setTimeout(() => sfx.play('kill'), 250)
    this.hooks.onKill(killer && killer !== v ? killer : null, v, w)
  }

  private headGib(v: Fighter): THREE.Group {
    const s = v.avatar.headSize
    const g = new THREE.Group()
    const skin = new THREE.Mesh(new THREE.SphereGeometry(s * 0.42, 14, 10), new THREE.MeshStandardMaterial({ color: v.avatar.skin, roughness: 0.7 }))
    skin.scale.set(1, 0.92, 1)
    g.add(skin)
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({ color: MV.plum, roughness: 0.8 }),
    )
    hair.position.y = s * 0.04
    g.add(hair)
    const neck = new THREE.Mesh(new THREE.CircleGeometry(s * 0.22, 12), new THREE.MeshBasicMaterial({ color: 0xa80d22 }))
    neck.rotation.x = Math.PI / 2
    neck.position.y = -s * 0.37
    g.add(neck)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0x2f2d55 }))
      eye.position.set(sx * s * 0.14, s * 0.02, s * 0.38)
      g.add(eye)
    }
    g.traverse((o) => { o.castShadow = true })
    return g
  }

  private respawn(f: Fighter): void {
    // лифт подальше от живых соперников
    let best = this.office.spawns[0], bestScore = -1
    for (const sp of this.office.spawns) {
      let near = Infinity
      for (const o of this.fighters.values()) {
        if (o !== f && !o.dead && o.kind !== 'dummy') near = Math.min(near, Math.hypot(o.body.x - sp.x, o.body.z - sp.z))
      }
      const score = near + Math.random() * 3
      if (score > bestScore) { bestScore = score; best = sp }
    }
    f.body = { x: best.x, z: best.z, vx: 0, vz: 0 }
    f.facing = best.rot
    f.dead = false
    f.hp = f.maxHp
    f.invuln = MATCH.spawnProtect
    f.cooldown = 0.3
    f.bleed = f.slow = f.stun = f.disarm = f.buzz = 0
    this.equip(f, 'cutter')
    f.avatar.revive()
    sfx.play('respawn')
    this.hooks.onLocalRespawn()
  }

  private equip(f: Fighter, id: WeaponId): void {
    f.weapon = id
    f.ammo = WEAPONS[id].ammo ?? -1
    f.avatar.setWeapon(id)
  }

  // ---------- предметы на полу ----------

  private updatePickups(dt: number): void {
    const me = this.local
    this.pickups.forEach((p, i) => {
      if (p.respawnIn > 0) {
        p.respawnIn -= dt
        p.mesh.visible = p.respawnIn <= 0
        return
      }
      const item = p.mesh.children[0]
      item.rotation.y += dt * 1.6
      item.position.y = (p.spot.kind === 'mop' ? 0.4 : 0.75) + Math.sin(this.time * 2.5 + i) * 0.08
      // свечение мягко дышит
      const pulse = p.ring.userData.size * (1 + Math.sin(this.time * 4 + i) * 0.1)
      p.ring.scale.set(pulse, pulse, 1)
      p.ring.position.y = item.position.y + (p.spot.kind === 'mop' ? 0.05 : 0.03)
      for (const e of p.extras) {
        if (e.userData.plus) { e.position.y = 1.55 + Math.sin(this.time * 3 + i) * 0.06; continue }
        const t = (this.time * 0.6 + e.userData.phase) % 1
        e.position.set(Math.sin(t * 9 + i) * 0.06, 1.0 + t * 0.7, 0)
        const sc = 0.12 + t * 0.22
        e.scale.set(sc, sc, 1)
        ;(e as THREE.Sprite).material.opacity = 0.65 * (1 - t)
      }
      if (!me || me.dead || Math.hypot(me.body.x - p.spot.x, me.body.z - p.spot.z) > 1.0) return
      const k = p.spot.kind
      if (k === 'coffee') {
        // кофе берётся всегда: лечит, останавливает кровь и бодрит
        const healed = Math.min(me.maxHp, me.hp + MATCH.coffeeHeal) - me.hp
        me.hp += healed
        me.bleed = 0
        me.buzz = MATCH.coffeeBuzz
        this.fx.floatText(healed > 0 ? `+${Math.round(healed)} ☕` : 'Бодрость! ☕', me.body.x, 2.3, me.body.z, '#2f9e6a')
      } else {
        if (me.weapon === k && (me.ammo < 0 || me.ammo === WEAPONS[k].ammo)) return
        this.equip(me, k)
        this.fx.floatText(WEAPONS[k].name, me.body.x, 2.3, me.body.z, '#4d4a7d')
      }
      sfx.play(k === 'coffee' ? 'coffee' : 'pickup')
      this.take(i)
      this.net?.pick({ i })
      this.hooks.onPickup(k)
    })
  }

  private take(i: number): void {
    const p = this.pickups[i]
    if (!p) return
    p.respawnIn = MATCH.pickupRespawn
    p.mesh.visible = false
  }

  // ---------- победа и новый раунд ----------

  private updateWin(dt: number): void {
    if (this.winIn > 0) {
      this.winIn -= dt
      if (this.winIn <= 0) this.newRound(this.round + 1)
      return
    }
    for (const f of this.fighters.values()) {
      if (f.kind !== 'dummy' && f.kills >= MATCH.killsToWin) {
        this.winIn = MATCH.winPause
        sfx.play('win')
        this.hooks.onWin(f)
        return
      }
    }
  }

  private newRound(round: number): void {
    this.round = round
    this.winIn = 0
    for (const f of this.fighters.values()) f.kills = 0
    this.fx.clearDecals()
    for (const p of this.pickups) { p.respawnIn = 0; p.mesh.visible = true }
    const me = this.local
    if (me) {
      if (me.dead) me.respawnIn = 0.01
      else { me.dead = true; this.respawn(me) }
    }
    this.hooks.onRoundReset()
  }

  // ---------- сеть ----------

  stateOf(): StatePacket | null {
    const f = this.local
    if (!f) return null
    const flags = (f.dead ? F_DEAD : 0) | (f.stun > 0 ? F_STUN : 0) | (f.invuln > 0 ? F_INVULN : 0) | (f.bleed > 0 ? F_BLEED : 0) | (f.slow > 0 ? F_SLOW : 0)
    return [round2(f.body.x), round2(f.body.z), round2(f.facing), round2(f.body.vx), round2(f.body.vz),
      WEAPON_IDS.indexOf(f.weapon), flags, Math.max(0, Math.round(f.hp)), f.kills, this.round]
  }

  onState(id: string, s: StatePacket): void {
    const f = this.fighters.get(id)
    if (!f) return
    const [x, z, facing, vx, vz, w, flags, hp, kills, round] = s
    if (round > this.round) this.newRound(round)
    const jump = Math.hypot(x - f.body.x, z - f.body.z) > 4
    f.target = { x, z, vx, vz }
    if (jump) { f.body.x = x; f.body.z = z }
    f.facing = facing
    f.lastAt = performance.now()
    f.flags = flags
    f.hp = hp
    if (round === this.round) f.kills = kills
    const wid = WEAPON_IDS[w]
    if (wid && wid !== f.weapon) { f.weapon = wid; f.avatar.setWeapon(wid) }
    const dead = !!(flags & F_DEAD)
    if (dead && !f.dead) { f.dead = true; f.avatar.die(false) } // пропустили сообщение о смерти
    else if (!dead && f.dead) { f.dead = false; f.body.x = x; f.body.z = z; f.avatar.revive() }
  }

  onAtk(id: string, m: AtkMsg): void {
    const f = this.fighters.get(id)
    if (!f || f.dead) return
    this.startAttack(f, m)
  }

  onHurt(id: string, m: HurtMsg): void {
    const v = this.fighters.get(id)
    if (!v || v.dead) return
    const w = WEAPON_IDS[m.w] ?? 'cutter'
    if (m.k === 1) {
      this.fx.floatText('Уклон!', v.body.x, 2.2, v.body.z, '#4fb3a9')
      v.avatar.action('Dodge_Forward', 2)
      sfx.play('dodge', v.body.x, v.body.z)
      return
    }
    v.hp = Math.max(0, v.hp - m.n)
    this.hitFx(v, m.n, m.dx, m.dz, m.k, w)
    if (m.by === this.local?.id) this.hooks.onShake(0.08) // «попал!» — лёгкая отдача у атакующего
  }

  onDie(id: string, m: DieMsg): void {
    const v = this.fighters.get(id)
    if (!v || v.dead) return
    this.deathFx(v, m.by, WEAPON_IDS[m.w] ?? 'cutter', m.hv)
  }

  onPick(_id: string, m: PickMsg): void {
    this.take(m.i)
  }

  // ---------- геометрия ----------

  private los(ax: number, az: number, bx: number, bz: number): boolean {
    for (const c of this.shotWalls) if (segAABB(ax, az, bx, bz, c) !== null) return false
    return true
  }
}

// ---------- вспомогательное ----------

function round2(n: number): number { return Math.round(n * 100) / 100 }

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * t
}

/** Детерминированный ГСЧ: разброс дроби одинаков у всех игроков */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Отрезок против прямоугольника: доля пути до входа или null */
function segAABB(ax: number, az: number, bx: number, bz: number, c: AABB): number | null {
  const dx = bx - ax, dz = bz - az
  let t0 = 0, t1 = 1
  const axes: [number, number, number, number][] = [[ax, dx, c.x - c.hw, c.x + c.hw], [az, dz, c.z - c.hd, c.z + c.hd]]
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return null; continue }
    let ta = (lo - p) / d, tb = (hi - p) / d
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb)
    if (t0 > t1) return null
  }
  return t0
}

/** Отрезок против круга: доля пути до касания или null */
function segCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): number | null {
  const dx = bx - ax, dz = bz - az
  const fx = ax - cx, fz = az - cz
  const a = dx * dx + dz * dz
  const c = fx * fx + fz * fz - r * r
  if (c <= 0) return 0
  if (a < 1e-12) return null
  const b = 2 * (fx * dx + fz * dz)
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  return t >= 0 && t <= 1 ? t : null
}


// ---------- текстуры для кофе ----------

let puffTex: THREE.Texture | null = null
function puffTexture(): THREE.Texture {
  if (puffTex) return puffTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  gr.addColorStop(0, 'rgba(255,255,255,0.95)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  puffTex = new THREE.CanvasTexture(c)
  return puffTex
}

let plusTex: THREE.Texture | null = null
function plusTexture(): THREE.Texture {
  if (plusTex) return plusTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,250,246,0.95)'
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#2fae7a'
  g.fillRect(52, 26, 24, 76)
  g.fillRect(26, 52, 76, 24)
  plusTex = new THREE.CanvasTexture(c)
  plusTex.colorSpace = THREE.SRGBColorSpace
  return plusTex
}

let glowTex: THREE.Texture | null = null
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62)
  gr.addColorStop(0, 'rgba(255,255,255,0.9)')
  gr.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}
