import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export type Quality = 'low' | 'medium' | 'high'

const PRESETS: Record<Quality, { pixelRatio: number; shadow: number; post: boolean; ao: boolean }> = {
  low: { pixelRatio: 1, shadow: 1024, post: false, ao: false },
  medium: { pixelRatio: 1.5, shadow: 2048, post: true, ao: false },
  high: { pixelRatio: 2, shadow: 4096, post: true, ao: true },
}

export function autoQuality(): Quality {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return coarse ? 'low' : 'high'
}

/**
 * Рендер: PBR + освещение от окружения, солнце через окна с мягкими тенями,
 * невидимый потолок (только отбрасывает тень — свет попадает в офис лишь через окна),
 * пост-обработка: GTAO (затенение в углах), bloom (свечение экранов и окон), SMAA.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  private composer: EffectComposer | null = null
  private gtao: GTAOPass | null = null
  private quality: Quality = 'high'

  constructor(host: HTMLElement, private camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = 0.95
    host.appendChild(r.domElement)
    this.renderer = r

    const scene = this.scene
    scene.background = new THREE.Color(0xd9dcef)
    scene.fog = new THREE.Fog(0xd9dcef, 45, 80)

    // мягкий свет «комнаты» — даёт объём и отражения на PBR-материалах
    const pmrem = new THREE.PMREMGenerator(r)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.42
    pmrem.dispose()

    scene.add(new THREE.HemisphereLight(0xf4f0ff, 0xd8c8c0, 0.35))

    // солнце: светит снаружи через окна северной стены
    const sun = new THREE.DirectionalLight(0xffe2c8, 4.0)
    sun.position.copy(sunDir).multiplyScalar(45)
    sun.castShadow = true
    const sc = sun.shadow.camera
    sc.left = -30; sc.right = 30; sc.top = 26; sc.bottom = -26
    sc.near = 5; sc.far = 100
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 1.2
    scene.add(sun, sun.target)
    this.sun = sun

    // невидимый потолок: в кадре его нет, но он отбрасывает тень
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(41, 0.2, 31),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    )
    ceiling.position.y = 3.3
    ceiling.castShadow = true
    scene.add(ceiling)
  }

  setQuality(q: Quality): void {
    this.quality = q
    const p = PRESETS[q]
    const r = this.renderer
    r.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio))
    this.sun.shadow.mapSize.set(p.shadow, p.shadow)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget
    this.composer?.dispose()
    this.composer = null
    this.gtao = null
    if (p.post) {
      const w = window.innerWidth, h = window.innerHeight
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType })
      const c = new EffectComposer(r, rt)
      c.addPass(new RenderPass(this.scene, this.camera))
      if (p.ao) {
        const gtao = new GTAOPass(this.scene, this.camera, w, h)
        gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1 })
        gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 })
        gtao.blendIntensity = 0.9
        c.addPass(gtao)
        this.gtao = gtao
      }
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 1.5))
      c.addPass(new OutputPass())
      c.addPass(new SMAAPass())
      this.composer = c
    }
    this.resize()
  }

  getQuality(): Quality { return this.quality }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h)
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
    this.gtao?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio())
  }

  render(): void {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }
}
