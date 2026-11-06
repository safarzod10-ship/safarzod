import bpy, bmesh, numpy as np
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/safarzod/assets/characters/main_character/main_character.glb")
o=bpy.data.objects['MainCharacter_Mesh']; me=o.data
co=np.array([v.co[:] for v in me.vertices])
bm=bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
lab=-np.ones(len(co),int); k=0
for v in bm.verts:
    if lab[v.index]>=0: continue
    st=[v]; lab[v.index]=k
    while st:
        x=st.pop()
        for e in x.link_edges:
            y=e.other_vert(x)
            if lab[y.index]<0: lab[y.index]=k; st.append(y)
    k+=1
np.save('/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/lab.npy',lab)
cnt=np.bincount(lab)
order=np.argsort(-cnt)
for i in order[:60]:
    c=co[lab==i]; print(i,cnt[i],c.min(0).round(2),c.max(0).round(2))
print('small parts total verts', cnt[cnt<50].sum(), (cnt<50).sum())
# merge-by-distance test
bm2=bmesh.new(); bm2.from_mesh(me)
r=bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=0.0005)
print('after merge verts', len(bm2.verts))
