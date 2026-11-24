"""blender -b -P tile_build.py -> kit/tile_panel_majolica.glb"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
import tile_layout as T
reset()
A = Atlas(T.S, T.ISL)
TX = os.path.join(TEXOUT, 'tiles')
mat = pbr_material('majolica', TX + '_base.jpg', TX + '_orm.jpg', TX + '_nrm.jpg')
mb = MB(); sd = [0]
def bf(pts):
    sd[0] += 1; return plain_fit(A, 'brick', pts, sd[0], along=None)
F = T.FRAME; hw = T.PW / 2
z0 = F
# tile slab (front at y=-DEPTH), bottom of frame at z=0
def tuv(k, pts):
    if k == '-y': return [A.uv('front', p[0] + hw, p[2] - z0) for p in pts]
    return bf(pts)
box_faces(mb, -hw, -T.DEPTH, z0, hw, 0.0, z0 + T.PH, tuv, skip=('+y', '-x', '+x', '-z', '+z'))
# brick surround: four bars protruding FDEPTH
def bar(x0, z_0, x1, z_1, skip=()):
    box_faces(mb, x0, -T.FDEPTH, z_0, x1, 0.0, z_1, lambda k, p: bf(p), skip=('+y',) + skip)
bar(-hw - F, 0, hw + F, F)
bar(-hw - F, z0 + T.PH, hw + F, z0 + T.PH + F)
bar(-hw - F, F, -hw, z0 + T.PH, skip=('-z', '+z'))
bar(hw, F, hw + F, z0 + T.PH, skip=('-z', '+z'))
bk = [(hw + F, 0.0, 0.0), (-hw - F, 0.0, 0.0), (-hw - F, 0.0, z0 + T.PH + F), (hw + F, 0.0, z0 + T.PH + F)]
mb.face(bk, bf(bk))
ob = mb.to_object('tile_panel_majolica', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]))
export_glb(os.path.join(KIT, 'tile_panel_majolica.glb'), [ob])
