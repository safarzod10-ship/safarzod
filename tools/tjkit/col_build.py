"""blender -b -P col_build.py -> kit/column_aivan.glb"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
import col_layout as C
from col_geo import column_mesh
reset()
A = Atlas(C.S, C.ISL)
T = os.path.join(TEXOUT, 'column')
mat = pbr_material('column_wood', T + '_base.jpg', T + '_orm.jpg', T + '_nrm.jpg')
mb, top = column_mesh(3.10, A)
ob = mb.to_object('column_aivan', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]), 'TOP', top)
export_glb(os.path.join(KIT, 'column_aivan.glb'), [ob])
