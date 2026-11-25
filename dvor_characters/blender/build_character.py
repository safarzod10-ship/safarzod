"""Build one DVOR character end to end (Blender 4.5 LTS as the `bpy` Python module).

    /opt/dvor-venv/bin/python blender/build_character.py --char technik

Writes (paths relative to dvor_characters/):
    textures/<NAME>_atlas.png      512x512 colour atlas (face + swatches)
    source/<NAME>.blend            editable master (rig, LOD0, LOD1, 7 actions, packed atlas)
    export/raw/<NAME>.glb          unoptimised GLB straight from Blender
    export/raw/<NAME>.build.json   measured mesh/rig/clip report
"""
import argparse
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import anims  # noqa: E402
import dvor_lib as L  # noqa: E402

LOD1_TARGET = {"technik": 1350, "tank": 1350, "sprinter": 1350}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True, choices=["technik", "tank", "sprinter"])
    args = ap.parse_args()
    C = importlib.import_module(f"char_{args.char}")

    L.reset_scene()
    atlas = L.Atlas(C.PALETTE)
    tex_path = os.path.join(ROOT, "textures", f"{C.NAME}_atlas.png")
    L.paint_atlas(atlas, C.paint_face, tex_path)
    mat = L.make_material(f"M_{C.NAME}", tex_path)

    J = C.joints()
    kit = L.Kit(C.NAME, atlas)
    C.build(kit)

    rig = L.build_armature(C.NAME, J)
    lod0 = L.build_mesh_object(kit, J, mat, rig)
    lod1 = L.make_lod(lod0, rig, LOD1_TARGET[args.char])

    clips = {}
    for clip in L.CLIPS:
        keys, loop, extra = anims.LIBRARY[clip](C.ROLE)
        act = L.make_action(rig, clip, keys, loop, extra)
        clips[clip] = {
            "frames": [keys[0][0], keys[-1][0]],
            "duration_s": round((keys[-1][0] - keys[0][0]) / L.FPS, 3),
            "loop": loop,
            **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in extra.items()},
        }
    L.set_rest(rig)

    # collections for a tidy master file
    for name, objs in (("RIG", [rig]), ("LOD", [lod0, lod1])):
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
        for o in objs:
            for c in o.users_collection:
                c.objects.unlink(o)
            col.objects.link(o)

    blend_path = os.path.join(ROOT, "source", f"{C.NAME}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)

    raw = os.path.join(ROOT, "export", "raw", f"{C.NAME}.glb")
    L.export_glb(raw, [rig, lod0, lod1])

    report = {
        "character": C.NAME,
        "blender": bpy.app.version_string,
        "lod0": L.mesh_report(lod0),
        "lod1": L.mesh_report(lod1),
        "bones": len(rig.data.bones),
        "bone_names": [b.name for b in rig.data.bones],
        "parts": len(kit.parts),
        "clips": clips,
        "atlas": {"path": os.path.relpath(tex_path, ROOT), "size": [L.ATLAS, L.ATLAS]},
        "files": {
            "blend_bytes": os.path.getsize(blend_path),
            "raw_glb_bytes": os.path.getsize(raw),
            "atlas_png_bytes": os.path.getsize(tex_path),
        },
    }
    L.write_json(os.path.join(ROOT, "export", "raw", f"{C.NAME}.build.json"), report)
    print("REPORT", report["lod0"], report["lod1"], report["files"])


if __name__ == "__main__":
    main()
