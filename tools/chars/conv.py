# GLB -> pruned .gltf + .bin + external (downscaled) textures.  usage: see convert()
import sys, os, json, io, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbinfo import load
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

def tex_refs(obj, out, key=''):
    if isinstance(obj, dict):
        if 'index' in obj and key.endswith('Texture'): out.append((key, obj))
        for k, v in obj.items(): tex_refs(v, out, k)
    elif isinstance(obj, list):
        for v in obj: tex_refs(v, out, key)

def convert(src, outdir, name, drop=(), keep_anims=False, maxtex=1024, drop_mats=(), wrap=None):
    js, binc = load(src)
    nodes = js['nodes']
    keep = []
    def go(i):
        if i in drop: return
        keep.append(i)
        for c in nodes[i].get('children', []): go(c)
    for r in js['scenes'][js.get('scene', 0)]['nodes']: go(r)
    nmap = {o: n for n, o in enumerate(keep)}
    used_mesh, used_skin = [], []
    for i in keep:
        n = nodes[i]
        if 'mesh' in n and n['mesh'] not in used_mesh: used_mesh.append(n['mesh'])
        if 'skin' in n and n['skin'] not in used_skin: used_skin.append(n['skin'])
    used_acc, used_mat = [], []
    def A(i):
        if i not in used_acc: used_acc.append(i)
    for m in used_mesh:
        for p in js['meshes'][m]['primitives']:
            for a in p['attributes'].values(): A(a)
            if 'indices' in p: A(p['indices'])
            for t in p.get('targets', []):
                for a in t.values(): A(a)
            if 'material' in p and p['material'] not in used_mat: used_mat.append(p['material'])
    for s in used_skin:
        if 'inverseBindMatrices' in js['skins'][s]: A(js['skins'][s]['inverseBindMatrices'])
        for j in js['skins'][s]['joints']: assert j in nmap, 'joint dropped'
    anims = js.get('animations', []) if keep_anims else []
    for a in anims:
        for s in a['samplers']: A(s['input']); A(s['output'])
    # textures
    refs = []
    for m in used_mat: tex_refs(js['materials'][m], refs)
    used_tex, kind = [], {}
    for key, r in refs:
        t = r['index']
        if t not in used_tex: used_tex.append(t)
        img = js['textures'][t].get('source')
        k = 'n' if key == 'normalTexture' else ('l' if key in ('metallicRoughnessTexture', 'occlusionTexture') else 'c')
        if kind.get(img, k) != k and 'c' in (k, kind[img]): k = 'c'
        kind[img] = k
    used_img, used_samp = [], []
    for t in used_tex:
        tx = js['textures'][t]
        if tx.get('source') is not None and tx['source'] not in used_img: used_img.append(tx['source'])
        if 'sampler' in tx and tx['sampler'] not in used_samp: used_samp.append(tx['sampler'])
    used_bv = []
    for a in used_acc:
        acc = js['accessors'][a]
        if 'bufferView' in acc and acc['bufferView'] not in used_bv: used_bv.append(acc['bufferView'])
        assert 'sparse' not in acc
    # buffer
    out = bytearray(); new_bv = []
    for b in used_bv:
        bv = dict(js['bufferViews'][b]); off = bv.get('byteOffset', 0)
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out); bv['buffer'] = 0
        out += binc[off:off + bv['byteLength']]; new_bv.append(bv)
    os.makedirs(outdir, exist_ok=True)
    texdir = os.path.join(outdir, name + '_tex'); 
    new_img = []
    for k, im in enumerate(used_img):
        I = js['images'][im]; bv = js['bufferViews'][I['bufferView']]; off = bv.get('byteOffset', 0)
        data = binc[off:off + bv['byteLength']]
        pil = Image.open(io.BytesIO(data)); fmt = pil.format
        ext = 'jpg' if fmt == 'JPEG' else 'png'
        if max(pil.size) > maxtex:
            s = maxtex / max(pil.size)
            pil = pil.resize((max(1, round(pil.size[0] * s)), max(1, round(pil.size[1] * s))), Image.LANCZOS)
            bio = io.BytesIO()
            if ext == 'jpg': pil.convert('RGB').save(bio, 'JPEG', quality=90)
            else:
                has_a = pil.mode in ('RGBA', 'LA', 'P') and pil.convert('RGBA').getextrema()[3][0] < 250
                if has_a: pil.save(bio, 'PNG', optimize=True)
                else: pil.convert('RGB').save(bio, 'JPEG', quality=90); ext = 'jpg'
            data = bio.getvalue()
        os.makedirs(texdir, exist_ok=True)
        suffix = {'n': '_n', 'l': '_l', 'c': ''}[kind.get(im, 'c')]
        fn = '%s_%02d%s.%s' % (name, k, suffix, ext)
        open(os.path.join(texdir, fn), 'wb').write(data)
        new_img.append({'uri': name + '_tex/' + fn, 'name': fn})
    # remap json
    J = {'asset': js['asset'], 'scene': 0}
    for k in ('extensionsUsed', 'extensionsRequired'):
        if k in js: J[k] = js[k]
    J['buffers'] = [{'byteLength': len(out), 'uri': name + '.bin'}]
    J['bufferViews'] = new_bv
    accs = []
    for a in used_acc:
        acc = dict(js['accessors'][a]); acc['bufferView'] = used_bv.index(acc['bufferView']); accs.append(acc)
    J['accessors'] = accs
    am = {o: n for n, o in enumerate(used_acc)}
    if used_samp: J['samplers'] = [js['samplers'][s] for s in used_samp]
    if used_img: J['images'] = new_img
    if used_tex:
        J['textures'] = []
        for t in used_tex:
            tx = dict(js['textures'][t])
            if 'source' in tx: tx['source'] = used_img.index(tx['source'])
            if 'sampler' in tx: tx['sampler'] = used_samp.index(tx['sampler'])
            J['textures'].append(tx)
    mats = []
    for m in used_mat:
        mm = json.loads(json.dumps(js['materials'][m])); rr = []; tex_refs(mm, rr)
        for key, r in rr: r['index'] = used_tex.index(r['index'])
        mats.append(mm)
    if mats: J['materials'] = mats
    meshes = []
    for m in used_mesh:
        mm = json.loads(json.dumps(js['meshes'][m]))
        for p in mm['primitives']:
            p['attributes'] = {k: am[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = am[p['indices']]
            if 'targets' in p: p['targets'] = [{k: am[v] for k, v in t.items()} for t in p['targets']]
            if 'material' in p: p['material'] = used_mat.index(p['material'])
        meshes.append(mm)
    if meshes: J['meshes'] = meshes
    skins = []
    for s in used_skin:
        ss = dict(js['skins'][s]); ss['joints'] = [nmap[j] for j in ss['joints']]
        if 'inverseBindMatrices' in ss: ss['inverseBindMatrices'] = am[ss['inverseBindMatrices']]
        if 'skeleton' in ss:
            if ss['skeleton'] in nmap: ss['skeleton'] = nmap[ss['skeleton']]
            else: del ss['skeleton']
        skins.append(ss)
    if skins: J['skins'] = skins
    nn = []
    for i in keep:
        n = dict(nodes[i])
        if 'children' in n:
            n['children'] = [nmap[c] for c in n['children'] if c in nmap]
            if not n['children']: del n['children']
        if 'mesh' in n: n['mesh'] = used_mesh.index(n['mesh'])
        if 'skin' in n: n['skin'] = used_skin.index(n['skin'])
        n.pop('camera', None)
        nn.append(n)
    J['nodes'] = nn
    roots = [nmap[r] for r in js['scenes'][js.get('scene', 0)]['nodes'] if r in nmap]
    if wrap is not None:
        nn.append({'name': 'Norm', 'children': roots, 'matrix': [float(x) for x in wrap.T.reshape(-1)]}); roots = [len(nn) - 1]
    J['scenes'] = [{'nodes': roots}]
    if anims:
        aa = []
        for a in anims:
            a2 = {'name': a.get('name', 'anim'), 'samplers': [dict(s, input=am[s['input']], output=am[s['output']]) for s in a['samplers']],
                  'channels': [dict(c, target=dict(c['target'], node=nmap[c['target']['node']])) for c in a['channels'] if c['target'].get('node') in nmap]}
            aa.append(a2)
        J['animations'] = aa
    open(os.path.join(outdir, name + '.bin'), 'wb').write(out)
    json.dump(J, open(os.path.join(outdir, name + '.gltf'), 'w'))
    tris = sum(js['accessors'][p['indices']]['count'] // 3 for m in used_mesh for p in js['meshes'][m]['primitives'] if 'indices' in p)
    print('%s: nodes %d meshes %d mats %d imgs %d tris %d bin %.1fMB' % (name, len(nn), len(meshes), len(mats), len(new_img), tris, len(out) / 1e6))
