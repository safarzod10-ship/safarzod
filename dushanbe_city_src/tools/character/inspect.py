import bpy, bmesh, numpy as np
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/safarzod/assets/characters/main_character/main_character.glb")
for o in bpy.data.objects:
    print(o.name, o.type, tuple(o.location), tuple(o.rotation_euler), tuple(o.scale), o.parent)
    if o.type=='MESH':
        me=o.data
        print(' verts',len(me.vertices),'polys',len(me.polygons),'mats',[m.name for m in me.materials], 'uv', [u.name for u in me.uv_layers])
        M=o.matrix_world
        co=np.array([ (M@v.co)[:] for v in me.vertices])
        print(' min',co.min(0),'max',co.max(0))
        np.save('/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/co.npy',co)
        # loose parts
        bm=bmesh.new(); bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        seen=set(); parts=[]
        for v in bm.verts:
            if v.index in seen: continue
            stack=[v]; comp=[]
            seen.add(v.index)
            while stack:
                x=stack.pop(); comp.append(x.index)
                for e in x.link_edges:
                    y=e.other_vert(x)
                    if y.index not in seen: seen.add(y.index); stack.append(y)
            parts.append(comp)
        print(' parts',len(parts), sorted([len(p) for p in parts])[-15:])
        for p in sorted(parts,key=len)[-12:]:
            c=co[p]; print('   part',len(p),c.min(0).round(3),c.max(0).round(3))
