# Weapon preparation: normalise (barrel +Z, up +Y, metres, origin at the right-hand grip), prune, export gltf + marker json, draw side/top views.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from glbinfo import load, acc, world
from conv import convert
from PIL import Image, ImageDraw
SRC = '/opt/models/weapons/'; OUT = '/home/user/safarzod/Assets/Weapons/Src'
AX = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}

def subtree(js, i, out):
    out.append(i)
    for c in js['nodes'][i].get('children', []): subtree(js, c, out)

def prep(key, cfg, write=True, views=True):
    path = SRC + cfg['id'] + '.glb'
    js, binc = load(path); W, par = world(js); nodes = js['nodes']
    names = [n.get('name', '') for n in nodes]
    drop = []
    for i, n in enumerate(names):
        if any(n == d or (d.endswith('*') and n.startswith(d[:-1])) for d in cfg.get('drop', [])): subtree(js, i, drop)
    if 'keep' in cfg:
        keepset = []
        for i, n in enumerate(names):
            if n in cfg['keep']: subtree(js, i, keepset)
        anc = set()
        for i in keepset:
            p = par[i]
            while p >= 0: anc.add(p); p = par[p]
        drop += [i for i in range(len(nodes)) if i not in keepset and i not in anc]
    drop = set(drop)
    f = np.array(AX[cfg['fwd']], float); u = np.array(AX[cfg['up']], float); r = np.cross(u, f)   # gltf x axis (= -unity right)
    R = np.stack([r, u, f])
    parts = []
    for i, n in enumerate(nodes):
        if i in drop or 'mesh' not in n: continue
        for p in js['meshes'][n['mesh']]['primitives']:
            P = acc(js, binc, p['attributes']['POSITION']).astype(float)
            Pw = (P @ W[i][:3, :3].T + W[i][:3, 3]) @ R.T
            idx = acc(js, binc, p['indices']).reshape(-1, 3) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
            parts.append((names[i], Pw, idx))
    allp = np.concatenate([p[1] for p in parts])
    mn, mx = allp.min(0), allp.max(0)
    s = cfg['length'] / (mx[2] - mn[2])
    org = np.array(cfg.get('origin', [0, 0, 0]), float)        # in normalised unity coords relative to (centre x, min y, min z)
    base = np.array([(mn[0] + mx[0]) / 2, mn[1], mn[2]])
    def norm(Pw):
        q = (Pw - base) * s; q[:, 0] *= -1; return q - org      # unity coords
    M = np.eye(4); M[:3, :3] = R * s
    t = -base * s; t[0] = t[0] - (-org[0]); t[1] -= org[1]; t[2] -= org[2]
    M[:3, 3] = t
    if write:
        convert(path, os.path.join(OUT, key), key, drop=drop, wrap=M)
    q_all = norm(allp)
    print(key, 'size (x,y,z) m:', np.round(q_all.max(0) - q_all.min(0), 3), 'min', np.round(q_all.min(0), 3), 'max', np.round(q_all.max(0), 3))
    if views:
        sc = 1500 / cfg['length']; pad = 60
        lo, hi = q_all.min(0), q_all.max(0)
        Wd = int((hi[2] - lo[2]) * sc) + 2 * pad; H1 = int((hi[1] - lo[1]) * sc) + 2 * pad; H2 = int((hi[0] - lo[0]) * sc) + 2 * pad
        img = Image.new('RGB', (Wd, H1 + H2), (255, 255, 255)); d = ImageDraw.Draw(img)
        def side(p): return (pad + (p[2] - lo[2]) * sc, pad + (hi[1] - p[1]) * sc)
        def top(p): return (pad + (p[2] - lo[2]) * sc, H1 + pad + (p[0] - lo[0]) * sc)
        step = 0.05 if cfg['length'] > 0.5 else 0.02
        for z in np.arange(np.floor(lo[2] / step) * step, hi[2] + step, step):
            x = pad + (z - lo[2]) * sc; d.line([(x, 0), (x, H1 + H2)], fill=(225, 225, 225)); d.text((x + 2, 2), '%.2f' % z, fill=(120, 120, 120))
        for y in np.arange(np.floor(lo[1] / step) * step, hi[1] + step, step):
            yy = pad + (hi[1] - y) * sc; d.line([(0, yy), (Wd, yy)], fill=(225, 225, 225)); d.text((2, yy + 1), '%.2f' % y, fill=(120, 120, 120))
        for x in np.arange(np.floor(lo[0] / step) * step, hi[0] + step, step):
            yy = H1 + pad + (x - lo[0]) * sc; d.line([(0, yy), (Wd, yy)], fill=(235, 225, 225)); d.text((2, yy + 1), 'x%.2f' % x, fill=(160, 120, 120))
        cols = [(200, 30, 30), (30, 120, 200), (30, 160, 60), (160, 60, 180), (220, 140, 20), (20, 160, 160), (110, 110, 110), (150, 90, 40)]
        hl = cfg.get('highlight')
        for k, (nm, Pw, idx) in enumerate(parts):
            q = norm(Pw); c = cols[k % len(cols)] if hl is None else ((220, 0, 0) if nm in hl else (150, 150, 150))
            if len(idx) > 6000: idx = idx[::len(idx) // 6000 + 1]
            for tri in idx:
                a, b, cc = q[tri[0]], q[tri[1]], q[tri[2]]
                d.line([side(a), side(b), side(cc), side(a)], fill=c); d.line([top(a), top(b), top(cc), top(a)], fill=c)
            if cfg.get('labels'):
                cen = q.mean(0); d.text(side(cen), nm[:14], fill=(0, 0, 0))
        for nm, m in cfg.get('markers', {}).items():
            for fn in (side, top):
                x, y = fn(np.array(m['p'])); d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(0, 0, 0), width=2); d.text((x + 7, y - 12), nm, fill=(0, 0, 0))
        for fn in (side, top):
            x, y = fn(np.zeros(3)); d.line([(x - 12, y), (x + 12, y)], fill=(0, 0, 0), width=2); d.line([(x, y - 12), (x, y + 12)], fill=(0, 0, 0), width=2)
        vd = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(vd, exist_ok=True); img.save(os.path.join(vd, 'wpn_%s.png' % key))
    return {'key': key, 'markers': cfg.get('markers', {}), 'mag': cfg.get('mag', []), 'parts': cfg.get('parts', {})}
