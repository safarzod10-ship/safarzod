using System.Collections;
using UnityEngine;

/// Automated in-game check of the first-person packs: with `-autohost -fpshots <dir>` the local player is handed each
/// weapon family in turn and screenshots are written at draw, idle, firing and mid-reload (fpw<id>_<moment>.png).
public class FpAutoTest : MonoBehaviour
{
    string dir;
    static readonly int[] Ids = { 21, 0, 1, 16, 13 };     // awp (sniper pack), knife, usp, ak, p90 (rifle pack)

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Init()
    {
        var a = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++)
            if (a[i] == "-fpshots")
            {
                var go = new GameObject("FpAutoTest"); DontDestroyOnLoad(go);
                go.AddComponent<FpAutoTest>().dir = a[i + 1];
            }
    }

    IEnumerator Start()
    {
        System.IO.Directory.CreateDirectory(dir);
        while (Player.Local == null || Game.I == null || !Game.I.CanAct || !Player.Local.Alive) yield return new WaitForSeconds(0.5f);
        var p = Player.Local;
        foreach (int id in Ids)
        {
            if (p == null || !p.Alive) break;
            if (id == 0) p.Select(0); else p.GiveRpc(id);
            yield return Shot(p, id, "draw", 0.2f);
            yield return Shot(p, id, "idle", 1.4f);
            p.TryFire(Camera.main.transform.forward, false, true);
            yield return Shot(p, id, "fire", 0.06f);
            if (id == 0) { yield return new WaitForSeconds(0.6f); p.TryFire(Camera.main.transform.forward, false, true); yield return Shot(p, id, "fire2", 0.15f); continue; }
            yield return new WaitForSeconds(Mathf.Max(0.3f, Weapons.Get(id).rate));
            p.Reload();
            float r = Weapons.Get(id).reload;
            yield return Shot(p, id, "reload30", r * 0.3f);
            yield return Shot(p, id, "reload70", r * 0.4f);
            yield return new WaitForSeconds(r * 0.3f + 0.3f);
        }
        Debug.Log("FPSHOTS_DONE");
    }

    IEnumerator Shot(Player p, int id, string what, float wait)
    {
        yield return new WaitForSeconds(wait);
        yield return new WaitForEndOfFrame();
        string f = System.IO.Path.Combine(dir, $"fpw{id:00}_{what}.png");
        ScreenCapture.CaptureScreenshot(f);
        var fv = FpView.Local;
        Debug.Log($"FPSHOT {f} cur={p.cur} reloading={p.Reloading} {(fv ? fv.Debug() : "no view")}");
    }
}
