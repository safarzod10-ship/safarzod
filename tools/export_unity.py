# Export the HYPOFANGS Unity build into compact JSON for the web port.
#   python -I export_unity.py <HYPOFANGS_Data dir> <sprites.json from the sprite export> <out dir>
# Writes <out>/scenes/level{0,1,2}.json (GameObject tree with local transforms and components)
# and <out>/assets.json (ScriptableObjects and Resources prefabs the code loads by name).
# References are rewritten as: "S:<sprite file>" sprite, "A:<clip>" audio clip, "T:<texture>" texture,
# {"n": node} GameObject in the same file, {"n": node, "c": i} component i of that node, "O:<name>" other asset.
import sys, os, json, math, struct
import UnityPy
import UnityPy.helpers.TypeTreeHelper as TTH
TTH.read_typetree_boost = None  # the C reader ignores the alignment flag patched below
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

data_dir, sprites_json, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
env = UnityPy.load(data_dir)


class FixedGen(TypeTreeGenerator):
    def get_nodes_up(self, assembly, fullname):
        node = super().get_nodes_up(assembly, fullname)
        if node is not None:
            for c in node.m_Children:
                if c.m_Name == "m_Enabled":
                    c.m_MetaFlag = (c.m_MetaFlag or 0) | 0x4000  # UInt8 followed by 4-byte alignment
        return node


gen = FixedGen("6000.6.7f1")
gen.load_local_dll_folder(os.path.join(data_dir, "Managed"))
env.typetree_generator = gen

SP = json.load(open(sprites_json))
index = {}
for o in env.objects:
    index[(o.assets_file.name, o.path_id)] = o


def fname(af, fid):
    if fid == 0:
        return af.name
    try:
        return os.path.basename(af.externals[fid - 1].path)
    except Exception:
        return f"ext{fid}"


names = {}
def obj_name(o):
    k = (o.assets_file.name, o.path_id)
    if k not in names:
        try:
            names[k] = o.peek_name() or ""
        except Exception:
            try:
                names[k] = o.read().m_Name
            except Exception:
                names[k] = ""
    return names[k]


scripts = {}
def script_of(af, s):
    if not s:
        return None
    k = (fname(af, s["m_FileID"]), s["m_PathID"])
    if k not in scripts:
        o = index.get(k)
        scripts[k] = None
        if o:
            try:
                d = o.read_typetree()
                scripts[k] = (d.get("m_Namespace") + "." if d.get("m_Namespace") else "") + d.get("m_ClassName", "?")
            except Exception:
                pass
    return scripts[k]


textures_used = set()
audio_used = set()
sprites_used = set()

# ---------------------------------------------------------------- reference rewriting
class Ctx:
    def __init__(self, af, local):
        self.af = af
        self.local = local  # path_id -> ("go", node) | ("comp", node, ci)


def ref(v, ctx):
    fid, pid = v["m_FileID"], v["m_PathID"]
    if pid == 0:
        return None
    f = fname(ctx.af, fid)
    if ctx.local is not None and f == ctx.af.name and pid in ctx.local:
        L = ctx.local[pid]
        return {"n": L[1]} if L[0] == "go" else {"n": L[1], "c": L[2]}
    tgt = index.get((f, pid))
    if tgt is None:
        return None
    t = tgt.type.name
    key = f"{f}:{pid}"
    if t == "Sprite":
        s = SP.get(key)
        if s:
            sprites_used.add(s["file"])
            return "S:" + s["file"]
        return None
    if t == "AudioClip":
        n = obj_name(tgt)
        audio_used.add(n)
        return "A:" + n
    if t == "Texture2D":
        n = obj_name(tgt)
        textures_used.add(key)
        return "T:" + n
    if t == "MonoScript":
        return None
    return "O:" + (obj_name(tgt) or t) + "@" + key


def conv(v, ctx):
    if isinstance(v, dict):
        if set(v.keys()) == {"m_FileID", "m_PathID"}:
            return ref(v, ctx)
        out = {}
        for k, x in v.items():
            if k in ("m_GameObject", "m_Script", "m_ObjectHideFlags", "m_CorrespondingSourceObject", "m_PrefabInstance", "m_PrefabAsset", "m_EditorHideFlags", "m_EditorClassIdentifier"):
                continue
            out[k] = conv(x, ctx)
        return out
    if isinstance(v, list):
        return [conv(x, ctx) for x in v]
    if isinstance(v, float):
        return round(v, 5)
    if isinstance(v, (bytes, bytearray)):
        return None
    return v


def col(c):
    return [round(c["r"], 4), round(c["g"], 4), round(c["b"], 4), round(c["a"], 4)]


def col32(c):
    if not c:
        return [1, 1, 1, 1]
    if "rgba" in c:
        v = c["rgba"]
        return [round((v & 255) / 255, 4), round(((v >> 8) & 255) / 255, 4), round(((v >> 16) & 255) / 255, 4), round(((v >> 24) & 255) / 255, 4)]
    return col(c)


SORT_RANK = {}
def layer_rank(lid):
    return SORT_RANK.get(lid, 3)


def v2(v):
    return [round(v["x"], 5), round(v["y"], 5)]


# ---------------------------------------------------------------- Light2D (managed reference registry breaks the reader)
class R:
    def __init__(s, b): s.b = b; s.o = 0
    def i(s): v = struct.unpack_from("<i", s.b, s.o)[0]; s.o += 4; return v
    def q(s): v = struct.unpack_from("<q", s.b, s.o)[0]; s.o += 8; return v
    def f(s): v = struct.unpack_from("<f", s.b, s.o)[0]; s.o += 4; return v
    def u8a(s): v = s.b[s.o]; s.o += 4; return v
    def ptr(s): return (s.i(), s.q())
    def str(s):
        n = s.i(); v = s.b[s.o:s.o + n].decode("utf-8", "replace"); s.o += n; s.o = (s.o + 3) & ~3; return v


def light2d(o):
    r = R(o.get_raw_data())
    r.ptr(); en = r.u8a(); r.ptr(); r.str()
    d = {"T": "light", "e": en}
    r.i(); d["type"] = r.i(); r.i(); r.q()
    d["falloff"] = round(r.f(), 4); d["color"] = [round(r.f(), 4) for _ in range(4)]; d["int"] = round(r.f(), 4); r.f(); r.u8a()
    n = r.i(); [r.i() for _ in range(n)]
    r.ptr(); r.ptr(); r.i(); r.u8a(); r.i(); r.f(); r.i(); r.u8a(); r.u8a(); r.f(); r.f(); r.f(); r.u8a(); r.f(); r.i()
    [r.f() for _ in range(6)]
    d["inA"], d["outA"], d["inR"], d["outR"] = [round(r.f(), 4) for _ in range(4)]
    d["sides"] = r.i(); r.f(); d["pr"] = round(r.f(), 4); d["fs"] = round(r.f(), 4); r.f(); r.f()
    n = r.i(); d["path"] = [[round(r.f(), 4), round(r.f(), 4), round(r.f(), 4)][:2] for _ in range(n)]
    return d


def raw_script(o, af):
    b = o.get_raw_data()
    fid, pid = struct.unpack_from("<iq", b, 16)
    return script_of(af, {"m_FileID": fid, "m_PathID": pid})


# ---------------------------------------------------------------- component conversion
def quat_z(q):
    # rotation about z in degrees (2D); keep x/y flips via sign of w
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    siny = 2 * (w * z + x * y)
    cosy = 1 - 2 * (y * y + z * z)
    return math.degrees(math.atan2(siny, cosy))


MATERIAL_LIT = {}
def lit_of(mats, af):
    if not mats:
        return 0
    m = mats[0]
    if m is None or m["m_PathID"] == 0:
        return 0
    k = (fname(af, m["m_FileID"]), m["m_PathID"])
    if k not in MATERIAL_LIT:
        o = index.get(k)
        n = obj_name(o) if o else ""
        MATERIAL_LIT[k] = 1 if "Lit" in n and "Unlit" not in n else 0
    return MATERIAL_LIT[k]


def comp_record(o, ctx, tile_assets):
    t = o.type.name
    af = ctx.af
    if t == "MonoBehaviour":
        sn = raw_script(o, af)
        if sn == "UnityEngine.Rendering.Universal.Light2D":
            return light2d(o)
        try:
            d = o.read_typetree()
        except Exception as e:
            return {"T": "mb", "s": sn, "err": str(e)[:80]}
        rec = {"T": "mb", "s": sn, "e": d.get("m_Enabled", 1)}
        if sn and (sn.startswith("UnityEngine.UI.") and sn not in ("UnityEngine.UI.Image", "UnityEngine.UI.Text")):
            return rec
        if sn and sn.startswith("UnityEngine.Rendering.Universal.UniversalAdditional"):
            return None
        rec["d"] = conv(d, ctx)
        rec["d"].pop("m_Enabled", None)
        rec["d"].pop("m_Name", None)
        return rec
    d = o.read_typetree()
    en = d.get("m_Enabled", 1)
    if t == "SpriteRenderer":
        r = {"T": "sr", "e": en, "s": ref(d["m_Sprite"], ctx) if d.get("m_Sprite") else None, "o": d["m_SortingOrder"], "l": layer_rank(d["m_SortingLayerID"]),
             "lit": lit_of(d.get("m_Materials"), af)}
        c = col(d["m_Color"])
        if c != [1, 1, 1, 1]: r["col"] = c
        if d["m_FlipX"]: r["fx"] = 1
        if d["m_FlipY"]: r["fy"] = 1
        if d["m_DrawMode"]:
            r["dm"] = d["m_DrawMode"]; r["sz"] = v2(d["m_Size"]); r["tm"] = d.get("m_SpriteTileMode", 0)
        if d.get("m_MaskInteraction"): r["mask"] = d["m_MaskInteraction"]
        return r
    if t == "BoxCollider2D":
        r = {"T": "box", "e": en, "off": v2(d["m_Offset"]), "size": v2(d["m_Size"])}
        if d.get("m_IsTrigger"): r["trig"] = 1
        if d.get("m_UsedByEffector"): r["eff"] = 1
        if d.get("m_EdgeRadius"): r["er"] = d["m_EdgeRadius"]
        return r
    if t == "CapsuleCollider2D":
        r = {"T": "cap", "e": en, "off": v2(d["m_Offset"]), "size": v2(d["m_Size"]), "dir": d["m_Direction"]}
        if d.get("m_IsTrigger"): r["trig"] = 1
        return r
    if t == "CircleCollider2D":
        r = {"T": "circ", "e": en, "off": v2(d["m_Offset"]), "r": d["m_Radius"]}
        if d.get("m_IsTrigger"): r["trig"] = 1
        return r
    if t == "PolygonCollider2D":
        return {"T": "poly", "e": en, "off": v2(d["m_Offset"]), "trig": d.get("m_IsTrigger", 0), "paths": [[v2(p) for p in path] for path in d["m_Points"]["m_Paths"]]}
    if t == "Rigidbody2D":
        return {"T": "rb", "bt": d["m_BodyType"], "g": d["m_GravityScale"], "m": d.get("m_Mass", 1), "fr": d.get("m_Constraints", 0)}
    if t == "PlatformEffector2D":
        return {"T": "peff", "e": en, "oneWay": d.get("m_UseOneWay", 1), "arc": d.get("m_SurfaceArc", 180)}
    if t == "Grid":
        return {"T": "grid", "cell": v2(d["m_CellSize"])}
    if t == "TilemapRenderer":
        return {"T": "tmr", "e": en, "o": d["m_SortingOrder"], "l": layer_rank(d["m_SortingLayerID"]), "lit": lit_of(d.get("m_Materials"), af)}
    if t == "TilemapCollider2D":
        return {"T": "tmc", "e": en}
    if t == "Tilemap":
        assets = [x["m_Data"] for x in d["m_TileAssetArray"]]
        sprites = [x["m_Data"] for x in d["m_TileSpriteArray"]]
        colors = [col(x["m_Data"]) for x in d["m_TileColorArray"]]
        mats = [x["m_Data"] for x in d["m_TileMatrixArray"]]
        sp_keys = [ref(s, ctx) if s else None for s in sprites]
        coll = []
        for a in assets:
            ct = 0
            if a and a["m_PathID"]:
                k = (fname(af, a["m_FileID"]), a["m_PathID"])
                if k not in tile_assets:
                    try:
                        tile_assets[k] = index[k].read_typetree().get("m_ColliderType", 0)
                    except Exception:
                        tile_assets[k] = 0
                ct = tile_assets[k]
            coll.append(ct)
        mat_list = [[round(m["e00"], 4), round(m["e01"], 4), round(m["e10"], 4), round(m["e11"], 4), round(m["e03"], 4), round(m["e13"], 4)] for m in mats]
        tiles = []
        for pos, ti in d["m_Tiles"]:
            if ti["m_TileSpriteIndex"] >= len(sp_keys) and ti["m_TileIndex"] >= len(coll):
                continue
            si = ti["m_TileSpriteIndex"] if ti["m_TileSpriteIndex"] < len(sp_keys) else -1
            tiles.append([pos["x"], pos["y"], si, ti["m_TileColorIndex"], ti["m_TileMatrixIndex"], coll[ti["m_TileIndex"]] if ti["m_TileIndex"] < len(coll) else 0])
        return {"T": "tm", "e": en, "sprites": sp_keys, "colors": colors, "mats": mat_list, "color": col(d["m_Color"]),
                "anchor": [d["m_TileAnchor"]["x"], d["m_TileAnchor"]["y"]], "tiles": tiles}
    if t == "Camera":
        return {"T": "cam", "size": d["orthographic size"], "bg": col(d["m_BackGroundColor"])}
    if t == "TextMesh":
        return {"T": "text", "text": d["m_Text"], "fs": d["m_FontSize"], "cs": d["m_CharacterSize"], "ls": d["m_LineSpacing"], "anchor": d["m_Anchor"],
                "align": d["m_Alignment"], "col": col32(d.get("m_Color")), "font": ref(d["m_Font"], ctx) if d.get("m_Font") else None,
                "style": d.get("m_FontStyle", 0), "rich": d.get("m_RichText", 1)}
    if t == "MeshRenderer":
        return {"T": "mr", "e": en, "o": d["m_SortingOrder"], "l": layer_rank(d["m_SortingLayerID"])}
    if t == "AudioSource":
        return {"T": "audio", "e": en, "clip": ref(d["m_audioClip"], ctx) if d.get("m_audioClip") else None, "vol": d.get("m_Volume", 1), "loop": d.get("Loop", 0),
                "awake": d.get("m_PlayOnAwake", 0), "pitch": d.get("m_Pitch", 1)}
    if t == "Animator":
        return {"T": "animator", "e": en}
    if t == "SpriteMask":
        return {"T": "smask", "e": en, "s": ref(d["m_Sprite"], ctx)}
    if t == "CanvasGroup":
        return {"T": "cg", "e": en, "a": d.get("m_Alpha", 1)}
    if t == "Canvas":
        return {"T": "canvas", "e": en, "mode": d.get("m_RenderMode", 0), "o": d.get("m_SortingOrder", 0)}
    if t == "RectTransform":
        return None
    return {"T": t}


def export_hierarchy(file_name, root_filter=None):
    """Export every GameObject of one serialized file (a scene or the resources file) as a node list."""
    objs = [o for o in env.objects if o.assets_file.name == file_name]
    af = objs[0].assets_file
    gos = {o.path_id: o for o in objs if o.type.name == "GameObject"}
    trs = {}
    go_data = {}
    for pid, o in gos.items():
        go_data[pid] = o.read_typetree()
    for o in objs:
        if o.type.name in ("Transform", "RectTransform"):
            trs[o.path_id] = o.read_typetree()
    tr_of_go = {}
    for pid, t in trs.items():
        g = t["m_GameObject"]["m_PathID"]
        tr_of_go[g] = pid
    children = {}
    roots = []
    for pid, t in trs.items():
        f = t["m_Father"]["m_PathID"]
        if f:
            children.setdefault(f, []).append(pid)
        else:
            roots.append(pid)
    # order roots like the scene file (by path id) and children by m_Children order
    order = []
    def walk(tid, parent):
        order.append((tid, parent))
        me = len(order) - 1
        kids = [c["m_PathID"] for c in trs[tid]["m_Children"] if c["m_PathID"] in trs]
        for k in kids:
            walk(k, me)
    if root_filter:
        roots = [r for r in roots if root_filter(go_data.get(trs[r]["m_GameObject"]["m_PathID"], {}).get("m_Name", ""))]
    for r in sorted(roots):
        walk(r, -1)
    local = {}
    node_go = []
    for i, (tid, parent) in enumerate(order):
        g = trs[tid]["m_GameObject"]["m_PathID"]
        node_go.append(g)
        local[g] = ("go", i)
        local[tid] = ("comp", i, -1)
        for ci, c in enumerate(go_data[g]["m_Component"]):
            cp = c["component"]["m_PathID"]
            local[cp] = ("comp", i, ci)
    ctx = Ctx(af, local)
    tile_assets = {}
    nodes = []
    for i, (tid, parent) in enumerate(order):
        g = node_go[i]
        gd = go_data[g]
        t = trs[tid]
        lp, lr, ls = t["m_LocalPosition"], t["m_LocalRotation"], t["m_LocalScale"]
        n = {"n": gd["m_Name"], "p": parent}
        if not gd.get("m_IsActive", 1): n["a"] = 0
        if gd.get("m_Layer"): n["l"] = gd["m_Layer"]
        if gd.get("m_Tag"): n["tag"] = gd["m_Tag"]
        tr = [round(lp["x"], 5), round(lp["y"], 5), round(quat_z(lr), 4), round(ls["x"], 5), round(ls["y"], 5), round(lp["z"], 4)]
        n["t"] = tr
        if "m_AnchoredPosition" in t:
            n["rt"] = {"amin": v2(t["m_AnchorMin"]), "amax": v2(t["m_AnchorMax"]), "pos": v2(t["m_AnchoredPosition"]), "size": v2(t["m_SizeDelta"]), "pivot": v2(t["m_Pivot"])}
        comps = []
        for ci, c in enumerate(gd["m_Component"]):
            cp = c["component"]["m_PathID"]
            co = index.get((file_name, cp))
            if co is None or co.type.name in ("Transform",):
                comps.append(None)
                continue
            try:
                comps.append(comp_record(co, ctx, tile_assets))
            except Exception as e:
                comps.append({"T": co.type.name, "err": str(e)[:100]})
        n["c"] = comps
        nodes.append(n)
    return nodes


def export_asset(o):
    ctx = Ctx(o.assets_file, None)
    d = o.read_typetree()
    return {"s": script_of(o.assets_file, d.get("m_Script")), "d": conv(d, ctx)}


for o in env.objects:
    if o.type.name == "TagManager":
        for i, sl in enumerate(o.read_typetree().get("m_SortingLayers", [])):
            SORT_RANK[sl["uniqueID"]] = i
os.makedirs(os.path.join(out_dir, "scenes"), exist_ok=True)
for lv in ("level0", "level1", "level2"):
    nodes = export_hierarchy(lv)
    json.dump(nodes, open(os.path.join(out_dir, "scenes", lv + ".json"), "w"), separators=(",", ":"))
    print(lv, len(nodes), "nodes")

assets = {}
for o in env.objects:
    if o.assets_file.name.startswith("level") or o.type.name != "MonoBehaviour":
        continue
    try:
        d = o.read_typetree()
    except Exception:
        continue
    sn = script_of(o.assets_file, d.get("m_Script"))
    if sn in ("HypoFangs.GameAssets", "HypoFangs.CombatSoundBank", "HypoFangs.MusicCatalog", "HypoFangs.LevelMapData", "HypoFangs.SurfaceSpriteData"):
        assets[sn.split(".")[-1]] = export_asset(o)
# Resources prefabs (pause menu, dialogue presenters) as small hierarchies
prefabs = {}
for o in env.objects:
    if o.assets_file.name == "resources.assets" and o.type.name == "GameObject":
        d = o.read_typetree()
        prefabs.setdefault(d["m_Name"], 0)
assets["_resourceGameObjects"] = sorted(prefabs)
res_nodes = export_hierarchy("resources.assets")
json.dump(res_nodes, open(os.path.join(out_dir, "scenes", "resources.json"), "w"), separators=(",", ":"))
# the shared fallen pose lives in a prefab: keep its Art transform
dp = assets["GameAssets"]["d"].get("playerDeathPose")
if isinstance(dp, str) and "@" in dp:
    f, pid = dp.split("@")[1].split(":")
    sr = index[(f, int(pid))].read_typetree()
    go = index[(f, sr["m_GameObject"]["m_PathID"])].read_typetree()
    for c in go["m_Component"]:
        co = index.get((f, c["component"]["m_PathID"]))
        if co is not None and co.type.name == "Transform":
            t = co.read_typetree()
            assets["GameAssets"]["d"]["playerDeathPose"] = {"pos": v2(t["m_LocalPosition"]), "rot": round(quat_z(t["m_LocalRotation"]), 4),
                                                           "scale": v2(t["m_LocalScale"]), "sprite": ref(sr["m_Sprite"], Ctx(index[(f, int(pid))].assets_file, None))}
json.dump(assets, open(os.path.join(out_dir, "assets.json"), "w"), separators=(",", ":"))
os.makedirs(os.path.join(out_dir, "textures"), exist_ok=True)
for key in sorted(textures_used):
    f, pid = key.split(":")
    o = index[(f, int(pid))]
    tex = o.read()
    tex.image.save(os.path.join(out_dir, "textures", tex.m_Name + ".png"))
# sorting layers and physics layer names
tm = [o for o in env.objects if o.type.name == "TagManager"]
if tm:
    d = tm[0].read_typetree()
    json.dump({"layers": d.get("layers"), "sorting": [{"name": s["name"], "id": s["uniqueID"]} for s in d.get("m_SortingLayers", [])]},
              open(os.path.join(out_dir, "tags.json"), "w"))
json.dump({"sprites": sorted(sprites_used), "audio": sorted(audio_used), "textures": sorted(textures_used)}, open(os.path.join(out_dir, "used.json"), "w"), indent=0)
print("sprites", len(sprites_used), "audio", len(audio_used), "textures", len(textures_used))
# 9-slice borders (left, bottom, right, top in pixels) of sprites that have one
borders = {}
for o in env.objects:
    if o.type.name != "Sprite":
        continue
    s = SP.get(f"{o.assets_file.name}:{o.path_id}")
    if not s:
        continue
    b = o.read_typetree().get("m_Border")
    if b and any(b[k] for k in ("x", "y", "z", "w")):
        borders[s["file"]] = [b["x"], b["y"], b["z"], b["w"]]
json.dump(borders, open(os.path.join(out_dir, "borders.json"), "w"))
print("borders", len(borders))
