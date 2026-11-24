using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// First-person walk through the Town level, saved as numbered frames.
/// Runs only when the player is started with "-townwalk <dir>" (optional "-townwalkfps <n>").
public class TownWalk : MonoBehaviour
{
    // route in Unity coordinates (x, z), metres
    static readonly float[,] Route =
    {
        {-1.5f, 23f}, {-1.5f, 15f}, {1.2f, 11.5f}, {1.2f, 8f}, {-3.3f, 2f}, {-0.6f, -2.8f}, {-0.8f, -0.5f}, {5.5f, 0.8f},
        {5.5f, 7f}, {-3f, 7.5f}, {-9.5f, 7f}, {-12.7f, 5.6f}, {-18f, 5.6f}, {-17.2f, -6f}, {-17f, -11f}, {-17f, 5f},
        {-17f, 13f}, {-14f, 14.5f}, {-5f, 14f}, {4f, 14f}, {1.2f, 11.5f}, {1.2f, 8f}, {-0.8f, -0.5f},
    };

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (Arg("-townwalk") != null) new GameObject("TownWalk").AddComponent<TownWalk>();
    }

    static string Arg(string name)
    {
        var a = Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
        return null;
    }

    IEnumerator Start()
    {
        string dir = Arg("-townwalk");
        int fps = 15; int.TryParse(Arg("-townwalkfps") ?? "15", out fps);
        Directory.CreateDirectory(dir);
        QualitySettings.vSyncCount = 0; Application.targetFrameRate = -1;
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if (urp != null) { urp.renderScale = 1f; urp.msaaSampleCount = 1; urp.shadowDistance = 45f; }
        var cam = Camera.main; cam.fieldOfView = 68f;
        yield return null; yield return null;

        // navigation mesh from the level colliders, so the walk goes round crates and walls
        bool nav = false;
        try
        {
            var sources = new List<NavMeshBuildSource>();
            var bounds = new Bounds(new Vector3(-3f, 2f, 6f), new Vector3(60f, 8f, 60f));
            NavMeshBuilder.CollectSources(bounds, ~0, NavMeshCollectGeometry.PhysicsColliders, 0, new List<NavMeshBuildMarkup>(), sources);
            var st = NavMesh.GetSettingsByID(0);
            st.agentRadius = 0.45f; st.agentHeight = 1.8f; st.agentClimb = 0.35f; st.agentSlope = 40f;
            var data = NavMeshBuilder.BuildNavMeshData(st, sources, bounds, Vector3.zero, Quaternion.identity);
            if (data != null) { NavMesh.AddNavMeshData(data); nav = NavMesh.SamplePosition(new Vector3(-0.8f, 0, -0.5f), out _, 3f, NavMesh.AllAreas); }
            Debug.Log("TOWNWALK nav sources=" + sources.Count + " ok=" + nav);
        }
        catch (Exception e) { Debug.Log("TOWNWALK nav failed " + e.Message); }

        // full list of points to walk through
        var pts = new List<Vector3>();
        for (int i = 0; i < Route.GetLength(0); i++)
        {
            var p = new Vector3(Route[i, 0], 0.05f, Route[i, 1]);
            if (nav && NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) p = hit.position;
            if (pts.Count > 0 && nav)
            {
                var path = new NavMeshPath();
                if (NavMesh.CalculatePath(pts[pts.Count - 1], p, NavMesh.AllAreas, path) && path.status == NavMeshPathStatus.PathComplete)
                { for (int k = 1; k < path.corners.Length; k++) pts.Add(path.corners[k]); continue; }
                Debug.Log("TOWNWALK no path to point " + i + ", going straight");
            }
            pts.Add(p);
        }
        Debug.Log("TOWNWALK points=" + pts.Count);

        Time.captureFramerate = fps;
        float dt = 1f / fps, yaw = 180f, bob = 0f; int frame = 0;
        Vector3 pos = pts[0];
        for (int i = 1; i < pts.Count; i++)
        {
            Vector3 target = pts[i];
            while ((new Vector3(target.x - pos.x, 0, target.z - pos.z)).sqrMagnitude > 0.02f)
            {
                Vector3 flat = new Vector3(target.x - pos.x, 0, target.z - pos.z);
                float wantYaw = Mathf.Atan2(flat.x, flat.z) * Mathf.Rad2Deg;
                float off = Mathf.Abs(Mathf.DeltaAngle(yaw, wantYaw));
                yaw = Mathf.MoveTowardsAngle(yaw, wantYaw, 120f * dt);
                float speed = off > 50f ? 0.8f : off > 20f ? 2.2f : 3.6f;
                Vector3 next = Vector3.MoveTowards(new Vector3(pos.x, 0, pos.z), new Vector3(target.x, 0, target.z), speed * dt);
                float gy = pos.y;
                if (Physics.Raycast(new Vector3(next.x, pos.y + 1.2f, next.z), Vector3.down, out var gh, 4f)) gy = gh.point.y;
                pos = new Vector3(next.x, Mathf.Lerp(pos.y, gy, 0.5f), next.z);
                bob += speed * dt * 2.1f;
                float look = Mathf.Sin(frame * 0.045f) * 14f;
                cam.transform.position = pos + Vector3.up * (1.65f + Mathf.Sin(bob * 2f) * 0.025f);
                cam.transform.rotation = Quaternion.Euler(-2f + Mathf.Sin(frame * 0.03f) * 5f, yaw + look, Mathf.Cos(bob) * 0.35f);
                yield return new WaitForEndOfFrame();
                string f = Path.Combine(dir, "f" + frame.ToString("00000") + ".png");
                ScreenCapture.CaptureScreenshot(f);
                frame++;
                yield return null;
                if (frame % 50 == 0) Debug.Log("TOWNWALK frame " + frame + " point " + i + "/" + pts.Count);
            }
        }
        yield return null; yield return null;
        Debug.Log("TOWNWALK_DONE frames=" + frame);
        Application.Quit();
    }
}
