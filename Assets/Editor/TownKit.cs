using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// Places the original Tajik architecture kit (Assets/Town/Kit/*.glb) on the Town level
/// (run with -executeMethod TownKit.Apply). Wall pieces are snapped to the real wall surface with a ray cast
/// and stood on the ground; floor props are skipped when they would overlap geometry or block a route,
/// a team start or the bomb site. Everything goes under one root object "TajikKit" so re-running replaces it.
public static class TownKit
{
    enum Mount { Wall, Floor }

    struct Place
    {
        public string piece; public Mount mount; public Vector3 pos; public Vector3 normal; public float lift, yaw;
        public Place(string p, Mount m, Vector3 pos, Vector3 n, float lift = 0f, float yaw = 0f) { piece = p; mount = m; this.pos = pos; normal = n; this.lift = lift; this.yaw = yaw; }
    }

    // Unity coordinates. Wall spots come from the flat-wall survey of the level (graffiti/walls.json, x negated);
    // the normal points from the wall into the street. The graffiti wall (x=-13.43, z=-12..-7) and the
    // south-east gate are left free.
    static readonly Place[] Places =
    {
        // carved doors set into house fronts
        new Place("door_khujand", Mount.Wall, new Vector3(-20.5f, 0, -8.5f), new Vector3(1, 0, 0)),
        new Place("door_khujand", Mount.Wall, new Vector3(5.5f, 0, 17.6f), new Vector3(0, 0, -1)),
        new Place("door_khujand", Mount.Wall, new Vector3(-17.0f, 0, -13.0f), new Vector3(0, 0, 1)),   // covers the plain door of the mesh
        // lattice windows
        new Place("window_panjara", Mount.Wall, new Vector3(-20.5f, 0, -5.5f), new Vector3(1, 0, 0), 0.95f),
        new Place("window_panjara", Mount.Wall, new Vector3(-20.5f, 0, 11.0f), new Vector3(1, 0, 0), 0.95f),
        new Place("window_panjara", Mount.Wall, new Vector3(-14.0f, 0, 17.6f), new Vector3(0, 0, -1), 0.95f),
        new Place("window_panjara", Mount.Wall, new Vector3(-18.5f, 0, -13.0f), new Vector3(0, 0, 1), 0.95f),
        // majolica panels
        new Place("tile_panel_majolica", Mount.Wall, new Vector3(-20.5f, 0, 6.5f), new Vector3(1, 0, 0), 0.7f),
        new Place("tile_panel_majolica", Mount.Wall, new Vector3(11.5f, 0, 17.6f), new Vector3(0, 0, -1), 0.7f),
        // floor props: courtyard life (checked for free space and kept away from routes)
        new Place("tapchan", Mount.Floor, new Vector3(-18.6f, 0, 2.2f), new Vector3(1, 0, 0)),
        new Place("tandoor", Mount.Floor, new Vector3(-18.8f, 0, 13.0f), new Vector3(1, 0, 0)),
        new Place("grape_trellis", Mount.Floor, new Vector3(-18.0f, 0, 2.2f), new Vector3(1, 0, 0)),
        new Place("tapchan", Mount.Floor, new Vector3(9.0f, 0, 15.6f), new Vector3(0, 0, -1)),
    };

    const float KeepAwayFromMarkers = 3.5f;

    public static void Apply()
    {
        var scene = EditorSceneManager.OpenScene("Assets/Scenes/Town.unity", OpenSceneMode.Single);
        var old = GameObject.Find("TajikKit");
        if (old != null) Object.DestroyImmediate(old);
        Physics.SyncTransforms();
        var root = new GameObject("TajikKit");
        root.isStatic = true;

        var markers = new List<Vector3>();
        foreach (var n in new[] { "BombSite", "SpawnA", "SpawnB" }) { var m = GameObject.Find(n); if (m != null) markers.Add(m.transform.position); }
        var spawnParents = new[] { "SpawnA", "SpawnB" };
        foreach (var n in spawnParents) { var m = GameObject.Find(n); if (m != null) foreach (Transform c in m.transform) markers.Add(c.position); }

        int placed = 0, skipped = 0;
        var placedBounds = new List<Bounds>();
        foreach (var p in Places)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Town/Kit/" + p.piece + ".glb");
            if (prefab == null) { Debug.LogWarning("KIT_MISSING " + p.piece); skipped++; continue; }
            Vector3 n = p.normal.normalized;

            Vector3 pos; Quaternion rot = Quaternion.LookRotation(n, Vector3.up) * Quaternion.Euler(0, p.yaw, 0);
            if (p.mount == Mount.Wall)
            {
                // find the exact wall surface at chest height, then the ground in front of it
                Vector3 probe = new Vector3(p.pos.x, 1.4f, p.pos.z) + n * 2.5f;
                if (!Physics.Raycast(probe, -n, out var wh, 5f)) { Debug.LogWarning($"KIT_SKIP {p.piece} at {p.pos}: no wall"); skipped++; continue; }
                Vector3 wn = wh.normal; wn.y = 0; wn.Normalize();
                if (Vector3.Dot(wn, n) < 0.8f) { Debug.LogWarning($"KIT_SKIP {p.piece} at {p.pos}: wall faces {wh.normal}"); skipped++; continue; }
                rot = Quaternion.LookRotation(wn, Vector3.up);
                float ground = Ground(wh.point + wn * 0.4f);
                float out_ = p.piece == "door_khujand" ? 0.08f : p.piece == "window_panjara" ? 0.06f : 0.012f;
                pos = new Vector3(wh.point.x, ground + p.lift, wh.point.z) + wn * out_;
            }
            else
            {
                pos = new Vector3(p.pos.x, Ground(p.pos), p.pos.z);
            }

            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.transform);
            go.name = p.piece;
            go.transform.SetPositionAndRotation(pos, rot);
            var b = WorldBounds(go);

            if (p.mount == Mount.Floor)
            {
                string why = null;
                foreach (var m in markers) { var flat = m; flat.y = b.center.y; if (b.SqrDistance(flat) < KeepAwayFromMarkers * KeepAwayFromMarkers) { why = "near marker " + m; break; } }
                if (why == null)
                {
                    var test = new Bounds(b.center + Vector3.up * 0.15f, b.size - new Vector3(0.1f, 0.3f, 0.1f));
                    foreach (var c in Physics.OverlapBox(test.center, test.extents, Quaternion.identity))
                        if (!c.transform.IsChildOf(root.transform) && c.bounds.size.y > 0.4f) { why = "overlaps " + c.name; break; }
                }
                if (why == null && p.piece != "grape_trellis")
                    foreach (var pb in placedBounds) if (pb.Intersects(b)) { why = "overlaps placed prop"; break; }
                if (why != null) { Debug.LogWarning($"KIT_SKIP {p.piece} at {p.pos}: {why}"); Object.DestroyImmediate(go); skipped++; continue; }
                placedBounds.Add(b);
            }

            Finish(go, p.piece);
            Debug.Log($"KIT_PLACED {p.piece} pos={pos} yaw={rot.eulerAngles.y:0} size={b.size}");
            placed++;
        }

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
        Debug.Log($"KIT_DONE placed={placed} skipped={skipped}");
    }

    /// Static, shadows on, solid colliders for everything a player or bullet should hit (not leaves).
    static void Finish(GameObject go, string piece)
    {
        foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = true;
        foreach (var r in go.GetComponentsInChildren<MeshRenderer>(true))
        {
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On; r.receiveShadows = true;
            bool leaves = r.name.Contains("leaves") || r.name.Contains("leaf");
            if (piece == "tile_panel_majolica" || leaves) continue;   // flat on the wall / foliage: no collider
            var mf = r.GetComponent<MeshFilter>();
            if (mf != null && mf.sharedMesh != null && r.GetComponent<Collider>() == null) r.gameObject.AddComponent<MeshCollider>().sharedMesh = mf.sharedMesh;
        }
    }

    /// Highest level surface under the point, ignoring kit pieces placed earlier.
    static float Ground(Vector3 at)
    {
        float best = float.NegativeInfinity;
        foreach (var h in Physics.RaycastAll(new Vector3(at.x, at.y + 3f, at.z), Vector3.down, 8f))
        {
            var t = h.collider.transform; bool kit = false;
            while (t != null) { if (t.name == "TajikKit") { kit = true; break; } t = t.parent; }
            if (!kit && h.point.y > best) best = h.point.y;
        }
        return float.IsNegativeInfinity(best) ? 0f : best;
    }

    static Bounds WorldBounds(GameObject go)
    {
        var rs = go.GetComponentsInChildren<Renderer>();
        if (rs.Length == 0) return new Bounds(go.transform.position, Vector3.one * 0.1f);
        var b = rs[0].bounds; foreach (var r in rs) b.Encapsulate(r.bounds);
        return b;
    }
}
