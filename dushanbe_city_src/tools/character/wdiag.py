import bpy, sys, numpy as np
bpy.ops.wm.open_mainfile(filepath=sys.argv[sys.argv.index('--')+1])
o=bpy.data.objects['PlayerMesh']; me=o.data
names=[g.name for g in o.vertex_groups]
W=np.zeros((len(me.vertices),len(names)))
for v in me.vertices:
    for g in v.groups: W[v.index,g.group]=g.weight
co=np.array([v.co[:] for v in me.vertices])
ix={n:i for i,n in enumerate(names)}
def tot(prefix,side):
    return sum(W[:,ix[n]] for n in names if n.split('.')[0] in prefix and n.endswith(side))
armR=tot(('upper_arm','forearm','hand','fingers'),'.R')
m=(armR>0.05)&(co[:,0]>-0.25)&(co[:,2]<1.25)
print('arm.R weight on verts x>-0.25 z<1.25:',m.sum()); 
sel=co[m]; print(sel[:20].round(3), armR[m][:20].round(2))
handR=tot(('hand','fingers'),'.R')
m=(handR>0.02)&(co[:,0]>-0.33); print('hand.R on x>-0.33', m.sum(), co[m][:10].round(3))
thL=tot(('thigh','shin','foot','toe'),'.L')
m=(thL>0.02)&(co[:,0]<-0.05); print('leg.L on x<-0.05', m.sum(), co[m][:10].round(3), thL[m][:10].round(2))
shin=tot(('shin',),'.R')+tot(('shin',),'.L')
m=(shin>0.05)&(co[:,2]>0.5); print('shin on z>0.5', m.sum())
# max influences
print('max infl', (W>1e-3).sum(1).max())
for n in names: print(n, (W[:,ix[n]]>0.01).sum(), end='; ')
