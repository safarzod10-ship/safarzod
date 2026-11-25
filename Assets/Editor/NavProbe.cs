using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;

/// Diagnostic: builds the Town navmesh like the game does and prints the path between two points
/// (-executeMethod NavProbe.Run -from x,z -to x,z).
public static class NavProbe
{
    static Vector3 Arg(string name, Vector3 def)
    {
        var a = System.Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < a.Length; i++) if (a[i] == name) { var p = a[i + 1].Split(','); return new Vector3(float.Parse(p[0], System.Globalization.CultureInfo.InvariantCulture), 0.1f, float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture)); }
        return def;
    }

    static string Path(Transform t) { string r = t.name; while (t.parent != null) { t = t.parent; r = t.name + "/" + r; } return r; }

    public static void Run()
    {
        EditorSceneManager.OpenScene("Assets/Scenes/Town.unity", OpenSceneMode.Single);
        var s = Object.FindFirstObjectByType<Unity.AI.Navigation.NavMeshSurface>();
        s.BuildNavMesh();
        Debug.Log($"NAVPROBE surface agentType={s.agentTypeID} radius={NavMesh.GetSettingsByID(s.agentTypeID).agentRadius} collect={s.collectObjects} geom={s.useGeometry} layers={s.layerMask.value}");
        Vector3 a = Arg("-from", new Vector3(-6.5f, 0.1f, 2f)), b = Arg("-to", new Vector3(-0.6f, 0.1f, -2.8f));
        NavMesh.SamplePosition(a, out var ha, 3f, NavMesh.AllAreas); NavMesh.SamplePosition(b, out var hb, 3f, NavMesh.AllAreas);
        var path = new NavMeshPath(); NavMesh.CalculatePath(ha.position, hb.position, NavMesh.AllAreas, path);
        Debug.Log($"NAVPROBE from {ha.position} to {hb.position} status={path.status} corners={path.corners.Length}");
        for (int i = 0; i < path.corners.Length; i++)
        {
            var c = path.corners[i];
            string blocked = "";
            if (i > 0)
            {
                var p0 = path.corners[i - 1] + Vector3.up * 0.9f; var p1 = c + Vector3.up * 0.9f;
                foreach (var h in Physics.SphereCastAll(p0, 0.3f, (p1 - p0).normalized, (p1 - p0).magnitude))
                    blocked += $" hit:{h.collider.name}@{h.point}";
            }
            Debug.Log($"NAVPROBE corner {i} {c}{blocked}");
        }
        foreach (float hgt in new[] { 0.3f, 1.0f, 1.7f })
            foreach (var h in Physics.RaycastAll(a + Vector3.up * hgt, (b - a).normalized, Vector3.Distance(a, b), ~0, QueryTriggerInteraction.Ignore))
                Debug.Log($"NAVPROBE line h={hgt} hit {h.collider.name} path={Path(h.collider.transform)} at {h.point}");
        foreach (var c in Physics.OverlapSphere(ha.position + Vector3.up, 1.2f)) Debug.Log($"NAVPROBE near-from {c.name} {c.GetType().Name} {c.bounds.center} {c.bounds.size}");
    }
}
