// Офисные персонажи из CC0-пака Quaternius «Ultimate Animated Character Pack» (quaternius.com) — мультяшные, с большой головой.
// Берём 4 модели, выкидываем пистолеты и ненужные анимации, сжимаем meshopt.
// Запуск: node tools/build-office-chars.mjs <папка с распакованными паками>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, resample, meshopt, weld, quantize } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import path from 'node:path'

const SRC = process.argv[2] ?? '/tmp/claude-0/pk'
const DIR = path.join(SRC, 'Ultimate Animated Character Pack - Nov 2019/glTF')
const CHARS = {
  boss: path.join(DIR, 'Suit_Male.gltf'),
  courier: path.join(DIR, 'Casual_Male.gltf'),
  accountant: path.join(DIR, 'OldClassy_Female.gltf'),
  secretary: path.join(DIR, 'Suit_Female.gltf'),
}
const KEEP = new Set(['Idle', 'Run', 'Walk', 'SwordSlash', 'Shoot_OneHanded', 'RecieveHit', 'Death', 'Roll'])
// скелет одинаковый у всех — анимации храним только в файле босса
const ANIMS_FROM = { boss: true, accountant: false, courier: false, secretary: false }
// вещи, которые офису не нужны: цилиндр у бухгалтерши
const DROP_MATERIALS = /^Hat$/
const DROP_NODES = /pistol|gun|sword|knife|axe|shield/i

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
for (const [id, file] of Object.entries(CHARS)) {
  const doc = await io.read(file)
  const root = doc.getRoot()
  for (const a of root.listAnimations()) if (!KEEP.has(a.getName()) || !ANIMS_FROM[id]) {
    for (const s of a.listSamplers()) s.dispose()
    for (const c of a.listChannels()) c.dispose()
    a.dispose()
  }
  for (const n of root.listNodes()) if (DROP_NODES.test(n.getName())) { n.getMesh()?.dispose(); n.dispose() }
  // морф-цели (мимика) не нужны и весят больше всей модели
  for (const m of root.listMeshes()) { m.setWeights([]); for (const pr of m.listPrimitives()) {
    for (const t of pr.listTargets()) { pr.removeTarget(t); t.dispose() }
    if (DROP_MATERIALS.test(pr.getMaterial()?.getName() ?? '')) { m.removePrimitive(pr); pr.dispose(); continue }
    // текстур нет — UV не нужны; нормали пересчитает плоское затенение
    for (const sem of ['TEXCOORD_0', 'TEXCOORD_1', 'NORMAL', 'COLOR_0']) pr.getAttribute(sem)?.dispose()
  } }
  await doc.transform(weld(), dedup(), resample(), prune(), quantize({ quantizeNormal: 8, quantizeWeight: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = path.resolve('src/assets', `office_${id}.glb`)
  await io.write(out, doc)
  console.log(id, out, root.listAnimations().map((a) => a.getName()).join(','))
}
