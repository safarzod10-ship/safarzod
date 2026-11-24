# Source GLBs (/opt/models) -> pruned .gltf + external <=1K textures under Assets/Chars/Src.   python3 -I tools/chars/conv_chars.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from conv import convert
from glbinfo import load
O='/home/user/safarzod/Assets/Chars/Src'
def idx(path,names):
    js,_=load(path); return [i for i,n in enumerate(js['nodes']) if n.get('name') in names]
convert('/opt/models/anim/rifle_pack.glb',O+'/pack','pack',keep_anims=True,maxtex=256)
p='/opt/models/chars/9e82fabf.glb'; convert(p,O+'/ct1','ct1',drop=idx(p,['part_2_low_101']))
p='/opt/models/chars/f6923917.glb'; convert(p,O+'/ct2','ct2',drop=idx(p,['topGun_low_96']))
p='/opt/models/chars/ee613940.glb'
convert(p,O+'/t1','t1',drop=idx(p,['Null_2','shotgun']))
convert(p,O+'/t2','t2',drop=idx(p,['Null','pistolow']))
