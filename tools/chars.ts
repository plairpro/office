// Витрина персонажей спереди и сзади — проверять, что убраны ремни, фляги и прочие остатки доспехов
import * as THREE from 'three'
import { loadAssets } from '../src/assets'
import { Avatar } from '../src/game/avatar'
import { CHARACTER_ORDER, PLAYER_COLORS } from '../src/config/game'
await loadAssets(() => {})
const W = 1600, H = 900
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
r.setSize(W, H)
r.toneMapping = THREE.NeutralToneMapping
document.body.appendChild(r.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf4e6d6)
scene.add(new THREE.HemisphereLight(0xffe9e4, 0x9fcfd0, 2.2))
const d = new THREE.DirectionalLight(0xfff0e2, 2.2); d.position.set(2, 5, 6); scene.add(d)
CHARACTER_ORDER.forEach((c, i) => {
  for (const back of [0, 1]) {
    const a = new Avatar('', PLAYER_COLORS[i], c)
    a.showLabel(false)
    a.root.position.set((i - 1.5) * 2.4 + (back ? 0.9 : -0.4), 0, back ? -0.6 : 0)
    a.animate(0.01, 0, back ? Math.PI : 0)
    scene.add(a.root)
  }
})
const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100)
const zoom = new URLSearchParams(location.search).get('zoom')
if (zoom) { cam.position.set(-1.6 * 2.4 + 0.3 + (Number(zoom) - 1) * 2.4, 1.6, 3.2); cam.lookAt(cam.position.x - 0.2, 1.1, 0) } else { cam.position.set(0, 2.2, 10.5); cam.lookAt(0, 0.95, 0) }
r.render(scene, cam)
;(window as unknown as { __done: boolean }).__done = true
