import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const RAW = path.join(ROOT, 'export', 'raw');
const DIST = path.join(ROOT, 'dist');

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

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const outPng = path.join(DIST, `${name}.glb`);
  await io.write(outPng, doc);

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
    raw_glb_bytes: fs.statSync(path.join(RAW, file)).size,
    meshes,
    materials: check.getRoot().listMaterials().length,
    textures: check.getRoot().listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize() })),
    joints: check.getRoot().listSkins()[0]?.listJoints().length ?? 0,
    draw_calls_visible_lod: 1,
    extensions: check.getRoot().listExtensionsUsed().map((e) => e.extensionName),
    animations: anims,
  };
  console.log(name, report.characters[name].glb);
}
report.generated = new Date().toISOString();
report.tools = { 'gltf-transform': '4.5.1', meshoptimizer: '1.3.0' };
fs.writeFileSync(path.join(DIST, 'report.json'), JSON.stringify(report, null, 2));
