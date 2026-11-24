using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

/// Player settings (graphics preset, controls, sound, overlay) stored in PlayerPrefs and applied at runtime.
/// Graphics presets change the URP asset, the renderer features (SSAO), post-processing, textures and frame rate.
public static class GameSettings
{
    public enum Preset { Low = 0, Medium = 1, High = 2 }
    public static readonly string[] PresetNames = { "Низкое", "Среднее", "Высокое" };

    public static Preset Graphics = Preset.Medium;
    public static float Sensitivity = 1f, Fov = 68f, MasterVolume = 1f, SfxVolume = 1f, VoiceVolume = 1f;
    public static bool InvertY, ShowFps = true, PostFx = true;
    public static float ButtonScale = 1f;
    static bool loaded;

    public static void Load()
    {
        bool mobile = Application.isMobilePlatform;
        Graphics = (Preset)PlayerPrefs.GetInt("gfx", mobile ? 1 : 2);
        Sensitivity = PlayerPrefs.GetFloat("sens", 1f);
        Fov = PlayerPrefs.GetFloat("fov", 68f);
        MasterVolume = PlayerPrefs.GetFloat("vol", 1f);
        SfxVolume = PlayerPrefs.GetFloat("volSfx", 1f);
        VoiceVolume = PlayerPrefs.GetFloat("volVoice", 1f);
        InvertY = PlayerPrefs.GetInt("invertY", 0) == 1;
        ShowFps = PlayerPrefs.GetInt("showFps", 1) == 1;
        PostFx = PlayerPrefs.GetInt("postFx", 1) == 1;
        ButtonScale = PlayerPrefs.GetFloat("btnScale", 1f);
        loaded = true;
    }

    public static void Save()
    {
        PlayerPrefs.SetInt("gfx", (int)Graphics);
        PlayerPrefs.SetFloat("sens", Sensitivity);
        PlayerPrefs.SetFloat("fov", Fov);
        PlayerPrefs.SetFloat("vol", MasterVolume);
        PlayerPrefs.SetFloat("volSfx", SfxVolume);
        PlayerPrefs.SetFloat("volVoice", VoiceVolume);
        PlayerPrefs.SetInt("invertY", InvertY ? 1 : 0);
        PlayerPrefs.SetInt("showFps", ShowFps ? 1 : 0);
        PlayerPrefs.SetInt("postFx", PostFx ? 1 : 0);
        PlayerPrefs.SetFloat("btnScale", ButtonScale);
        PlayerPrefs.Save();
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (!loaded) Load();
        Apply();
        if (Object.FindFirstObjectByType<FpsOverlay>() == null) new GameObject("FpsOverlay").AddComponent<FpsOverlay>();
    }

    /// Applies everything; safe to call any time (e.g. from the settings screen).
    public static void Apply()
    {
        if (!loaded) Load();
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        int g = (int)Graphics;
        if (urp != null)
        {
            urp.renderScale = new[] { 0.7f, 0.85f, 1f }[g];
            urp.msaaSampleCount = new[] { 1, 2, 4 }[g];
            urp.shadowDistance = new[] { 25f, 45f, 70f }[g];
            urp.shadowCascadeCount = new[] { 1, 2, 3 }[g];
            urp.mainLightShadowmapResolution = new[] { 1024, 2048, 4096 }[g];
            urp.supportsHDR = g > 0;
            foreach (var data in urp.rendererDataList)
            {
                if (data == null) continue;
                foreach (var f in data.rendererFeatures)
                    if (f != null && f.GetType().Name.Contains("AmbientOcclusion")) f.SetActive(g >= 1);
            }
        }
        QualitySettings.globalTextureMipmapLimit = g == 0 ? 1 : 0;
        QualitySettings.lodBias = new[] { 0.7f, 1f, 1.5f }[g];
        QualitySettings.anisotropicFiltering = g == 0 ? AnisotropicFiltering.Disable : AnisotropicFiltering.Enable;
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = 60;
        AudioListener.volume = MasterVolume;
        var cam = Camera.main;
        if (cam != null)
        {
            var cd = cam.GetUniversalAdditionalCameraData();
            cd.renderPostProcessing = PostFx && g > 0;
            cd.antialiasing = g == 0 ? AntialiasingMode.None : AntialiasingMode.FastApproximateAntialiasing;
            cam.allowHDR = g > 0;
        }
    }
}

/// Small frame-rate read-out (top-right): average FPS and worst frame time over the last second.
/// Needed to measure real performance on phones.
public class FpsOverlay : MonoBehaviour
{
    Text label; float acc, worst; int frames; float next;

    void Start()
    {
        DontDestroyOnLoad(gameObject);
        var cgo = new GameObject("FpsCanvas", typeof(Canvas), typeof(CanvasScaler));
        cgo.transform.SetParent(transform, false);
        var c = cgo.GetComponent<Canvas>(); c.renderMode = RenderMode.ScreenSpaceOverlay; c.sortingOrder = 1000;
        var sc = cgo.GetComponent<CanvasScaler>(); sc.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; sc.referenceResolution = new Vector2(1920, 1080); sc.matchWidthOrHeight = 1f;
        var go = new GameObject("Fps", typeof(RectTransform));
        go.transform.SetParent(cgo.transform, false);
        var rt = go.GetComponent<RectTransform>();
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(1, 1); rt.anchoredPosition = new Vector2(-24, -64); rt.sizeDelta = new Vector2(420, 40);
        label = go.AddComponent<Text>();
        label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); label.fontSize = 26; label.alignment = TextAnchor.UpperRight;
        label.color = new Color(1, 1, 1, 0.85f); label.raycastTarget = false;
        var o = go.AddComponent<Outline>(); o.effectColor = new Color(0, 0, 0, 0.8f);
    }

    void Update()
    {
        float dt = Time.unscaledDeltaTime;
        acc += dt; frames++; if (dt > worst) worst = dt;
        if (Time.unscaledTime < next) return;
        next = Time.unscaledTime + 1f;
        if (label != null)
        {
            label.enabled = GameSettings.ShowFps;
            float fps = frames / Mathf.Max(acc, 1e-4f);
            label.text = $"{fps:0} FPS · худший кадр {worst * 1000f:0} мс · {GameSettings.PresetNames[(int)GameSettings.Graphics]}";
            label.color = fps >= 55 ? new Color(0.6f, 1f, 0.6f, 0.9f) : fps >= 30 ? new Color(1f, 0.9f, 0.4f, 0.9f) : new Color(1f, 0.45f, 0.4f, 0.9f);
        }
        if (Application.isBatchMode || Debug.isDebugBuild) Debug.Log($"PERF fps={frames / Mathf.Max(acc, 1e-4f):0.0} worstMs={worst * 1000f:0.0} preset={GameSettings.Graphics}");
        acc = 0; frames = 0; worst = 0;
    }
}
