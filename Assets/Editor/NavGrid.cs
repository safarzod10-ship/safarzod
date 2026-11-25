using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;

/// Diagnostic: prints an ASCII map of the Town navmesh (x -24..24, z -16..26, 0.5 m cells); '#' walkable, '.' not;
/// '+' marks the bomb site, digits the bot route points. -executeMethod NavGrid.Run
public static class NavGrid
{
    public static void Run()
    {
        EditorSceneManager.OpenScene("Assets/Scenes/Town.unity", OpenSceneMode.Single);
        Object.FindFirstObjectByType<Unity.AI.Navigation.NavMeshSurface>().BuildNavMesh();
        var sb = new System.Text.StringBuilder("NAVGRID\n");
        for (float z = 26f; z >= -16f; z -= 0.5f)
        {
            sb.Append(z.ToString("00.0").PadLeft(5)).Append(' ');
            for (float x = -24f; x <= 24f; x += 0.5f)
            {
                char c = NavMesh.SamplePosition(new Vector3(x, 0.1f, z), out var h, 0.3f, NavMesh.AllAreas) && h.position.y < 1.5f ? '#' : '.';
                if (Mathf.Abs(x + 0.6f) < 0.26f && Mathf.Abs(z + 2.8f) < 0.26f) c = '+';
                sb.Append(c);
            }
            sb.Append('\n');
        }
        // approaches: for points on rings around the site, the path length relative to the straight distance
        Vector3 site = new Vector3(-0.6f, 0.1f, -2.8f);
        NavMesh.SamplePosition(site, out var sh, 3f, NavMesh.AllAreas);
        foreach (float r in new[] { 7f, 11f, 15f })
            for (int a = 0; a < 360; a += 15)
            {
                var q = site + Quaternion.Euler(0, a, 0) * Vector3.forward * r;
                if (!NavMesh.SamplePosition(q, out var qh, 0.6f, NavMesh.AllAreas) || qh.position.y > 1.5f) continue;
                var path = new NavMeshPath(); NavMesh.CalculatePath(qh.position, sh.position, NavMesh.AllAreas, path);
                if (path.status != NavMeshPathStatus.PathComplete) { sb.Append($"APPROACH r={r} a={a} at({qh.position.x:0.0},{qh.position.z:0.0}) unreachable\n"); continue; }
                float len = 0; for (int i = 1; i < path.corners.Length; i++) len += Vector3.Distance(path.corners[i - 1], path.corners[i]);
                sb.Append($"APPROACH r={r} a={a} at({qh.position.x:0.0},{qh.position.z:0.0}) ratio={len / Vector3.Distance(qh.position, sh.position):0.00}\n");
            }
        System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("NAVGRID_OUT") ?? "/tmp/navgrid.txt", sb.ToString());
        Debug.Log("NAVGRID_DONE");
    }
}
