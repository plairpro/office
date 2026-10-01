// Сборка игровых ассетов из CC0-паков KayKit (Kay Lousberg, kaylousberg.com).
// Каждый пак склеивается в один .glb с общей текстурой-атласом, модели — отдельные узлы по имени.
// Персонажи: меши без анимаций + один общий файл анимаций (скелет у всех одинаковый).
//
// Запуск: node tools/build-assets.mjs <папка с клонами паков>

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, meshopt, resample, mergeDocuments, unpartition } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'

const SRC = process.argv[2] ?? '/tmp/claude-0'
const OUT = path.resolve('src/assets')
fs.mkdirSync(OUT, { recursive: true })

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

const PACKS = {
  furniture: {
    dir: 'kk-furniture/addons/kaykit_furniture_bits/Assets/gltf',
    models: [
      'armchair', 'armchair_pillows', 'book_set', 'book_single', 'cabinet_medium', 'cabinet_medium_decorated',
      'cabinet_small', 'cabinet_small_decorated', 'cactus_medium_A', 'cactus_medium_B', 'cactus_small_A', 'cactus_small_B',
      'chair_A', 'chair_B', 'chair_C', 'chair_stool', 'couch', 'couch_pillows', 'lamp_standing', 'lamp_table',
      'pictureframe_large_A', 'pictureframe_large_B', 'pictureframe_medium', 'pictureframe_small_A',
      'pictureframe_standing_A', 'pillow_A', 'pillow_B', 'rug_oval_A', 'rug_oval_B', 'rug_rectangle_A', 'rug_rectangle_B',
      'rug_rectangle_stripes_A', 'rug_rectangle_stripes_B', 'shelf_A_big', 'shelf_A_small', 'shelf_B_large',
      'shelf_B_large_decorated', 'shelf_B_small', 'shelf_B_small_decorated', 'table_low', 'table_medium',
      'table_medium_long', 'table_small',
    ],
  },
  kitchen: {
    dir: 'KayKit-Restaurant-Bits-1.0/addons/kaykit_restaurant_bits/Assets/gltf',
    models: [
      'wall', 'wall_decorated', 'wall_doorway', 'wall_half', 'wall_window_closed', 'wall_window_open', 'door_A', 'door_B',
      'pillar_A', 'pillar_B', 'floor_kitchen', 'floor_kitchen_small',
      'fridge_A', 'fridge_A_decorated', 'fridge_B', 'kitchencabinet', 'kitchencabinet_half',
      'kitchencounter_straight_A', 'kitchencounter_straight_A_backsplash', 'kitchencounter_straight_A_decorated',
      'kitchencounter_straight_B', 'kitchencounter_sink', 'kitchencounter_sink_backsplash',
      'kitchencounter_innercorner', 'kitchencounter_outercorner', 'kitchentable_A', 'kitchentable_A_large',
      'kitchentable_A_large_decorated', 'kitchentable_B_large', 'table_round_A', 'table_round_A_decorated',
      'table_round_A_small', 'table_round_B', 'chair_A', 'chair_B', 'chair_stool', 'extractorhood', 'oven',
      'shelf_papertowel_decorated', 'papertowel', 'jar_A_medium', 'jar_B_medium', 'jar_C_small', 'plate', 'bowl',
      'food_burger', 'food_dinner', 'ketchup', 'mustard', 'crate', 'crate_lid', 'pan_A', 'pot_A', 'menu', 'towelrail',
      'stove_multi', 'dishrack_plates',
    ],
  },
  proto: {
    dir: 'KayKit-Prototype-Bits-1.0/addons/kaykit_prototype_bits/Assets/gltf',
    models: [
      'Box_A', 'Box_B', 'Box_C', 'Barrel_A', 'Can_A', 'Can_B', 'Pallet_Small_Decorated_A', 'Pallet_Small_Decorated_B',
      'Dummy_Base', 'target_stand_A', 'Pillar_A', 'Pillar_B',
    ],
  },
}

async function buildPack(name, { dir, models }) {
  const base = path.join(SRC, dir)
  let doc = null
  for (const m of models) {
    const file = path.join(base, `${m}.gltf`)
    if (!fs.existsSync(file)) { console.warn(`  нет ${m}`); continue }
    const d = await io.read(file)
    // корневые узлы модели собираем под один узел с именем модели
    const scene = d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0]
    const holder = d.createNode(m)
    for (const n of scene.listChildren()) { scene.removeChild(n); holder.addChild(n) }
    scene.addChild(holder)
    if (!doc) { doc = d; continue }
    const map = mergeDocuments(doc, d)
    // переносим узел из чужой сцены в нашу
    const otherScene = map.get(scene)
    const myScene = doc.getRoot().listScenes()[0]
    for (const n of otherScene.listChildren()) { otherScene.removeChild(n); myScene.addChild(n) }
    otherScene.dispose()
  }
  await doc.transform(unpartition(), dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = path.join(OUT, `${name}.glb`)
  await io.write(out, doc)
  console.log(`${name}.glb  ${(fs.statSync(out).size / 1024).toFixed(0)} КБ`)
}

// ---------- персонажи ----------

const CHAR_DIR = path.join(SRC, 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf')
const CLIPS = [
  'Idle', 'Unarmed_Idle', 'Walking_A', 'Running_A', 'Running_B', 'Running_Strafe_Left', 'Running_Strafe_Right',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin', '2H_Melee_Attack_Chop', '1H_Ranged_Shoot', '1H_Ranged_Aiming',
  'Throw', 'Unarmed_Melee_Attack_Punch_A', 'Hit_A', 'Hit_B', 'Death_A', 'Death_A_Pose',
  'Death_B', 'Death_B_Pose', 'Dodge_Forward', 'Cheer', 'Sit_Chair_Idle',
]

async function buildCharacters() {
  for (const c of ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded']) {
    const d = await io.read(path.join(CHAR_DIR, `${c}.glb`))
    for (const a of d.getRoot().listAnimations()) {
      for (const smp of a.listSamplers()) { smp.getInput()?.dispose(); smp.getOutput()?.dispose(); smp.dispose() }
      for (const ch of a.listChannels()) ch.dispose()
      a.dispose()
    }
    // оставляем только тело: оружие, шлемы и плащи фэнтези-героям в офисе не нужны
    const keep = /(_ArmLeft|_ArmRight|_Body|_Head|_Head_Hooded|_LegLeft|_LegRight)$/
    for (const n of d.getRoot().listNodes()) {
      if (n.getMesh() && !keep.test(n.getName())) { n.getMesh().dispose(); n.setMesh(null); n.setSkin(null) }
    }
    await d.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    const out = path.join(OUT, `char_${c.toLowerCase()}.glb`)
    await io.write(out, d)
    console.log(`char_${c.toLowerCase()}.glb  ${(fs.statSync(out).size / 1024).toFixed(0)} КБ`)
  }
  // анимации — из одного файла, без мешей
  const d = await io.read(path.join(CHAR_DIR, 'Knight.glb'))
  for (const a of d.getRoot().listAnimations()) {
    if (CLIPS.includes(a.getName())) continue
    for (const smp of a.listSamplers()) smp.dispose() // входы-времена общие между клипами — их не трогаем
    for (const ch of a.listChannels()) ch.dispose()
    a.dispose()
  }
  for (const n of d.getRoot().listNodes()) if (n.getMesh()) { n.setMesh(null); n.setSkin(null) }
  for (const m of d.getRoot().listMeshes()) m.dispose()
  await d.transform(resample(), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = path.join(OUT, 'char_anims.glb')
  await io.write(out, d)
  console.log(`char_anims.glb  ${(fs.statSync(out).size / 1024).toFixed(0)} КБ, клипов: ${d.getRoot().listAnimations().length}`)
}

for (const [name, pack] of Object.entries(PACKS)) await buildPack(name, pack)
await buildCharacters()

fs.writeFileSync(path.join(OUT, 'LICENSE-KayKit.txt'),
  'KayKit asset packs by Kay Lousberg (www.kaylousberg.com)\n' +
  'Furniture Bits, Restaurant Bits, Prototype Bits, Character Pack: Adventures\n' +
  'License: Creative Commons Zero (CC0) — http://creativecommons.org/publicdomain/zero/1.0/\n')
