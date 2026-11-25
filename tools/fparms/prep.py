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

def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); v = np.cross(a, b); c = float(a @ b)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)

def world_at(js, binc, anim, t):
    """world matrices of all nodes with animation `anim` sampled (nearest key) at time t"""
    nodes = js['nodes']; over = {}
    a = [x for x in js['animations'] if x['name'] == anim][0]
    for c in a['channels']:
        s = a['samplers'][c['sampler']]
        T = glbinfo.acc(js, binc, s['input'])[:, 0]; V = glbinfo.acc(js, binc, s['output'])
        k = int(np.clip(np.searchsorted(T, t), 0, len(T) - 1))
        over.setdefault(c['target']['node'], {})[c['target']['path']] = V[k].tolist()
    W = [None] * len(nodes)
    def go(i, P):
        n = dict(nodes[i]); n.update(over.get(i, {}))
        if i in over: n.pop('matrix', None)
        W[i] = P @ glbinfo.trs(n)
        for ch in nodes[i].get('children', []): go(ch, W[i])
    for r in js['scenes'][js.get('scene', 0)]['nodes']: go(r, np.eye(4))
    return W

def fix_knife(js, binc):
    # The knife mesh of the knife pack is stored in a far-away space that its inverse bind matrix does not undo (it renders
    # kilometres away). Re-express it in bind space so that, in the idle pose, the handle lies in the closed right fist:
    # along the pinky->index knuckle line, guard at the index side, blade out to the upper left, edge toward the fingertips.
    nodes = js['nodes']; B = bytes(binc)
    W = glbinfo.world(js)[0]; Wi = world_at(js, B, 'idle', 0.0)
    idx = lambda name: [i for i, x in enumerate(nodes) if x.get('name', '').startswith(name)][0]
    P_ = lambda name: Wi[idx(name)][:3, 3]
    sk = js['skins'][0]; J = sk['joints']
    IBM = glbinfo.acc(js, B, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    base = idx('Base_'); k = J.index(base)
    toBind = np.linalg.inv(IBM[k]) @ np.linalg.inv(Wi[base])          # idle world -> bind space (through the Base bone)
    # source knife frame
    kl = idx('Knife_low')
    M = W[kl] @ np.diag([.01, .01, .01, 1]); R0 = M[:3, :3] / np.linalg.norm(M[:3, :3], axis=0)
    mesh = [x for x in nodes if x.get('name') == 'Object_122'][0]
    prim = js['meshes'][mesh['mesh']]['primitives'][0]
    P = glbinfo.acc(js, B, prim['attributes']['POSITION']).astype(float)
    Q = (M @ np.c_[P, np.ones(len(P))].T).T[:, :3]
    c = Q.mean(0); V = np.linalg.svd(Q - c, full_matrices=False)[2]; ax = V[0]
    t = (Q - c) @ ax
    size = lambda m: np.ptp((Q - c)[m] @ V[1]) + np.ptp((Q - c)[m] @ V[2])
    if size(t > t.max() - 0.03) > size(t < t.min() + 0.03): ax = -ax; t = -t      # +ax: toward the blade tip (thin end)
    # guard = where the cross-section shrinks from handle to blade
    bins = np.linspace(t.min(), t.max(), 31); thick = []
    for i in range(30):
        m = (t >= bins[i]) & (t < bins[i + 1]); thick.append(np.ptp((Q - c)[m] @ V[2]) if m.sum() > 3 else 0)
    thick = np.array(thick); hmax = thick[:10].max()
    gi = next(i for i in range(10, 30) if thick[i] < 0.45 * hmax)
    g = c + ax * bins[gi]
    e = V[1] - ax * (V[1] @ ax); e /= np.linalg.norm(e)
    # edge side: the thinner half of the blade cross-section
    bl = t > bins[gi] + 0.03; w1 = (Q - c)[bl] @ e; w2 = np.abs((Q - c)[bl] @ V[2])
    if w2[w1 > np.median(w1)].mean() > w2[w1 <= np.median(w1)].mean(): e = -e
    # target frame in the idle pose
    pinky, index = P_('Pinky_1.R'), P_('Index_1.R')
    d = index - pinky; d /= np.linalg.norm(d)
    fist = np.mean([P_(n) for n in ('Index_1.R', 'Middle_1.R', 'Ring_1.R', 'Pinky_1.R', 'Index_2.R_end', 'Middle_2.R_end', 'Ring_2.R_end', 'Pinky_2.R_end', 'Index_0.R', 'Middle_0.R', 'Ring_0.R', 'Pinky_0.R')], axis=0)
    tips = np.mean([P_(n) for n in ('Index_2.R_end', 'Middle_2.R_end', 'Ring_2.R_end', 'Pinky_2.R_end')], axis=0)
    knuck = np.mean([P_(n) for n in ('Index_0.R', 'Middle_0.R', 'Ring_0.R', 'Pinky_0.R')], axis=0)
    e2 = tips - knuck; e2 -= d * (e2 @ d); e2 /= np.linalg.norm(e2)
    G = fist + d * (0.5 * np.linalg.norm(index - pinky) + 0.012)
    S = np.c_[ax, e, np.cross(ax, e)]; T = np.c_[d, e2, np.cross(d, e2)]
    R = T @ S.T
    Pi = (R @ (Q - g).T).T + G
    Pn = (toBind @ np.c_[Pi, np.ones(len(Pi))].T).T[:, :3]
    prim['attributes']['POSITION'] = add_acc(js, binc, Pn, js['accessors'][prim['attributes']['POSITION']])
    Rn = toBind[:3, :3] @ R @ R0
    for key in ('NORMAL', 'TANGENT'):
        if key not in prim['attributes']: continue
        A = glbinfo.acc(js, B, prim['attributes'][key]).astype(float)
        A[:, :3] = (Rn @ A[:, :3].T).T
        prim['attributes'][key] = add_acc(js, binc, A, js['accessors'][prim['attributes'][key]])
    print('  knife mesh re-bound: length %.3f m, guard at %.3f from butt, in the right fist' % (np.ptp(t), bins[gi] - t.min()))

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
        if name == 'knife': fix_knife(js, binc)
        drop = tuple(i for i, n in enumerate(js['nodes']) if n.get('name') in cfg['drop'])
        js['buffers'] = [{'byteLength': len(binc)}]
        outdir = os.path.join(root, 'Assets', 'FpArms', name)
        for f in glob.glob(os.path.join(outdir, name + '_tex', '*')): os.remove(f)
        conv.load = lambda p, js=js, binc=bytes(binc): (js, binc)
        conv.convert('mem', outdir, name, drop=drop, keep_anims=True)
        jpegify(outdir, name)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..'))
