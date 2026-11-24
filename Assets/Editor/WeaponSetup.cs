using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

/// Builds Resources/Weapons/<key>.prefab from Assets/Weapons/Src/<key>/<key>.gltf (already normalised by tools/chars/wpn_cfg.py:
/// barrel +Z, up +Y, metres, origin at the pistol grip) and the marker table Assets/Weapons/Src/weapons.json.
/// Unity -batchmode -nographics -quit -executeMethod WeaponSetup.BuildWeapons
public static class WeaponSetup
{
    [System.Serializable] class MarkerCfg { public string name; public float[] p, f, u; }
    [System.Serializable] class PartCfg { public string name; public string[] nodes; }
    [System.Serializable] class SplitCfg { public string node, part; public float[] box; }
    [System.Serializable] class WeaponCfg { public string key; public MarkerCfg[] markers; public PartCfg[] parts; public SplitCfg[] split; public float slide; }
    [System.Serializable] class Table { public WeaponCfg[] weapons; }
    const string Src = "Assets/Weapons/Src", Gen = "Assets/Weapons/Gen", OutDir = "Assets/Resources/Weapons";

    public static void BuildWeapons()
    {
        Directory.CreateDirectory(Gen); Directory.CreateDirectory(OutDir);
        var table = JsonUtility.FromJson<Table>(File.ReadAllText(Src + "/weapons.json"));
        foreach (var c in table.weapons) Build(c);
        AssetDatabase.SaveAssets();
        Debug.Log("WPN_DONE");
    }

    static Vector3 V(float[] a) => new Vector3(a[0], a[1], a[2]);

    static void Build(WeaponCfg c)
    {
        var src = AssetDatabase.LoadAssetAtPath<GameObject>($"{Src}/{c.key}/{c.key}.gltf");
        if (src == null) { Debug.LogError("WPN missing " + c.key); return; }
        var root = new GameObject(c.key);
        var model = Object.Instantiate(src, root.transform); model.name = "Model";
        foreach (var a in model.GetComponentsInChildren<Animator>()) Object.DestroyImmediate(a);
        var rig = root.AddComponent<WeaponRig>();
        var parts = new Dictionary<string, Transform>();
        Transform Part(string name)
        {
            if (!parts.TryGetValue(name, out var t)) { t = new GameObject(name).transform; t.SetParent(root.transform, false); parts[name] = t; }
            return t;
        }
        foreach (var s in c.split ?? new SplitCfg[0])
        {
            var node = model.GetComponentsInChildren<Transform>().First(t => t.name == s.node);
            var mf = node.GetComponentInChildren<MeshFilter>();
            var mr = mf.GetComponent<MeshRenderer>();
            Split(mf.sharedMesh, mf.transform.localToWorldMatrix, s.box, out var inside, out var outside);
            string path = $"{Gen}/{c.key}_{s.part}.asset"; AssetDatabase.DeleteAsset(path);
            inside.name = c.key + "_" + s.part; outside.name = c.key + "_" + s.node;
            AssetDatabase.CreateAsset(inside, path); AssetDatabase.AddObjectToAsset(outside, inside);
            mf.sharedMesh = outside;
            var g = new GameObject(s.part + "Mesh"); g.transform.SetParent(mf.transform, false);
            g.AddComponent<MeshFilter>().sharedMesh = inside; g.AddComponent<MeshRenderer>().sharedMaterials = mr.sharedMaterials;
            g.transform.SetParent(Part(s.part), true);
            Debug.Log($"WPN {c.key}: split {s.node}: {inside.triangles.Length / 3} tris -> {s.part}, {outside.triangles.Length / 3} stay");
        }
        foreach (var p in c.parts ?? new PartCfg[0])
        {
            var holder = Part(p.name); int n = 0;
            foreach (var name in p.nodes)
                foreach (var t in model.GetComponentsInChildren<Transform>().Where(t => t.name == name).ToArray()) { t.SetParent(holder, true); n++; }
            if (n == 0) Debug.LogError($"WPN {c.key}: part {p.name} matched no nodes");
        }
        foreach (var m in c.markers)
        {
            var t = new GameObject(m.name).transform; t.SetParent(root.transform, false);
            t.localPosition = V(m.p); t.localRotation = Quaternion.LookRotation(V(m.f), V(m.u));
            switch (m.name)
            {
                case "GripR": rig.gripR = t; break;
                case "GripL": rig.gripL = t; break;
                case "Muzzle": rig.muzzle = t; break;
                case "MagGrip": rig.magGrip = t; break;
                case "SlideGrip": rig.slideGrip = t; break;
            }
        }
        parts.TryGetValue("Mag", out rig.mag); parts.TryGetValue("Slide", out rig.slide);
        rig.slideTravel = c.slide; rig.boltAction = c.key == "awp";
        var b = new Bounds(); bool first = true; int tris = 0;
        foreach (var r in root.GetComponentsInChildren<MeshRenderer>())
        {
            if (first) { b = r.bounds; first = false; } else b.Encapsulate(r.bounds);
            tris += r.GetComponent<MeshFilter>().sharedMesh.triangles.Length / 3;
        }
        if (b.size.z > 0.5f) rig.butt = new Vector3(0, 0.02f, b.min.z);
        Debug.Log($"WPN {c.key}: bounds min {b.min:F3} max {b.max:F3}, {tris} tris, mag {(rig.mag ? "separate" : "fixed")}, slide {(rig.slide ? "separate" : "fixed")}");
        PrefabUtility.SaveAsPrefabAsset(root, $"{OutDir}/{c.key}.prefab");
        Object.DestroyImmediate(root);

    }

    /// Splits a mesh into the connected pieces lying entirely inside box [ymin,ymax,zmin,zmax] (in root space) and the rest.
    static void Split(Mesh src, Matrix4x4 toRoot, float[] box, out Mesh inside, out Mesh outside)
    {
        var v = src.vertices; var tri = src.triangles; int n = v.Length;
        // union vertices that share a triangle or a position (UV seams duplicate vertices)
        var parent = new int[n]; for (int i = 0; i < n; i++) parent[i] = i;
        int Find(int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
        void Union(int a, int b) { a = Find(a); b = Find(b); if (a != b) parent[a] = b; }
        for (int i = 0; i < tri.Length; i += 3) { Union(tri[i], tri[i + 1]); Union(tri[i], tri[i + 2]); }
        var byPos = new Dictionary<Vector3Int, int>();
        for (int i = 0; i < n; i++)
        {
            var key = Vector3Int.RoundToInt(v[i] * 20000f);
            if (byPos.TryGetValue(key, out int j)) Union(i, j); else byPos[key] = i;
        }
        var ok = new Dictionary<int, bool>();
        for (int i = 0; i < n; i++)
        {
            Vector3 p = toRoot.MultiplyPoint3x4(v[i]);
            bool inBox = p.y >= box[0] && p.y <= box[1] && p.z >= box[2] && p.z <= box[3];
            int r = Find(i);
            ok[r] = (!ok.TryGetValue(r, out bool cur) || cur) && inBox;
        }
        var cb = new Dictionary<int, Bounds>(); var cn = new Dictionary<int, int>();
        for (int i = 0; i < n; i++)
        {
            int r = Find(i); Vector3 p = toRoot.MultiplyPoint3x4(v[i]);
            if (cb.TryGetValue(r, out var bb)) { bb.Encapsulate(p); cb[r] = bb; cn[r]++; } else { cb[r] = new Bounds(p, Vector3.zero); cn[r] = 1; }
        }
        foreach (var kv in cb.OrderByDescending(k => cn[k.Key]).Take(14)) Debug.Log($"WPN   piece verts {cn[kv.Key]} y {kv.Value.min.y:F3}..{kv.Value.max.y:F3} z {kv.Value.min.z:F3}..{kv.Value.max.z:F3} inside {ok[kv.Key]}");
        Mesh Make(bool want)
        {
            var remap = new int[n]; for (int i = 0; i < n; i++) remap[i] = -1; int cnt = 0;
            var subs = new List<List<int>>();
            for (int s = 0; s < src.subMeshCount; s++)
            {
                var t = src.GetTriangles(s); var o = new List<int>();
                for (int i = 0; i < t.Length; i += 3)
                {
                    if (ok[Find(t[i])] != want) continue;
                    for (int k = 0; k < 3; k++) { int vi = t[i + k]; if (remap[vi] < 0) remap[vi] = cnt++; o.Add(remap[vi]); }
                }
                subs.Add(o);
            }
            T[] Pick<T>(T[] a) { if (a == null || a.Length != n) return null; var o = new T[cnt]; for (int i = 0; i < n; i++) if (remap[i] >= 0) o[remap[i]] = a[i]; return o; }
            var m = new Mesh();
            m.vertices = Pick(v); m.normals = Pick(src.normals);
            var tg = Pick(src.tangents); if (tg != null) m.tangents = tg;
            var uv = Pick(src.uv); if (uv != null) m.uv = uv;
            m.subMeshCount = subs.Count;
            for (int s = 0; s < subs.Count; s++) m.SetTriangles(subs[s], s);
            m.RecalculateBounds();
            return m;
        }
        inside = Make(true); outside = Make(false);
    }
}
