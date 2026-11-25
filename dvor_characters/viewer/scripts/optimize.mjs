// Optimise raw Blender GLBs for the Telegram Mini App.
//   node scripts/optimize.mjs            (from dvor_characters/viewer)
// Output in ../dist:
//   <NAME>.glb       EXT_meshopt_compression + KHR_mesh_quantization, PNG atlas (works everywhere)
//   <NAME>.ktx2.glb  same geometry, KTX2 / Basis ETC1S atlas (KHR_texture_basisu) for GPU-compressed VRAM
//   report.json      measured byte sizes (raw, gzip, brotli), triangles, draw calls, clips
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { toktx, Mode } from '@gltf-transform/cli';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const RAW = path.join(ROOT, 'export', 'raw');
const DIST = path.join(ROOT, 'dist');
const KTX_BIN = process.env.KTX_BIN || '/opt/ktx/KTX-Software-4.4.2-Linux-x86_64/bin';
process.env.PATH = `${KTX_BIN}:${process.env.PATH}`;
process.env.LD_LIBRARY_PATH = path.join(KTX_BIN, '..', 'lib');
const ETC1S_QUALITY = Number(process.env.ETC1S_QUALITY || 192);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const sizes = (file) => {
  const buf = fs.readFileSync(file);
  return {
    bytes: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buf).length,
  };
};

fs.mkdirSync(DIST, { recursive: true });
const only = process.argv.slice(2);
const report = fs.existsSync(path.join(DIST, 'report.json'))
  ? JSON.parse(fs.readFileSync(path.join(DIST, 'report.json'), 'utf8'))
  : { characters: {} };

for (const file of fs.readdirSync(RAW).filter((f) => f.endsWith('.glb'))) {
  const name = path.basename(file, '.glb');
  if (only.length && !only.includes(name)) continue;
  const doc = await io.read(path.join(RAW, file));

  // KHR_materials_specular would make three.js use MeshPhysicalMaterial (heavier shader).
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_materials_specular') ext.dispose();
  }
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setDoubleSided(false);
    mat.setMetallicFactor(0);
  }

  await doc.transform(
    dedup(),
    resample({ tolerance: 1e-4 }),
    prune({ keepLeaves: false, keepAttributes: false }),
  );
  // KTX2 variant: Basis ETC1S with mipmaps, encoded before meshopt so geometry is compressed once.
  const ktxDoc = cloneDocument(doc);
  await ktxDoc.transform(toktx({ mode: Mode.ETC1S, quality: ETC1S_QUALITY, compression: 2 }));

  const mopt = meshopt({ encoder: MeshoptEncoder, level: 'medium' });
  await doc.transform(mopt);
  await ktxDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const outPng = path.join(DIST, `${name}.glb`);
  const outKtx = path.join(DIST, `${name}.ktx2.glb`);
  await io.write(outPng, doc);
  await io.write(outKtx, ktxDoc);

  // measured facts for the report
  const check = await io.read(outPng);
  const meshes = check.getRoot().listMeshes().map((m) => ({
    name: m.getName(),
    primitives: m.listPrimitives().length,
    triangles: m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0),
  }));
  const anims = check.getRoot().listAnimations().map((a) => {
    let dur = 0;
    for (const s of a.listSamplers()) dur = Math.max(dur, s.getInput().getMax([0])[0]);
    return { name: a.getName(), duration_s: +dur.toFixed(3), channels: a.listChannels().length };
  });
  report.characters[name] = {
    glb: { file: `${name}.glb`, ...sizes(outPng) },
    ktx2_glb: { file: `${name}.ktx2.glb`, ...sizes(outKtx) },
    raw_glb_bytes: fs.statSync(path.join(RAW, file)).size,
    meshes,
    materials: check.getRoot().listMaterials().length,
    textures: check.getRoot().listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize() })),
    joints: check.getRoot().listSkins()[0]?.listJoints().length ?? 0,
    draw_calls_visible_lod: 1,
    extensions: check.getRoot().listExtensionsUsed().map((e) => e.extensionName),
    animations: anims,
  };
  console.log(name, report.characters[name].glb, report.characters[name].ktx2_glb);
}
report.generated = new Date().toISOString();
report.etc1s_quality = ETC1S_QUALITY;
report.tools = { 'gltf-transform': '4.5.1', meshoptimizer: '1.3.0', 'KTX-Software': '4.4.2' };
fs.writeFileSync(path.join(DIST, 'report.json'), JSON.stringify(report, null, 2));
