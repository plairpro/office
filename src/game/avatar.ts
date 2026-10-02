import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AABB } from '../scene/builder'
import { GAME, CHARACTERS, type CharacterId } from '../config/game'
import { getAssets } from '../assets'
import { weaponMesh } from './weapons3d'
import type { WeaponId } from '../config/game'

// ======================================================================
// Офисные персонажи — CC0-модели Quaternius «Ultimate Animated Character Pack» (мультяшные, с большой головой):
// настоящая офисная одежда, у каждой вещи свой материал —
// перекрашиваем материалы в пастельную палитру. Цвет игрока — только на аксессуарах.
// ======================================================================

const HEIGHT = 1.85 // рост в метрах после масштабирования
const SKIN = 0xf2c39b
const EYES = 0x2f2d3d

/** 'P' — цвет игрока */
type Paint = Record<string, number | 'P'>
/** shoes — цвет обуви: у моделей ступни и голени из того же материала, что и кожа */
type Look = { paint: Paint; shoes: number; accessories: (rig: Rig, color: number) => void }

const LOOKS: Record<CharacterId, Look> = {
  // Стажёр: оранжевая футболка, джинсы, кепка цвета игрока
  courier: {
    paint: { Shirt: 0xf2a03f, Pants: 0x5f7fae, Belt: 0x4b392d, Hair: 0x5a3a22, Skin: SKIN, Face: EYES },
    shoes: 0xf4f3f7,
    accessories: (rig, color) => { cap(rig, color); badge(rig, color) },
  },
  // Босс: бежевый костюм, белая рубашка, галстук цвета игрока, седина
  boss: {
    paint: { Black: 0xcdb48e, Shirt: 0xfbfaf6, Details: 'P', Belt: 0x6b4430, Hair: 0xc9c4bd, Skin: SKIN, Face: EYES },
    shoes: 0x6b4430,
    accessories: () => {},
  },
  // Бухгалтер: сиреневый кардиган, белая блузка, коричневые брюки, седое каре с чёлкой
  accountant: {
    // халат из пака перекрашен в длинный кардиган, зелёная блузка — в белую
    paint: { Main: 0xb3a8d6, Black: 0xfbfaf6, Brown: 0x6e5257, Hair: 0xe4e2ec, Skin: SKIN, Face: EYES },
    shoes: 0x4b3e48,
    accessories: (rig, color) => badge(rig, color),
  },
  // Секретарь: тёмно-синий костюм, белая блузка, галстук цвета игрока, каштановые волосы
  secretary: {
    paint: { Black: 0x3e3b70, Shirt: 0xfbfaf6, Details: 'P', Belt: 0x2f2d3d, Hair: 0x7a4a2c, Skin: SKIN, Face: EYES },
    shoes: 0x2f2d3d,
    accessories: () => {},
  },
}

/** Какие клипы играть (названия из паков Quaternius) */
const CLIP = { idle: 'Idle', run: 'Run', walk: 'Walk' }
/** Старые названия анимаций (из пака KayKit) → новые */
const LEGACY: Record<string, string> = {
  Hit_A: 'RecieveHit', Hit_B: 'RecieveHit', Dodge_Forward: 'Roll', Death_A: 'Death', Cheer: 'SwordSlash',
  Unarmed_Melee_Attack_Punch_A: 'SwordSlash', '1H_Melee_Attack_Stab': 'SwordSlash', '1H_Ranged_Shoot': 'Shoot_OneHanded',
  '2H_Melee_Attack_Slice': 'SwordSlash', '2H_Melee_Attack_Chop': 'SwordSlash', '1H_Melee_Attack_Chop': 'SwordSlash',
}

function lighten(hex: number, k: number): number {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), k).getHex()
}

/**
 * Обувь: вершины «кожи», которые двигают кости стоп и голеней, красим в цвет обуви (цвет вершин).
 * Геометрия общая у всех копий персонажа — считаем один раз.
 */
function paintShoes(mesh: THREE.SkinnedMesh, shoes: number): void {
  const g = mesh.geometry
  if (g.userData.shoes === shoes) return
  g.userData.shoes = shoes
  const legs = new Set(mesh.skeleton.bones.map((b, i) => (/^(Foot|LowerLeg)/.test(b.name) ? i : -1)).filter((i) => i >= 0))
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight
  const skin = new THREE.Color(SKIN), shoe = new THREE.Color(shoes)
  const col = new Float32Array(si.count * 3)
  for (let i = 0; i < si.count; i++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (legs.has(si.getComponent(i, k))) w += sw.getComponent(i, k)
    ;(w >= 0.5 ? shoe : skin).toArray(col, i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

// ---------- аксессуары ----------

/** Ботинки: у мультяшной модели вместо ступней крошечные кончики, сверху ног не видно — надеваем крупную обувь */
function shoes(rig: Rig, hex: number): void {
  const total = rig.box('Head').max.y // рост модели в её единицах (макушка — верх головы)
  const u = total / 3.27
  const m = mat(hex, rig)
  const sole = mat(0xfbf7f1, rig)
  for (const side of ['L', 'R']) {
    const foot = rig.bone(`Foot.${side}`)
    const g = new THREE.Group()
    const body = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 14, 10), rig), m)
    body.scale.set(0.11 * u, 0.075 * u, 0.19 * u)
    body.position.set(0, 0.07 * u, 0.05 * u)
    const s2 = new THREE.Mesh(geo(new THREE.CylinderGeometry(1, 1, 1, 14), rig), sole)
    s2.scale.set(0.11 * u, 0.025 * u, 0.19 * u)
    s2.position.set(0, 0.015 * u, 0.05 * u)
    g.add(body, s2)
    rig.attach(`Foot.${side}`, g, new THREE.Vector3(foot.x, -0.02 * u, foot.z))
  }
}


interface Rig {
  /** габариты части тела в пространстве модели (поза покоя, до масштабирования) */
  box(part: string): THREE.Box3
  /** мировая точка кости (в стойке, до масштабирования) */
  bone(name: string): THREE.Vector3
  /** крепит объект к кости; position — точка в пространстве модели, объект смотрит вперёд модели */
  attach(boneName: string, o: THREE.Object3D, position: THREE.Vector3): void
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[]
}

const mat = (hex: number, rig: Rig) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75 })
  rig.disposables.push(m)
  return m
}
const geo = <G extends THREE.BufferGeometry>(g: G, rig: Rig): G => { rig.disposables.push(g); return g }


function cap(rig: Rig, color: number): void {
  const b = rig.box('Head')
  const w = (b.max.x - b.min.x) * 0.5
  const m = mat(color, rig)
  const g = new THREE.Group()
  const domeGeo = geo(new THREE.SphereGeometry(w, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), rig)
  domeGeo.scale(1, 0.62, 1.04)
  const dome = new THREE.Mesh(domeGeo, m)
  const brimGeo = geo(new THREE.CylinderGeometry(w * 0.95, w * 0.95, w * 0.06, 24, 1, false, -Math.PI / 2, Math.PI), rig)
  const brim = new THREE.Mesh(brimGeo, m)
  brim.position.set(0, w * 0.02, w * 0.38)
  const button = new THREE.Mesh(geo(new THREE.SphereGeometry(w * 0.08, 8, 6), rig), mat(0xffffff, rig))
  button.position.y = w * 0.62
  g.add(dome, brim, button)
  g.name = 'cap'
  rig.attach('Head', g, new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * 0.8, (b.min.z + b.max.z) / 2))
}


/** Офисный бейдж на шнурке цвета игрока — чтобы в драке отличать своих от чужих */
function badge(rig: Rig, color: number): void {
  const hb = rig.box('Head')
  const h = (hb.max.y - hb.min.y) * 0.6 // масштаб — от головы: тело у мужчин и женщин разное
  const g = new THREE.Group()
  const m = mat(color, rig)
  const card = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.32, h * 0.42, h * 0.03), rig), m)
  card.position.y = -h * 0.45
  const photo = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.14, h * 0.16, h * 0.01), rig), mat(0xfbf7f1, rig))
  photo.position.set(0, -h * 0.39, h * 0.02)
  photo.userData.keep = true
  for (const sx of [-1, 1]) {
    const cord = new THREE.Mesh(geo(new THREE.BoxGeometry(h * 0.03, h * 0.5, h * 0.02), rig), m)
    // от уголков бейджа вверх и в стороны — к шее
    cord.position.set(sx * h * 0.2, -h * 0.05, -h * 0.01)
    cord.rotation.z = -sx * 0.4
    g.add(cord)
  }
  g.add(card, photo)
  g.name = 'badge'
  const neck = rig.bone('Neck')
  const torso = rig.box('Torso')
  rig.attach('Torso', g, new THREE.Vector3(neck.x, neck.y - h * 0.1, torso.max.z + h * 0.02))
}

// ---------- аватар ----------

export class Avatar {
  readonly root = new THREE.Group()
  private model: THREE.Object3D
  private mixer: THREE.AnimationMixer
  private clips: Map<string, THREE.AnimationClip>
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private label: THREE.Sprite
  private ring: THREE.Mesh
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private height = HEIGHT
  private socket = new THREE.Group() // правая рука: сюда вешается оружие (единицы — метры)
  private weaponObj: THREE.Object3D | null = null
  private weaponId: WeaponId | null = null
  private tmpQ = new THREE.Quaternion()
  private tmpQ2 = new THREE.Quaternion()
  private head: THREE.Object3D | null = null
  private mats: THREE.MeshStandardMaterial[] = []
  private flashT = 0
  private flashColor = new THREE.Color()
  private oneShot: THREE.AnimationAction | null = null
  private deathAction: THREE.AnimationAction | null = null
  dead = false
  private headless = false
  readonly skin = SKIN
  headSize = 0.4
  private hpBg: THREE.Sprite
  private hpFg: THREE.Sprite

  constructor(name: string, private color: number, readonly character: CharacterId, _look = 0) {
    const look = LOOKS[character]
    const a = getAssets()
    this.clips = a.clips[character]
    this.model = SkeletonUtils.clone(a.chars[character].scene)

    // перекраска: у каждой вещи свой материал — красим материал целиком
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.frustumCulled = false // кости двигают вершины за пределы исходных габаритов
      const src = o.material as THREE.MeshStandardMaterial
      let m = cache.get(src.name)
      if (!m) {
        m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, flatShading: true })
        const c = look.paint[src.name]
        if (c === 'P') { m.color.setHex(lighten(color, 0.1)); m.userData.player = true }
        else if (c !== undefined) m.color.setHex(c)
        else m.color.copy(src.color).convertLinearToSRGB().lerp(new THREE.Color(0xffffff), 0.25).convertSRGBToLinear()
        m.name = src.name
        this.disposables.push(m)
        cache.set(src.name, m)
      }
      o.material = m
      if (src.name === 'Skin' && o instanceof THREE.SkinnedMesh) {
        paintShoes(o, look.shoes)
        m.vertexColors = true
        m.color.setHex(0xffffff)
      }
    })

    // анимации; аксессуары и оружие крепим в стойке (а не в исходной Т-позе) — так они сидят как надо
    this.mixer = new THREE.AnimationMixer(this.model)
    for (const [key, clipName] of Object.entries(CLIP)) {
      const clip = this.clips.get(clipName)
      if (clip) this.actions.set(key, this.mixer.clipAction(clip))
    }
    this.play('idle', 0)
    this.tick(0.4)
    const model = this.model
    model.updateMatrixWorld(true)
    const tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3()
    const rig: Rig = {
      box: (part) => {
        // меш из нескольких материалов — это группа «Suit_Head» с кусками внутри
        const box = new THREE.Box3()
        model.traverse((o) => {
          if (!(o instanceof THREE.SkinnedMesh) || !(o.name.endsWith(part) || o.parent?.name.endsWith(part))) return
          o.computeBoundingBox() // по скиннутым вершинам в текущей позе
          box.union(o.boundingBox!.clone().applyMatrix4(o.matrixWorld))
        })
        if (!box.isEmpty()) return box
        // одна сетка на всё тело — берём вершины, которые двигает одноимённая кость (голова и всё, что на ней)
        const v = new THREE.Vector3()
        model.traverse((o) => {
          if (!(o instanceof THREE.SkinnedMesh)) return
          const bi = o.skeleton.bones.findIndex((b) => b.name === part)
          if (bi < 0) return
          const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight
          for (let i = 0; i < si.count; i++) {
            let w = 0
            for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k)
            if (w < 0.5) continue
            o.getVertexPosition(i, v)
            box.expandByPoint(v.applyMatrix4(o.matrixWorld))
          }
        })
        return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.1, 1.5, -0.1), new THREE.Vector3(0.1, 1.8, 0.2)) : box
      },
      bone: (boneName) => {
        const bone = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(boneName))
        return bone ? bone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()
      },
      attach: (boneName, o, pos) => {
        // GLTFLoader убирает точки из имён: Wrist.R → WristR
        const bone = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(boneName))
        if (!bone) return
        o.traverse((x) => { if (x instanceof THREE.Mesh) x.castShadow = true })
        bone.matrixWorld.decompose(tv, tq, ts)
        o.quaternion.copy(tq).invert()
        o.scale.divide(ts)
        o.position.copy(bone.worldToLocal(pos.clone()))
        bone.add(o)
      },
      disposables: this.disposables,
    }
    look.accessories(rig, color)
    shoes(rig, look.shoes)
    // гнездо для оружия: в кулаке правой руки, оси — как у модели в стойке (вперёд = +Z)
    // центр кулака (кость кисти начинается у запястья — оружие висело бы на запястье)
    const fist = rig.box('FistR')
    const grip = fist.isEmpty() ? rig.bone('Fist.R') : fist.getCenter(new THREE.Vector3())
    rig.attach('Fist.R', this.socket, grip)
    this.head = model.getObjectByName('Head') ?? null

    // масштаб под рост и опора на пол
    const box = new THREE.Box3().setFromObject(this.model)
    const k = HEIGHT / Math.max(box.max.y - box.min.y, 0.1)
    this.model.scale.setScalar(k)
    this.model.position.y = -box.min.y * k
    this.socket.scale.multiplyScalar(1 / k)
    const hb = rig.box('Head')
    this.headSize = Math.max(hb.max.y - hb.min.y, hb.max.x - hb.min.x) * k
    cache.forEach((m) => this.mats.push(m))

    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot) {
        // плавно возвращаемся в стойку прямо из разовой анимации: если сначала погасить её, а потом
        // проявлять стойку, веса на миг дают меньше 1 и персонаж разводит руки в исходную «Т-позу»
        const prev = this.oneShot
        this.oneShot = null
        const idle = this.actions.get('idle')
        if (idle && !this.dead) {
          idle.reset().setEffectiveWeight(1).play()
          idle.crossFadeFrom(prev, 0.15, false)
          this.current = idle
        } else prev.fadeOut(0.15)
      }
    })

    this.root.add(this.model)
    this.play('idle', 0)
    this.tick(0) // сразу встаём в стойку, без кадра в исходной позе

    // мягкая тень под ногами: солнце в офисе закрыто потолком, поэтому контактная тень рисуется отдельно
    const r = CHARACTERS[character].radius
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 4, r * 3.4),
      new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x2f2d55, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    // чуть сдвинута от солнца — читается как настоящая тень
    this.ring.position.set(0.12, 0.03, 0.16)
    this.ring.renderOrder = 2
    this.root.add(this.ring)

    this.label = makeLabel(name, color)
    this.label.position.y = this.height + 0.5
    this.root.add(this.label)

    // полоска здоровья над головой: скруглённая и полупрозрачная, как в углу экрана
    this.hpCanvas.width = 128
    this.hpCanvas.height = 16
    this.hpTex = new THREE.CanvasTexture(this.hpCanvas)
    this.hpTex.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hpTex, depthTest: false, transparent: true }))
    sp.renderOrder = 11
    sp.position.y = this.height + 0.22
    sp.scale.set(0.9, 0.1125, 1)
    this.root.add(sp)
    this.hpBg = this.hpFg = sp
    this.hpBg.visible = false
  }

  private hpCanvas = document.createElement('canvas')
  private hpTex: THREE.CanvasTexture
  private hpDrawn = -1

  private drawHp(f: number): void {
    const g = this.hpCanvas.getContext('2d')!
    const W = 128, H = 16, r = H / 2
    g.clearRect(0, 0, W, H)
    g.fillStyle = 'rgba(255, 255, 255, 0.4)'
    g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill()
    if (f > 0) {
      const grad = g.createLinearGradient(0, 0, W, 0)
      grad.addColorStop(0, 'rgba(211, 18, 42, 0.72)')
      grad.addColorStop(1, 'rgba(233, 64, 90, 0.72)')
      g.fillStyle = grad
      g.beginPath(); g.roundRect(0, 0, Math.max(H, W * f), H, r); g.fill()
    }
    this.hpTex.needsUpdate = true
  }

  /** Подпись с именем над головой (в меню прячем) */
  showLabel(v: boolean): void { this.label.visible = v }

  /** Здоровье 0..1 над головой; null — скрыть */
  /** Значки состояния над головой: 💫 оглушён, 🩸 кровоточит, 🐌 замедлен (биты как у флагов сети) */
  private statusSprite: THREE.Sprite | null = null
  private statusBits = 0
  setStatus(bits: number, time: number): void {
    if (bits !== this.statusBits) {
      this.statusBits = bits
      const icons = [[2, '💫'], [8, '🩸'], [16, '🐌']].filter(([b]) => bits & (b as number)).map(([, e]) => e as string)
      if (this.statusSprite) {
        this.root.remove(this.statusSprite)
        this.statusSprite.material.map?.dispose()
        this.statusSprite.material.dispose()
        this.statusSprite = null
      }
      if (icons.length) {
        const c = document.createElement('canvas')
        c.width = 64 * icons.length; c.height = 64
        const g = c.getContext('2d')!
        g.font = '48px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
        g.textAlign = 'center'; g.textBaseline = 'middle'
        icons.forEach((e, i) => g.fillText(e, 32 + i * 64, 36))
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.SRGBColorSpace
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }))
        sp.renderOrder = 12
        sp.scale.set(0.42 * icons.length, 0.42, 1)
        this.statusSprite = sp
        this.root.add(sp)
      }
    }
    // покачиваются над головой; при оглушении — кружатся
    if (this.statusSprite) {
      this.statusSprite.position.set(bits & 2 ? Math.sin(time * 6) * 0.12 : 0, this.height + 0.85 + Math.sin(time * 4) * 0.04, bits & 2 ? Math.cos(time * 6) * 0.12 : 0)
    }
  }

  setHp(frac: number | null): void {
    const show = frac !== null && !this.dead
    this.hpBg.visible = this.hpFg.visible = show && frac > 0
    if (!show || frac <= 0) return
    const f = Math.min(1, frac)
    const q = Math.round(f * 100)
    if (q !== this.hpDrawn) { this.hpDrawn = q; this.drawHp(f) }
  }

  private play(key: string, fade = 0.2): void {
    const next = this.actions.get(key)
    if (!next || next === this.current) return
    next.reset().play()
    if (this.current) next.crossFadeFrom(this.current, fade, true)
    // без предыдущей анимации сразу полный вес: проявление «из нуля» смешивается с исходной Т-позой (руки в стороны)
    else next.setEffectiveWeight(1)
    this.current = next
  }

  /** Шаг анимации */
  private tick(dt: number): void {
    this.mixer.update(dt)

  }

  /** Разовая анимация поверх бега: удар, выстрел, получение урона */
  action(clipName: string, speed = 1): void {
    if (this.dead) return
    const clip = this.clips.get(LEGACY[clipName] ?? clipName)
    if (!clip) return
    const a = this.mixer.clipAction(clip)
    a.reset()
    a.setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = false
    a.timeScale = speed
    a.setEffectiveWeight(1)
    a.play()
    if (this.current) { a.crossFadeFrom(this.current, 0.05, false); this.current = null }
    else a.fadeIn(0.05)
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.05)
    this.oneShot = a
  }

  /** Оружие в правой руке */
  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return
    this.weaponId = id
    if (this.weaponObj) {
      this.socket.remove(this.weaponObj)
      this.weaponObj.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
      })
    }
    this.weaponObj = weaponMesh(id)
    // оружие чуть крупнее настоящего, чтобы читалось сверху
    this.weaponObj.scale.setScalar(id === 'mop' ? 1.1 : id === 'lamp' ? 1.6 : 2)
    this.socket.add(this.weaponObj)
  }

  /** Вспышка при попадании */
  flash(hex = 0xff2a3d): void {
    this.flashT = 0.18
    this.flashColor.setHex(hex)
  }

  /** Мигание при неуязвимости после респа */
  blink(visible: boolean): void {
    this.model.visible = visible
  }

  /** Смерть: анимация падения, голова отлетает отдельно — возвращает её мировую позицию */
  die(withHead = true): THREE.Vector3 | null {
    if (this.dead) return null
    this.dead = true
    this.oneShot?.fadeOut(0.05)
    this.oneShot = null
    this.current?.fadeOut(0.1)
    this.current = null
    const clip = this.clips.get('Death')
    if (clip) {
      this.deathAction = this.mixer.clipAction(clip)
      this.deathAction.reset()
      this.deathAction.setLoop(THREE.LoopOnce, 1)
      this.deathAction.clampWhenFinished = true
      this.deathAction.timeScale = 1.4
      this.deathAction.fadeIn(0.05).play()
    }
    this.hpBg.visible = this.hpFg.visible = false
    if (!withHead || !this.head) return null
    this.model.updateMatrixWorld(true)
    const p = new THREE.Vector3()
    this.head.getWorldPosition(p)
    this.severed = this.bakeHead(p)
    this.head.scale.setScalar(0.001) // вместе с головой исчезают кепка и причёска
    this.headless = true
    return p
  }

  /** Отрубленная голова — копия настоящей головы модели (лицо, причёска, кепка), снята в момент смерти */
  severed: THREE.Group | null = null

  /** Запекает текущую позу головы в статичную сетку, центр — точка p (основание головы) */
  private bakeHead(p: THREE.Vector3): THREE.Group {
    const g = new THREE.Group()
    const head = this.head!
    const v = new THREE.Vector3()
    this.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return
      const bi = o.skeleton.bones.indexOf(head as THREE.Bone)
      if (bi < 0) return
      const geo = o.geometry, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, idx = geo.index
      const onHead = (i: number) => { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k); return w >= 0.5 }
      const pos: number[] = [], col: number[] = []
      const ca = geo.attributes.color
      const n = idx ? idx.count : si.count
      for (let t = 0; t < n; t += 3) {
        const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k))
        if (!ids.every(onHead)) continue
        for (const i of ids) {
          o.getVertexPosition(i, v)
          v.applyMatrix4(o.matrixWorld).sub(p)
          pos.push(v.x, v.y, v.z)
          if (ca) col.push(ca.getX(i), ca.getY(i), ca.getZ(i))
        }
      }
      if (!pos.length) return
      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      if (col.length) bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      bg.computeVertexNormals()
      g.add(new THREE.Mesh(bg, (o.material as THREE.Material).clone()))
    })
    // кепка и прочее, что висит на кости головы
    for (const c of head.children) {
      if (c instanceof THREE.Bone) continue
      const copy = c.clone(true)
      c.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale)
      copy.position.sub(p)
      g.add(copy)
    }
    // срез шеи
    const r = this.headSize * 0.18
    const cut = new THREE.Mesh(new THREE.CircleGeometry(r, 12), new THREE.MeshBasicMaterial({ color: 0xa80d22 }))
    cut.rotation.x = Math.PI / 2
    g.add(cut)
    g.traverse((o) => { o.castShadow = true })
    return g
  }

  /** Точка шеи — для фонтана */
  neck(): THREE.Vector3 | null {
    if (!this.head) return null
    const p = new THREE.Vector3()
    this.head.getWorldPosition(p)
    return p
  }

  revive(): void {
    this.dead = false
    this.deathAction?.stop()
    this.deathAction = null
    this.headless = false
    this.head?.scale.setScalar(1)
    this.ring.visible = true
    this.model.visible = true
    this.mixer.stopAllAction()
    this.oneShot = null
    this.current = null
    // появляемся сразу в стойке: плавное проявление из нуля показывало бы руки в стороны (исходная поза модели)
    this.play('idle', 0)
    this.actions.get('idle')?.setEffectiveWeight(1)
    this.tick(0)
  }

  /** Цвет игрока зависит от порядка входа — при смене пересобираем перекраску */
  setColor(hex: number): void {
    if (hex === this.color) return
    this.color = hex
    // одежда от цвета игрока не зависит — перекрашиваем только аксессуары
    for (const m of this.mats) if (m.userData.player) m.color.setHex(lighten(hex, 0.1))
    this.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) && o instanceof THREE.Mesh && /cap|tie|badge/.test(o.parent?.name ?? '') && !o.userData.keep) {
        (o.material as THREE.MeshStandardMaterial).color.setHex(hex)
      }
    })
  }

  setName(name: string, color: number): void {
    this.root.remove(this.label)
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
    this.label = makeLabel(name, color)
    this.label.position.y = this.height + 0.5
    this.root.add(this.label)
  }

  /** speed — текущая скорость (м/с), facing — угол взгляда */
  animate(dt: number, speed: number, facing: number): void {
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt)
      const f = (this.flashT / 0.18) * 0.9
      for (const m of this.mats) m.emissive.copy(this.flashColor).multiplyScalar(f)
    }
    if (this.dead) {
      this.tick(dt)
      // анимация смерти каждый кадр возвращает кости масштаб 1 — голову прячем после неё
      if (this.headless) this.head?.scale.setScalar(0.001)
      return
    }
    this.model.rotation.y = facing
    const k = speed / GAME.player.speed
    if (this.oneShot) { /* удар/выстрел доигрывает поверх */ }
    else if (k > 0.55) this.play('run')
    else if (k > 0.12) this.play('walk')
    else this.play('idle')
    const run = this.actions.get('run')
    if (run && this.current === run) run.timeScale = 0.75 + k * 0.45
    this.tick(dt)
    // степлер и деньгомёт всегда смотрят туда же, куда персонаж — так понятно, куда полетит
    if (this.weaponObj && (this.weaponId === 'stapler' || this.weaponId === 'moneygun' || this.weaponId === 'lamp')) {
      this.socket.updateWorldMatrix(true, false)
      this.socket.getWorldQuaternion(this.tmpQ).invert()
      this.model.getWorldQuaternion(this.tmpQ2)
      this.weaponObj.quaternion.multiplyQuaternions(this.tmpQ, this.tmpQ2)
    } else if (this.weaponObj) this.weaponObj.quaternion.identity()
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.weaponObj?.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
    this.disposables.forEach((d) => d.dispose())
    this.hpBg.material.dispose()
    this.hpTex.dispose()
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
    ;(this.label.material as THREE.SpriteMaterial).map?.dispose()
    this.label.material.dispose()
  }
}

function makeLabel(text: string, color: number): THREE.Sprite {
  // без плашки: тонкий белый текст с мягкой тенью и цветная точка игрока с отступом
  const S = 2 // запас по разрешению — чтобы тонкий шрифт не мылился
  const canvas = document.createElement('canvas')
  canvas.width = 256 * S
  canvas.height = 48 * S
  const ctx = canvas.getContext('2d')!
  ctx.scale(S, S)
  ctx.font = '600 22px system-ui, -apple-system, "Segoe UI", sans-serif'
  const tw = Math.min(ctx.measureText(text).width, 200)
  const dot = 7, gap = 9
  const x0 = (256 - (tw + dot * 2 + gap)) / 2
  ctx.shadowColor = 'rgba(30, 25, 55, 0.9)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1.5
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.beginPath()
  ctx.arc(x0 + dot, 24, dot - 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // тонкая тёмная обводка + тень: белый текст читается и на светлом полу
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(40, 34, 70, 0.45)'
  ctx.strokeText(text, x0 + dot * 2 + gap, 25, 200)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x0 + dot * 2 + gap, 25, 200)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  // на телефоне экран маленький — подписи крупнее
  const k = window.matchMedia('(pointer: coarse)').matches ? 1.3 : 1
  sprite.scale.set(1.9 * k, 0.36 * k, 1)
  sprite.renderOrder = 10
  return sprite
}

// ---------- движение и столкновения ----------

export interface Body {
  x: number
  z: number
  vx: number
  vz: number
}

/** Двигает тело к желаемому направлению с ускорением и выталкивает из препятствий */
export function stepBody(
  b: Body, dirX: number, dirZ: number, dt: number,
  colliders: AABB[], speedMul = 1, radius: number = GAME.player.radius,
): void {
  const { speed, accel } = GAME.player
  const len = Math.hypot(dirX, dirZ)
  const tx = len > 0 ? (dirX / len) * speed * speedMul : 0
  const tz = len > 0 ? (dirZ / len) * speed * speedMul : 0
  const k = 1 - Math.exp(-accel * dt / speed)
  b.vx += (tx - b.vx) * k
  b.vz += (tz - b.vz) * k

  // шагаем частями, чтобы не проскакивать тонкие стены
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vz) * dt) / (radius * 0.5)))
  for (let s = 0; s < steps; s++) {
    b.x += (b.vx * dt) / steps
    b.z += (b.vz * dt) / steps
    for (const c of colliders) resolveCircleAABB(b, c, radius)
  }
}

function resolveCircleAABB(b: Body, c: AABB, r: number): void {
  const dx = b.x - c.x
  const dz = b.z - c.z
  const px = Math.max(-c.hw, Math.min(c.hw, dx))
  const pz = Math.max(-c.hd, Math.min(c.hd, dz))
  let ox = dx - px
  let oz = dz - pz
  const d2 = ox * ox + oz * oz
  if (d2 >= r * r) return
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    const push = r - d
    ox /= d
    oz /= d
    b.x += ox * push
    b.z += oz * push
    // гасим скорость в стену, оставляем скольжение вдоль
    const vn = b.vx * ox + b.vz * oz
    if (vn < 0) {
      b.vx -= vn * ox
      b.vz -= vn * oz
    }
  } else {
    // центр внутри прямоугольника — выталкиваем по ближайшей оси
    const ex = c.hw - Math.abs(dx) + r
    const ez = c.hd - Math.abs(dz) + r
    if (ex < ez) b.x += Math.sign(dx || 1) * ex
    else b.z += Math.sign(dz || 1) * ez
  }
}

let blobTex: THREE.Texture | null = null
/** Круглое мягкое пятно: тёмный центр, прозрачный край */
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 31)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.45, 'rgba(255,255,255,0.75)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}
