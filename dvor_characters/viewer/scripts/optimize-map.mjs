// Optimise the arena map for the Telegram Mini App.
//   node scripts/optimize-map.mjs          (from dvor_characters/viewer, after map/blender/build_map.py)
// In:  ../map/export/MAP_Dvor.raw.glb
// Out: ../dist/MAP_Dvor.glb        unlit (baked light), all props merged -> 1 mesh per material
//      ../dist/MAP_Dvor.ktx2.glb   same with the atlas as KTX2 / ETC1S (much less VRAM on phones)
//      ../dist/map_report.json     measured sizes, triangles, draw calls
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { cloneDocument, dedup, flatten, join, prune, meshopt } from '@gltf-transform/functions';
import { toktx, Mode } from '@gltf-transform/cli';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const KTX_BIN = process.env.KTX_BIN || '/opt/ktx/KTX-Software-4.4.2-Linux-x86_64/bin';
process.env.PATH = `${KTX_BIN}:${process.env.PATH}`;
process.env.LD_LIBRARY_PATH = path.join(KTX_BIN, '..', 'lib');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(path.join(ROOT, 'map', 'export', 'MAP_Dvor.raw.glb'));
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName === 'KHR_materials_specular' || ext.extensionName === 'KHR_materials_ior') ext.dispose();
}
const unlit = doc.createExtension(KHRMaterialsUnlit);
for (const mat of doc.getRoot().listMaterials()) {
  mat.setExtension('KHR_materials_unlit', unlit.createUnlit());
  mat.setMetallicFactor(0).setRoughnessFactor(1);
  if (mat.getName() === 'MAP_ChainLink') {
    mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  } else {
    mat.setAlphaMode('OPAQUE').setDoubleSided(false);
  }
}
// static scenery: bake node transforms, merge everything that shares a material
await doc.transform(dedup(), flatten(), join({ keepNamed: false }), prune());

const ktxDoc = cloneDocument(doc);
// ETC1S for the opaque atlas only; the small alpha fence stays PNG (crisp wires).
await ktxDoc.transform(toktx({ mode: Mode.ETC1S, quality: 192, compression: 2, slots: /baseColorTexture/, pattern: /atlas/i }));
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await ktxDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
const outs = { png: path.join(DIST, 'MAP_Dvor.glb'), ktx2: path.join(DIST, 'MAP_Dvor.ktx2.glb') };
await io.write(outs.png, doc);
await io.write(outs.ktx2, ktxDoc);

const check = await io.read(outs.png);
let tris = 0;
const prims = [];
for (const m of check.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) {
    const n = p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    tris += n;
    prims.push({ material: p.getMaterial()?.getName(), triangles: n, vertices: p.getAttribute('POSITION').getCount() });
  }
}
const sizes = (f) => {
  const b = fs.readFileSync(f);
  return { bytes: b.length, gzip: zlib.gzipSync(b, { level: 9 }).length, brotli: zlib.brotliCompressSync(b).length };
};
const textures = check.getRoot().listTextures().map((t) => ({ name: t.getName() || t.getURI(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage().byteLength }));
const report = {
  map: 'MAP_Dvor', triangles: tris, drawCalls: prims.length, primitives: prims, textures,
  files: { glb: sizes(outs.png), ktx2: sizes(outs.ktx2), raw: sizes(path.join(ROOT, 'map', 'export', 'MAP_Dvor.raw.glb')) },
  generated: new Date().toISOString(),
};
fs.writeFileSync(path.join(DIST, 'map_report.json'), JSON.stringify(report, null, 2));
// prop footprints for the game / test scene (buildings and fence excluded: the fence is the courtyard edge)
const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'map', 'export', 'MAP_Dvor.build.json'), 'utf8'));
fs.writeFileSync(path.join(DIST, 'MAP_Dvor.colliders.json'), JSON.stringify(build.colliders.map(({ x, z, h }) => ({ x, z, h }))));
console.log(JSON.stringify(report, null, 1));
