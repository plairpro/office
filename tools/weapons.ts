// Витрина оружия: npm run dev → /tools/weapons.html (крутится, чтобы видеть со всех сторон)
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { weaponMesh, projectileMesh } from '../src/game/weapons3d'

const r = new THREE.WebGLRenderer({ antialias: true })
r.setPixelRatio(Math.min(devicePixelRatio, 2))
r.setSize(innerWidth, innerHeight)
r.toneMapping = THREE.NeutralToneMapping
document.body.appendChild(r.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf4e6d6)
scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.5
scene.add(new THREE.HemisphereLight(0xffe9e4, 0x9fcfd0, 1.6))
const sun = new THREE.DirectionalLight(0xfff0e2, 2.4)
sun.position.set(2, 4, 3)
scene.add(sun)
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50)
cam.position.set(0, 1.6, 4.4)
cam.lookAt(0, 0.1, 0)

const items: [string, number, number, number][] = [['cutter', -1.2, 0.45, 3.2], ['stapler', 0, 0.45, 2.6], ['moneygun', 1.2, 0.45, 2.6], ['lamp', -1.0, -0.35, 1.6], ['coffee', 0.15, -0.35, 1.8]]
const spin: THREE.Object3D[] = []
for (const [id, x, y, s] of items) {
  const g = weaponMesh(id as 'cutter')
  g.scale.setScalar(s)
  g.position.set(x, y, 0)
  scene.add(g)
  spin.push(g)
}
const mop = weaponMesh('mop')
mop.scale.setScalar(0.85)
mop.rotation.x = -0.35
mop.position.set(1.15, -0.55, -0.6)
scene.add(mop)
spin.push(mop)
const st = projectileMesh('staple'); st.position.set(-0.4, -0.6, 0.6); st.scale.setScalar(1.5); scene.add(st)
const bill = projectileMesh('bill'); bill.position.set(0.4, -0.6, 0.6); bill.scale.setScalar(1.5); scene.add(bill)

const angle = Number(new URLSearchParams(location.search).get('a') ?? NaN)
function loop(t: number): void {
  for (const o of spin) o.rotation.y = Number.isFinite(angle) ? angle : t / 1500
  r.render(scene, cam)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
