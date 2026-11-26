// Models for the artifact page: same GLBs as dist/, but without EXT_meshopt_compression (its decoder
// needs WebAssembly, which the artifact's page policy may refuse). Quantization stays (plain WebGL).
// Artifacts serve no .glb files, so each GLB is also written as base64 text (<id>.txt), which the page
// decodes and hands to GLTFLoader.parse. manifest.json lists the text sizes for the progress bar.
//   node scripts/artifact-assets.mjs   ->  artifact/models/*.glb, *.txt, manifest.json, MAP_Dvor.colliders.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');
const OUT = path.join(here, '..', 'artifact', 'models');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const manifest = {};
for (const id of ['MAP_Dvor', 'USER_CH_Technik', 'USER_CH_Sprinter', 'USER_CH_Tank', 'PROPS']) {
  const doc = await io.read(path.join(DIST, `${id}.glb`));
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  const out = path.join(OUT, `${id}.glb`);
  await io.write(out, doc);
  const txt = path.join(OUT, `${id}.txt`);
  fs.writeFileSync(txt, fs.readFileSync(out).toString('base64'));
  manifest[id] = fs.statSync(txt).size;
  console.log(id, fs.statSync(out).size, 'bytes, extensions:', doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', '));
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
fs.copyFileSync(path.join(DIST, 'MAP_Dvor.colliders.json'), path.join(OUT, 'MAP_Dvor.colliders.json'));
