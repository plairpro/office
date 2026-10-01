import * as THREE from 'three'

/**
 * Общий стиль: toon-освещение с мягкими ступенями и контурная обводка.
 * Ступени не резкие (4 тона) — пастельный «мультфильм», а не комикс.
 */
let ramp: THREE.DataTexture | null = null

export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp
  const tones = [178, 214, 240, 255]
  const data = new Uint8Array(tones)
  ramp = new THREE.DataTexture(data, tones.length, 1, THREE.RedFormat)
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

export function toon(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params })
}

/** Материал обводки: вершины выдавливаются по нормали, рисуется только изнанка */
export function outlineMaterial(color = 0x3d3557, thickness = 0.014): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, thickness: { value: thickness } },
    vertexShader: /* glsl */ `
      uniform float thickness;
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }`,
    side: THREE.BackSide,
  })
}

/** Добавляет обводку всем мешам объекта (кроме помеченных noOutline) */
export function addOutlines(root: THREE.Object3D, mat: THREE.Material): void {
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.noOutline && !o.userData.isOutline) meshes.push(o)
  })
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, mat)
    o.userData.isOutline = true
    o.castShadow = false
    o.receiveShadow = false
    m.add(o)
  }
}
