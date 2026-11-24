# First-person arm packs (Sketchfab GLBs) -> Assets/FpArms/<pack>/<pack>.gltf + .bin + textures.
#   - keeps only the animations FpView uses, renamed by role (idle, walk, run, fire, reload, draw, ...)
#   - simplifies the heaviest meshes with meshoptimizer (pip install meshoptimizer) to stay under ~40k triangles per pack
#   - drops scene helpers (lights, widget shapes, sun)
# usage: python3 -I tools/fparms/prep.py <dir with ak.glb pistol.glb sniper.glb knife.glb> [project root]
import sys, os, json, io, glob
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'chars'))
import numpy as np
import meshoptimizer as mo
from PIL import Image
import glbinfo, conv

PACKS = {
    'ak': dict(anims={'RIG_UE5_Comando_AK_Idle': 'idle', 'RIG_UE5_Comando_AK_Walk': 'walk', 'RIG_UE5_Comando_AK__Run': 'run',
                      'RIG_UE5_Comando_AK_Fire': 'fire', 'RIG_UE5_Comando_AK_Reload': 'reload', 'RIG_UE5_Comando_AK_Equip': 'draw',
                      'RIG_UE5_Comando_AK_Hold': 'hold'},
               simplify={'Object_15': 7000, 'Object_14': 4500, 'Object_25': 8000}, drop=()),
    'pistol': dict(anims={'RIG_UE5_Comando_Idle': 'idle', 'RIG_UE5_Comando_Walk': 'walk', 'RIG_UE5_Comando_Run': 'run',
                          'RIG_UE5_Comando_Fire': 'fire', 'RIG_UE5_Comando_Reload': 'reload', 'RIG_UE5_Comando_Equip': 'draw',
                          'RIG_UE5_Comando_Change': 'holster', 'RIG_UE5_Comando_Hold': 'hold'},
                   simplify={'Object_27': 8000}, drop=()),
    'sniper': dict(anims={'Rig|SRifle_Idle': 'idle', 'Rig|SRifle_Walk': 'walk', 'Rig|SRifle_Shot_nosight': 'fire',
                          'Rig|SRifle_Reload': 'reload', 'Rig|SRifle_Reload_Full': 'reload_empty'},
                   simplify={'Object_9': 10000}, drop=('Sun',)),
    'knife': dict(anims={'Armature|Take': 'draw', 'Armature|Idle': 'idle', 'Armature|Fire1': 'fire', 'Armature|Fire2': 'fire2'},
                  simplify={}, drop=('Lights', 'Shapes')),
}

def add_view(js, binc, data):
    while len(binc) % 4: binc.append(0)
    js['bufferViews'].append({'buffer': 0, 'byteOffset': len(binc), 'byteLength': len(data)})
    binc += data
    return len(js['bufferViews']) - 1

def add_acc(js, binc, arr, like):
    a = {k: v for k, v in like.items() if k in ('componentType', 'type', 'normalized')}
    dt = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a['componentType']]
    arr = np.ascontiguousarray(arr.astype(dt))
    a['bufferView'] = add_view(js, binc, arr.tobytes()); a['count'] = int(arr.shape[0])
    if 'min' in like:
        a['min'] = arr.min(0).reshape(-1).tolist(); a['max'] = arr.max(0).reshape(-1).tolist()
    js['accessors'].append(a)
    return len(js['accessors']) - 1

def simplify(js, binc, prim, target):
    P = glbinfo.acc(js, bytes(binc), prim['attributes']['POSITION']).astype(np.float32)
    idx = glbinfo.acc(js, bytes(binc), prim['indices']).reshape(-1).astype(np.uint32)
    out = np.zeros(len(idx), dtype=np.uint32)
    n = mo.simplify(out, idx, P, target_index_count=target * 3, target_error=0.02)
    out = out[:n]
    used, remap = np.unique(out, return_inverse=True)
    for k, a in list(prim['attributes'].items()):
        arr = glbinfo.acc(js, bytes(binc), a)[used]
        prim['attributes'][k] = add_acc(js, binc, arr, js['accessors'][a])
    ia = dict(js['accessors'][prim['indices']]); ia['componentType'] = 5123 if len(used) < 65536 else 5125
    prim['indices'] = add_acc(js, binc, remap.reshape(-1, 1).astype(np.uint32), ia)
    return len(idx) // 3, n // 3

def jpegify(outdir, name):
    gl = os.path.join(outdir, name + '.gltf'); J = json.load(open(gl))
    for im in J.get('images', []):
        p = os.path.join(outdir, im['uri'])
        if not p.endswith('.png'): continue
        pil = Image.open(p)
        if pil.mode in ('RGBA', 'LA', 'P') and pil.convert('RGBA').getextrema()[3][0] < 250: continue
        q = p[:-4] + '.jpg'
        pil.convert('RGB').save(q, 'JPEG', quality=95 if p.endswith('_n.png') else 90)
        os.remove(p); im['uri'] = im['uri'][:-4] + '.jpg'; im['name'] = os.path.basename(q)
    json.dump(J, open(gl, 'w'))

def main(src_dir, root):
    for name, cfg in PACKS.items():
        js, binc = glbinfo.load(os.path.join(src_dir, name + '.glb')); binc = bytearray(binc)
        js['animations'] = [dict(a, name=cfg['anims'][a['name']]) for a in js['animations'] if a['name'] in cfg['anims']]
        assert len(js['animations']) == len(cfg['anims']), (name, [a['name'] for a in js['animations']])
        for n in js['nodes']:
            if n.get('name') in cfg['simplify'] and 'mesh' in n:
                for p in js['meshes'][n['mesh']]['primitives']:
                    print('  simplify %s %s: %d -> %d tris' % (name, n['name'], *simplify(js, binc, p, cfg['simplify'][n['name']])))
        drop = tuple(i for i, n in enumerate(js['nodes']) if n.get('name') in cfg['drop'])
        js['buffers'] = [{'byteLength': len(binc)}]
        outdir = os.path.join(root, 'Assets', 'FpArms', name)
        for f in glob.glob(os.path.join(outdir, name + '_tex', '*')): os.remove(f)
        conv.load = lambda p, js=js, binc=bytes(binc): (js, binc)
        conv.convert('mem', outdir, name, drop=drop, keep_anims=True)
        jpegify(outdir, name)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..'))
