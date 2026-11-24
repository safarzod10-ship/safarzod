using System;
using System.Collections;
using System.Globalization;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// Screenshot tour of the Town level. Does nothing unless the player is started with "-townshots <dir>".
/// Optional: "-towntweak k=v;k=v" (look overrides), "-townviews <file.json>" (replace the baked viewpoints),
/// "-townonly 1,5,11" (1-based subset).
public class TownShots : MonoBehaviour
{
    [Serializable]
    public class View
    {
        public string name;
        public Vector3 pos;
        public Vector3 target;
        public float fov = 65f;
        public float shadowDistance = 0f;   // 0 = keep the pipeline default
    }

    [Serializable]
    class ViewList { public View[] views; }

    public View[] views;
    public Camera cam;
    public Light sun;
    public TownEnv env;
    public Volume volume;
    public float superSample = 2f;          // render scale while shooting (down-sampled to the window)
    [NonSerialized] public float fovOverride = 0f;

    public static string Arg(string key)
    {
        var a = Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++) if (a[i] == key) return a[i + 1];
        return null;
    }

    void Start()
    {
        var dir = Arg("-townshots");
        if (string.IsNullOrEmpty(dir)) { enabled = false; return; }
        StartCoroutine(Run(dir));
    }

    public void LoadViewOverride(string file)
    {
        if (string.IsNullOrEmpty(file) || !File.Exists(file)) return;
        var l = JsonUtility.FromJson<ViewList>(File.ReadAllText(file));
        if (l != null && l.views != null && l.views.Length > 0) views = l.views;
    }

    public void Place(View v)
    {
        cam.transform.position = v.pos;
        cam.transform.rotation = Quaternion.LookRotation((v.target - v.pos).normalized, Vector3.up);
        cam.fieldOfView = fovOverride > 0f ? fovOverride : v.fov;
    }

    /// "sun=3;amb=1;bounce=1;refl=1;exp=0;contrast=5;sat=0;temp=0;tm=2;lift=0;gamma=0;bloom=0.2;vig=0.2;grain=0.1;fog=0.004;skyexp=1;scale=2;fov=0;shadow=1"
    public void ApplyTweaks(string spec)
    {
        if (string.IsNullOrEmpty(spec)) return;
        var prof = volume != null ? volume.profile : null;
        foreach (var kv in spec.Split(';', ','))
        {
            var p = kv.Split('=');
            if (p.Length != 2 || !float.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var f)) continue;
            switch (p[0].Trim())
            {
                case "sun": if (sun) sun.intensity = f; break;
                case "shadow": if (sun) sun.shadowStrength = f; break;
                case "amb": if (env) { env.skyScale = f; env.Apply(); } break;
                case "bounce": if (env) { env.bounceScale = f; env.Apply(); } break;
                case "refl": RenderSettings.reflectionIntensity = f; break;
                case "fog": RenderSettings.fogDensity = f; RenderSettings.fog = f > 0f; break;
                case "skyexp":
                    if (RenderSettings.skybox) { var m = new Material(RenderSettings.skybox); m.SetFloat("_Exposure", f); RenderSettings.skybox = m; }
                    break;
                case "scale": superSample = f; break;
                case "fov": fovOverride = f; break;
                case "exp": if (prof && prof.TryGet<ColorAdjustments>(out var ca)) ca.postExposure.Override(f); break;
                case "contrast": if (prof && prof.TryGet<ColorAdjustments>(out var cb)) cb.contrast.Override(f); break;
                case "sat": if (prof && prof.TryGet<ColorAdjustments>(out var cc)) cc.saturation.Override(f); break;
                case "temp": if (prof && prof.TryGet<WhiteBalance>(out var wb)) wb.temperature.Override(f); break;
                case "bloom": if (prof && prof.TryGet<Bloom>(out var bl)) bl.intensity.Override(f); break;
                case "vig": if (prof && prof.TryGet<Vignette>(out var vg)) vg.intensity.Override(f); break;
                case "tm": if (prof && prof.TryGet<Tonemapping>(out var tm)) tm.mode.Override((TonemappingMode)(int)f); break;
                case "lift": if (prof && prof.TryGet<LiftGammaGain>(out var l1)) l1.lift.Override(new Vector4(1f, 1f, 1f, f)); break;
                case "gamma": if (prof && prof.TryGet<LiftGammaGain>(out var l2)) l2.gamma.Override(new Vector4(1f, 1f, 1f, f)); break;
                case "grain": if (prof && prof.TryGet<FilmGrain>(out var fg)) fg.intensity.Override(f); break;
            }
        }
    }

    public static bool Selected(string only, int index1)
    {
        if (string.IsNullOrEmpty(only)) return true;
        foreach (var s in only.Split(',')) if (int.TryParse(s, out var n) && n == index1) return true;
        return false;
    }

    IEnumerator Run(string dir)
    {
        Directory.CreateDirectory(dir);
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = -1;
        LoadViewOverride(Arg("-townviews"));
        ApplyTweaks(Arg("-towntweak"));
        var only = Arg("-townonly");
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        float baseShadow = urp != null ? urp.shadowDistance : 70f;
        if (urp != null) urp.renderScale = Mathf.Clamp(superSample, 0.5f, 2f);
        Debug.Log("TOWNSHOTS_START views=" + views.Length + " dir=" + dir + " scale=" + superSample);
        yield return null;
        yield return null;
        for (int i = 0; i < views.Length; i++)
        {
            if (!Selected(only, i + 1)) continue;
            var v = views[i];
            Place(v);
            if (urp != null) urp.shadowDistance = v.shadowDistance > 0f ? v.shadowDistance : baseShadow;
            yield return null;
            yield return null;
            var path = Path.Combine(dir, "shot_" + (i + 1).ToString("00") + ".png");
            if (File.Exists(path)) File.Delete(path);
            ScreenCapture.CaptureScreenshot(path);
            int guard = 0;
            while (!File.Exists(path) && guard++ < 300) yield return null;
            yield return null;
            Debug.Log("TOWNSHOT " + path + " " + v.name + (File.Exists(path) ? "" : " MISSING"));
        }
        Debug.Log("TOWNSHOTS_DONE");
        Application.Quit();
    }
}
