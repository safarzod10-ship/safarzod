import sys, json, struct
import numpy as np
def load(path):
    f=open(path,'rb'); d=f.read(); f.close()
    magic,ver,length=struct.unpack('<III',d[:12])
    off=12; js=None; binc=None
    while off<length:
        clen,ctype=struct.unpack('<II',d[off:off+8]); off+=8
        if ctype==0x4E4F534A: js=json.loads(d[off:off+clen])
        elif ctype==0x004E4942: binc=d[off:off+clen]
        off+=clen
    return js,binc
CT={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def acc(js,binc,i):
    a=js['accessors'][i]; bv=js['bufferViews'][a['bufferView']]
    fmt,sz=CT[a['componentType']]; n=NC[a['type']]
    off=bv.get('byteOffset',0)+a.get('byteOffset',0)
    stride=bv.get('byteStride',0) or sz*n
    cnt=a['count']
    if stride==sz*n:
        arr=np.frombuffer(binc,dtype=np.dtype(fmt).newbyteorder('<'),count=cnt*n,offset=off).reshape(cnt,n)
    else:
        raw=np.frombuffer(binc,dtype=np.uint8,count=stride*(cnt-1)+sz*n,offset=off)
        idx=(np.arange(cnt)[:,None]*stride+np.arange(sz*n)[None,:])
        arr=raw[idx].copy().view(np.dtype(fmt).newbyteorder('<')).reshape(cnt,n)
    return arr
def trs(n):
    if 'matrix' in n: return np.array(n['matrix'],dtype=float).reshape(4,4).T
    t=n.get('translation',[0,0,0]); r=n.get('rotation',[0,0,0,1]); s=n.get('scale',[1,1,1])
    x,y,z,w=r
    R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    M=np.eye(4); M[:3,:3]=R*np.array(s)[None,:]; M[:3,3]=t; return M
def world(js):
    nodes=js['nodes']; W=[None]*len(nodes); par=[-1]*len(nodes)
    for i,n in enumerate(nodes):
        for c in n.get('children',[]): par[c]=i
    def go(i,P):
        W[i]=P@trs(nodes[i])
        for c in nodes[i].get('children',[]): go(c,W[i])
    for r in js['scenes'][js.get('scene',0)]['nodes']: go(r,np.eye(4))
    return W,par
if __name__=='__main__':
    js,binc=load(sys.argv[1]); mode=sys.argv[2] if len(sys.argv)>2 else 'tree'
    W,par=world(js); nodes=js['nodes']
    print('meshes',len(js.get('meshes',[])),'mats',len(js.get('materials',[])),'tex',len(js.get('textures',[])),'img',len(js.get('images',[])),'skins',len(js.get('skins',[])),'anims',len(js.get('animations',[])),'nodes',len(nodes))
    if mode=='tree':
        maxd=int(sys.argv[3]) if len(sys.argv)>3 else 99
        def pr(i,d):
            n=nodes[i]; s=''
            if 'mesh' in n:
                m=js['meshes'][n['mesh']]; tri=0; mn=np.array([1e9]*3); mx=-mn
                for p in m['primitives']:
                    a=js['accessors'][p['attributes']['POSITION']]
                    tri+=js['accessors'][p['indices']]['count']//3 if 'indices' in p else a['count']//3
                    if 'skin' not in n:
                        c=np.array([[x,y,z,1] for x in (a['min'][0],a['max'][0]) for y in (a['min'][1],a['max'][1]) for z in (a['min'][2],a['max'][2])])@W[i].T
                        mn=np.minimum(mn,c[:,:3].min(0)); mx=np.maximum(mx,c[:,:3].max(0))
                mats=[js['materials'][p['material']]['name'] if 'material' in p else '-' for p in m['primitives']]
                s=' MESH tris=%d mats=%s'%(tri,mats)+(' skin=%d'%n['skin'] if 'skin' in n else ' bbox=%s..%s'%(np.round(mn,3).tolist(),np.round(mx,3).tolist()))
            if d<=maxd or 'mesh' in n: print('  '*d+'%d %s'%(i,n.get('name','?'))+s+(' T%s'%np.round(n['translation'],3).tolist() if 'translation' in n and d<=maxd else '')+(' R%s'%np.round(n['rotation'],3).tolist() if 'rotation' in n and d<=maxd else '')+(' S%s'%np.round(n['scale'],3).tolist() if 'scale' in n and d<=maxd else '')+(' M' if 'matrix' in n else ''))
            for c in n.get('children',[]): pr(c,d+1)
        for r in js['scenes'][js.get('scene',0)]['nodes']: pr(r,0)
    if mode=='anim':
        for a in js['animations']:
            tmax=max(js['accessors'][s['input']]['max'][0] for s in a['samplers'])
            print(a.get('name'),len(a['channels']),'ch',round(tmax,3),'s')
    if mode=='mat':
        for m in js['materials']: print(json.dumps(m)[:300])
        for im in js.get('images',[]): print(im.get('name'),im.get('mimeType'),js['bufferViews'][im['bufferView']]['byteLength'] if 'bufferView' in im else im.get('uri'))
