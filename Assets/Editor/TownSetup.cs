using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Object = UnityEngine.Object;

/// Import rules for everything under Assets/Town.
public class TownTexImport : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith("Assets/Town/")) return;
        var ti = (TextureImporter)assetImporter;
        var file = Path.GetFileNameWithoutExtension(assetPath);
        if (file == "sky")
        {   // panoramic sky: full resolution, no mips (avoids the seam line), wraps horizontally only
            ti.textureShape = TextureImporterShape.Texture2D;
            ti.mipmapEnabled = false; ti.npotScale = TextureImporterNPOTScale.None;
            ti.wrapModeU = TextureWrapMode.Repeat; ti.wrapModeV = TextureWrapMode.Clamp;
            ti.maxTextureSize = 4096; ti.filterMode = FilterMode.Bilinear; ti.anisoLevel = 1;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
        }
        else if (file == "sky_refl")
        {   // reflection environment: lat-long -> cubemap with glossy (specular) mip chain
            ti.textureShape = TextureImporterShape.TextureCube;
            ti.generateCubemap = TextureImporterGenerateCubemap.Cylindrical;
            var s = new TextureImporterSettings();
            ti.ReadTextureSettings(s);
            s.cubemapConvolution = TextureImporterCubemapConvolution.Specular;
            s.seamlessCubemap = true;
            ti.SetTextureSettings(s);
            ti.mipmapEnabled = true; ti.maxTextureSize = 512; ti.filterMode = FilterMode.Trilinear;
            ti.textureCompression = TextureImporterCompression.Uncompressed;
            ti.isReadable = true;
        }
        else if (assetPath.Contains("/Textures/"))
        {
            ti.mipmapEnabled = true; ti.mipmapFilter = TextureImporterMipFilter.KaiserFilter;
            ti.anisoLevel = 16; ti.filterMode = FilterMode.Trilinear; ti.maxTextureSize = 2048;
            ti.wrapModeU = TextureWrapMode.Repeat;
            // wall textures are height-aware (V = height / 6 m): mirror so the foot band never repeats 6 m up
            ti.wrapModeV = file.StartsWith("wall_") ? TextureWrapMode.Mirror : TextureWrapMode.Repeat;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
            if (file.EndsWith("_n")) ti.textureType = TextureImporterType.NormalMap;
            else if (file.EndsWith("_orm")) ti.sRGBTexture = false;
        }
    }
}

public static class TownSetup
{
    const string Glb = "Assets/Town/town.glb";
    const string SkyTex = "Assets/Town/sky.hdr";
    const string ReflTex = "Assets/Town/sky_refl.hdr";
    const string GeoJson = "Assets/Town/geometry.json";
    const string TexDir = "Assets/Town/Textures/";
    const string MatDir = "Assets/Town/Materials/";
    const string SkyMat = "Assets/Town/TownSky.mat";
    const string Profile = "Assets/Town/TownPost.asset";
    const string ScenePath = "Assets/Scenes/Town.unity";
    const string UrpPath = "Assets/Settings/URP.asset";
    const string BaseRenderer = "Assets/Settings/URP_Renderer.asset";
    const string TownRenderer = "Assets/Settings/URP_Renderer_Town.asset";

    // ---- look (tuned against the screenshots)
    static readonly Vector3 DirToSun = new Vector3(-0.554f, 0.742f, 0.378f);   // matches the HDRI sun with the skybox rotated 180 deg
    const float SkyRotation = 180f;
    static readonly Color SunColor = new Color(1f, 0.95f, 0.86f);
    const float SunIntensity = 2.1f;        // sun : sky ratio measured in the HDRI is about 1.4-2 : 1 (Unity units)
    const float SkyScale = 1.0f, BounceScale = 1.3f;
    const float FogDensity = 0.0045f;
    const float ReflectionIntensity = 0.7f;   // the courtyards see well under a full hemisphere of sky
    const float PostExposure = 0.7f, Contrast = 8f, Saturation = 2f, Temperature = 0f;
    const int ToneMode = 2;                 // 1 = Neutral, 2 = ACES
    const float Lift = 0f, Gamma = 0f;
    const float BloomIntensity = 0.18f, VignetteIntensity = 0.22f, GrainIntensity = 0.12f;
    const float SsaoIntensity = 1.5f, SsaoRadius = 0.35f, SsaoDirect = 0.2f;

    [Serializable] class GeoView { public string name; public string kind; public float[] pos_unity; public float[] look_at_unity; public float fov_vertical_deg; }
    [Serializable] class GeoSpawn { public float yaw_unity_deg; }
    [Serializable] class GeoBomb { public float size_x_m; public float size_z_m; }
    [Serializable] class Geo { public GeoView[] camera_viewpoints; public GeoSpawn spawn_a_attackers; public GeoSpawn spawn_b_defenders; public GeoBomb bomb_site; }

    static Vector3 V(float[] a) { return new Vector3(a[0], a[1], a[2]); }

    public static void Build()
    {
        AssetDatabase.Refresh();
        foreach (var p in new[] { SkyTex, ReflTex })
            if (AssetDatabase.LoadAssetAtPath<Texture>(p) == null) throw new Exception("missing " + p);
        if (AssetDatabase.LoadAssetAtPath<Cubemap>(ReflTex) == null) AssetDatabase.ImportAsset(ReflTex, ImportAssetOptions.ForceUpdate);

        int rendererIndex = SetupPipeline();
        var mats = BuildMaterials();
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // ---------------- model
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Glb);
        if (prefab == null) throw new Exception("town.glb did not import");
        var town = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        PrefabUtility.UnpackPrefabInstance(town, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
        town.name = "Town";
        int tris = 0, colliders = 0;
        foreach (var mr in town.GetComponentsInChildren<MeshRenderer>(true))
        {
            var mf = mr.GetComponent<MeshFilter>();
            var src = mr.sharedMaterial;
            string mname = src != null ? src.name : "?";
            if (mats.TryGetValue(mname, out var m)) mr.sharedMaterial = m; else Debug.LogWarning("TOWN no material for " + mname);
            mr.shadowCastingMode = ShadowCastingMode.TwoSided;     // AI shells are not watertight: let back faces cast too
            mr.receiveShadows = true;
            mr.lightProbeUsage = LightProbeUsage.Off;              // ambient probe only
            mr.reflectionProbeUsage = ReflectionProbeUsage.BlendProbes;
            mr.gameObject.isStatic = true;
            var mesh = mf != null ? mf.sharedMesh : null;
            if (mesh != null && mname == "cloth") { mesh = TrimCloth(mesh); mf.sharedMesh = mesh; }
            if (mesh != null)
            {
                tris += (int)(mesh.GetIndexCount(0) / 3);
                Debug.Log("TOWN mesh " + mr.name + " verts=" + mesh.vertexCount + " tris=" + mesh.GetIndexCount(0) / 3 + " mat=" + mname +
                          " color=" + mesh.HasVertexAttribute(VertexAttribute.Color) + " tangent=" + mesh.HasVertexAttribute(VertexAttribute.Tangent) +
                          " uv1=" + mesh.HasVertexAttribute(VertexAttribute.TexCoord1) + " bounds=" + mesh.bounds.size);
                if (mname != "cloth" && mname != "palm_leaf")
                {
                    var mc = mr.gameObject.AddComponent<MeshCollider>();
                    mc.sharedMesh = mesh; colliders++;
                }
            }
        }
        Debug.Log("TOWN model tris=" + tris + " colliders=" + colliders);

        // ---------------- gameplay markers (taken from the marker nodes in the GLB, already in Unity space)
        var geo = JsonUtility.FromJson<Geo>(File.ReadAllText(GeoJson));
        var all = town.GetComponentsInChildren<Transform>(true);
        var markers = new GameObject("Markers");
        MakeSpawn(markers.transform, all, "SpawnA", geo.spawn_a_attackers != null ? geo.spawn_a_attackers.yaw_unity_deg : 180f);
        MakeSpawn(markers.transform, all, "SpawnB", geo.spawn_b_defenders != null ? geo.spawn_b_defenders.yaw_unity_deg : 0f);
        var bombT = all.FirstOrDefault(t => t.name == "BombSite");
        var bomb = new GameObject("BombSite");
        bomb.transform.SetParent(markers.transform, false);
        bomb.transform.position = bombT != null ? bombT.position : new Vector3(-0.6f, 0.03f, -2.8f);
        var bc = bomb.AddComponent<BoxCollider>();
        bc.isTrigger = true;
        bc.size = new Vector3(geo.bomb_site != null ? geo.bomb_site.size_x_m : 4f, 2.5f, geo.bomb_site != null ? geo.bomb_site.size_z_m : 6f);
        bc.center = new Vector3(0, 1.25f, 0);
        Debug.Log("TOWN markers SpawnA=" + markers.transform.Find("SpawnA").position + " SpawnB=" + markers.transform.Find("SpawnB").position + " Bomb=" + bomb.transform.position);
        var gltfMarkers = all.FirstOrDefault(t => t.name == "Markers");
        if (gltfMarkers != null) Object.DestroyImmediate(gltfMarkers.gameObject);

        // ---------------- sun
        var sunGo = new GameObject("Sun");
        var sun = sunGo.AddComponent<Light>();
        sun.type = LightType.Directional;
        sunGo.transform.rotation = Quaternion.LookRotation(-DirToSun.normalized, Vector3.up);
        sun.color = SunColor; sun.intensity = SunIntensity;
        sun.shadows = LightShadows.Soft; sun.shadowStrength = 1f;
        var ld = sunGo.AddComponent<UniversalAdditionalLightData>();
        ld.softShadowQuality = SoftShadowQuality.High;

        // ---------------- sky, ambient, reflections, haze
        var skyMat = AssetDatabase.LoadAssetAtPath<Material>(SkyMat);
        if (skyMat == null) { skyMat = new Material(Shader.Find("Skybox/Panoramic")); AssetDatabase.CreateAsset(skyMat, SkyMat); }
        skyMat.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>(SkyTex));
        skyMat.SetFloat("_Mapping", 1f); skyMat.DisableKeyword("_MAPPING_6_FRAMES_LAYOUT");
        skyMat.SetFloat("_ImageType", 0f); skyMat.SetFloat("_Rotation", SkyRotation); skyMat.SetFloat("_Exposure", 1f);
        skyMat.SetColor("_Tint", new Color(0.5f, 0.5f, 0.5f, 0.5f));
        EditorUtility.SetDirty(skyMat);
        RenderSettings.skybox = skyMat;
        RenderSettings.sun = sun;
        var refl = AssetDatabase.LoadAssetAtPath<Cubemap>(ReflTex);
        RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
        RenderSettings.customReflectionTexture = refl;
        RenderSettings.reflectionIntensity = ReflectionIntensity;
        var hz = TownSkyData.Horizon;
        RenderSettings.fog = true; RenderSettings.fogMode = FogMode.ExponentialSquared; RenderSettings.fogDensity = FogDensity;
        RenderSettings.fogColor = new Color(hz[0], hz[1], hz[2], 1f).gamma;
        LogCubeSun(refl);

        var envGo = new GameObject("Environment");
        var env = envGo.AddComponent<TownEnv>();
        BuildSH(out env.skySH, out env.groundSH);
        env.skyScale = SkyScale; env.bounceScale = BounceScale;
        env.Apply();

        // ---------------- post processing
        var profile = BuildProfile();
        var volGo = new GameObject("PostFX");
        var vol = volGo.AddComponent<Volume>();
        vol.isGlobal = true; vol.priority = 1; vol.sharedProfile = profile;

        // ---------------- camera + screenshot tour
        var shots = new List<TownShots.View>();
        if (geo.camera_viewpoints != null)
            foreach (var g in geo.camera_viewpoints)
            {
                bool aerial = g.kind == "aerial";
                shots.Add(new TownShots.View { name = g.name, pos = V(g.pos_unity), target = V(g.look_at_unity), fov = aerial ? g.fov_vertical_deg : 65f, shadowDistance = aerial ? 170f : 0f });
            }
        shots.Add(new TownShots.View { name = "alley_wall_closeup", pos = new Vector3(-2.6f, 1.65f, 21.5f), target = new Vector3(1.0f, 1.3f, 19.0f), fov = 55f });
        shots.Add(new TownShots.View { name = "bombsite_crates_close", pos = new Vector3(-2.6f, 1.65f, -0.5f), target = new Vector3(3f, 0.8f, -3.5f), fov = 60f });
        shots.Add(new TownShots.View { name = "portal_long_lens", pos = new Vector3(-4.0f, 1.7f, 3.0f), target = new Vector3(0.6f, 4.6f, -12.2f), fov = 40f });
        shots.Add(new TownShots.View { name = "drone_south_east_low", pos = new Vector3(-16f, 15f, 18f), target = new Vector3(2f, 3f, -6f), fov = 45f, shadowDistance = 120f });
        shots.Add(new TownShots.View { name = "drone_west_over_house", pos = new Vector3(17f, 13f, 6f), target = new Vector3(-3f, 3.5f, -7f), fov = 42f, shadowDistance = 120f });

        var camGo = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener));
        camGo.tag = "MainCamera";
        var cam = camGo.GetComponent<Camera>();
        cam.fieldOfView = 65f; cam.nearClipPlane = 0.08f; cam.farClipPlane = 2000f; cam.allowHDR = true; cam.allowMSAA = true;
        cam.clearFlags = CameraClearFlags.Skybox;
        var cd = camGo.AddComponent<UniversalAdditionalCameraData>();
        cd.renderPostProcessing = true; cd.renderShadows = true; cd.antialiasing = AntialiasingMode.None; cd.dithering = true;
        cd.SetRenderer(rendererIndex);

        var shotsGo = new GameObject("TownShots");
        var ts = shotsGo.AddComponent<TownShots>();
        ts.views = shots.ToArray(); ts.cam = cam; ts.sun = sun; ts.env = env; ts.volume = vol; ts.superSample = 2f;
        if (ts.views.Length > 0) ts.Place(ts.views[0]);

        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();
        Debug.Log("TOWNSETUP_OK views=" + ts.views.Length + " renderer=" + rendererIndex);
    }

    /// The source model has two pink cloth sheets hanging in mid-air above the roofs (7.3-9.8 m up, nothing below
    /// them). All real awnings end below 5.6 m, so everything of the cloth mesh above 6.5 m is dropped.
    static Mesh TrimCloth(Mesh src)
    {
        const string path = "Assets/Town/cloth_trimmed.asset";
        var m = Object.Instantiate(src);
        m.name = "map_cloth_trimmed";
        var v = m.vertices; var t = m.triangles; var keep = new List<int>(t.Length);
        for (int i = 0; i < t.Length; i += 3)
        {
            if (Mathf.Min(v[t[i]].y, Mathf.Min(v[t[i + 1]].y, v[t[i + 2]].y)) > 6.5f) continue;
            keep.Add(t[i]); keep.Add(t[i + 1]); keep.Add(t[i + 2]);
        }
        Debug.Log("TOWN cloth trimmed: removed " + (t.Length - keep.Count) / 3 + " of " + t.Length / 3 + " triangles");
        m.triangles = keep.ToArray();
        m.RecalculateBounds();
        AssetDatabase.DeleteAsset(path);
        AssetDatabase.CreateAsset(m, path);
        return m;
    }

    static void MakeSpawn(Transform parent, Transform[] all, string name, float yaw)
    {
        var root = new GameObject(name);
        root.transform.SetParent(parent, false);
        var pts = all.Where(t => t.name.StartsWith(name + "_")).OrderBy(t => t.name).ToList();
        var rot = Quaternion.Euler(0, yaw, 0);
        root.transform.SetPositionAndRotation(pts.Count > 0 ? pts[0].position : Vector3.zero, rot);
        foreach (var p in pts)
        {
            var c = new GameObject(p.name);
            c.transform.SetParent(root.transform, false);
            c.transform.SetPositionAndRotation(p.position, rot);
        }
    }

    // ------------------------------------------------------------------ pipeline
    static int SetupPipeline()
    {
        var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(UrpPath);
        if (AssetDatabase.LoadAssetAtPath<ScriptableRendererData>(TownRenderer) == null)
            AssetDatabase.CopyAsset(BaseRenderer, TownRenderer);
        var rd = AssetDatabase.LoadAssetAtPath<ScriptableRendererData>(TownRenderer);
        foreach (var f in rd.rendererFeatures)
        {
            if (f == null || f.GetType().Name != "ScreenSpaceAmbientOcclusion") continue;
            var so = new SerializedObject(f);
            so.FindProperty("m_Settings.AOMethod").intValue = 1;          // interleaved gradient noise
            so.FindProperty("m_Settings.Downsample").boolValue = false;
            so.FindProperty("m_Settings.AfterOpaque").boolValue = false;
            // normals reconstructed from depth: the DepthNormals source gave garbage AO with the glTFast shader graph
            // (large black patches in shade) and would cost an extra geometry pass on phones anyway
            so.FindProperty("m_Settings.Source").intValue = 0;
            so.FindProperty("m_Settings.NormalSamples").intValue = 2;     // high
            so.FindProperty("m_Settings.Intensity").floatValue = SsaoIntensity;
            so.FindProperty("m_Settings.DirectLightingStrength").floatValue = SsaoDirect;
            so.FindProperty("m_Settings.Radius").floatValue = SsaoRadius;
            so.FindProperty("m_Settings.Samples").intValue = 0;           // high
            so.FindProperty("m_Settings.BlurQuality").intValue = 0;       // high
            so.FindProperty("m_Settings.Falloff").floatValue = 100f;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(f);
            Debug.Log("TOWN ssao configured");
        }
        EditorUtility.SetDirty(rd);

        var uso = new SerializedObject(urp);
        var list = uso.FindProperty("m_RendererDataList");
        int idx = -1;
        for (int i = 0; i < list.arraySize; i++) if (list.GetArrayElementAtIndex(i).objectReferenceValue == rd) idx = i;
        if (idx < 0) { idx = list.arraySize; list.arraySize++; list.GetArrayElementAtIndex(idx).objectReferenceValue = rd; }
        uso.FindProperty("m_SoftShadowsSupported").boolValue = true;
        uso.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(urp);
        AssetDatabase.SaveAssets();
        return idx;
    }

    // ------------------------------------------------------------------ materials
    /// Clones the glTFast materials (keeps their shader graph, keywords, vertex-colour support) into real assets
    /// that use the texture FILES in Assets/Town/Textures (compressed, mip-mapped, 16x aniso, proper normal maps).
    static Dictionary<string, Material> BuildMaterials()
    {
        var res = new Dictionary<string, Material>();
        foreach (var o in AssetDatabase.LoadAllAssetsAtPath(Glb))
        {
            var src = o as Material;
            if (src == null) continue;
            var path = MatDir + src.name + ".mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(src); AssetDatabase.CreateAsset(m, path); }
            else { m.shader = src.shader; m.CopyPropertiesFromMaterial(src); }
            m.name = src.name;
            var sh = m.shader;
            string info = "";
            for (int i = 0; i < sh.GetPropertyCount(); i++)
            {
                if (sh.GetPropertyType(i) != ShaderPropertyType.Texture) continue;
                var pn = sh.GetPropertyName(i);
                var t = src.GetTexture(pn);
                if (t == null) continue;
                var file = AssetDatabase.LoadAssetAtPath<Texture2D>(TexDir + t.name + ".jpg");
                if (file == null) { Debug.LogWarning("TOWN texture file missing for " + t.name); continue; }
                m.SetTexture(pn, file);
                info += " " + pn + "=" + t.name + "(" + file.width + "," + file.format + "," + file.wrapModeV + ")";
            }
            m.enableInstancing = false;
            EditorUtility.SetDirty(m);
            res[src.name] = m;
            Debug.Log("TOWN material " + src.name + " shader=" + sh.name + " kw=[" + string.Join(",", m.shaderKeywords) + "] cull=" +
                      (m.HasProperty("_Cull") ? m.GetFloat("_Cull") : -1f) + " nscale=" + (m.HasProperty("normalTexture_scale") ? m.GetFloat("normalTexture_scale") : -1f) +
                      " occ=" + (m.HasProperty("occlusionTexture_strength") ? m.GetFloat("occlusionTexture_strength") : -1f) + info);
        }
        AssetDatabase.SaveAssets();
        return res;
    }

    // ------------------------------------------------------------------ ambient SH
    static void BuildSH(out float[] sky, out float[] ground)
    {
        var s = new SphericalHarmonicsL2();
        var d = TownSkyData.Sky;
        for (int i = 0; i < d.Length; i += 6)
            s.AddDirectionalLight(new Vector3(d[i], d[i + 1], d[i + 2]), new Color(d[i + 3], d[i + 4], d[i + 5], 1f), 1f);
        var g = new SphericalHarmonicsL2();
        var gb = TownSkyData.GroundBounce;
        var gcol = new Color(gb[0], gb[1], gb[2], 1f);
        const int NU = 32, NV = 8;
        for (int j = 0; j < NV; j++)
        {
            float t0 = Mathf.PI * 0.5f * (1f + (float)j / NV), t1 = Mathf.PI * 0.5f * (1f + (float)(j + 1) / NV), tc = 0.5f * (t0 + t1);
            float dOmega = (Mathf.Cos(t0) - Mathf.Cos(t1)) * (2f * Mathf.PI / NU);
            for (int i = 0; i < NU; i++)
            {
                float ph = 2f * Mathf.PI * (i + 0.5f) / NU;
                g.AddDirectionalLight(new Vector3(Mathf.Sin(tc) * Mathf.Cos(ph), Mathf.Cos(tc), Mathf.Sin(tc) * Mathf.Sin(ph)), gcol, dOmega / Mathf.PI);
            }
        }
        // AddDirectionalLight has its own normalisation: calibrate so that an up-facing surface receives exactly the
        // integrated sky term and a down-facing one exactly the ground radiance.
        var dirs = new[] { Vector3.up, Vector3.down, Vector3.forward, Vector3.back, Vector3.left, Vector3.right };
        var a = new Color[6]; var b = new Color[6];
        s.Evaluate(dirs, a); g.Evaluate(dirs, b);
        float expectUp = 0f;
        for (int i = 0; i < d.Length; i += 6) expectUp += d[i + 4] * Mathf.Max(0f, d[i + 1]);
        float kSky = expectUp / a[0].g, kGround = gcol.g / b[1].g;
        Debug.Log("TOWN sh calibration sky=" + kSky + " ground=" + kGround);
        s = s * kSky; g = g * kGround;
        sky = new float[27]; ground = new float[27];
        for (int c = 0; c < 3; c++) for (int i = 0; i < 9; i++) { sky[c * 9 + i] = s[c, i]; ground[c * 9 + i] = g[c, i]; }
        s.Evaluate(dirs, a); g.Evaluate(dirs, b);
        Debug.Log("TOWN sh sky up=" + a[0] + " down=" + a[1] + " +z=" + a[2] + " -z=" + a[3] + " -x=" + a[4] + " +x=" + a[5]);
        Debug.Log("TOWN sh ground up=" + b[0] + " down=" + b[1] + " +z=" + b[2]);
    }

    /// Soft orientation check of the reflection cubemap: direction of its brightest texel (should be near DirToSun).
    static void LogCubeSun(Cubemap cube)
    {
        if (cube == null) { Debug.LogWarning("TOWN reflection cubemap missing"); return; }
        try
        {
            float best = -1f; Vector3 bestDir = Vector3.zero; int n = cube.width;
            string means = "";
            for (int f = 0; f < 6; f++)
            {
                var px = cube.GetPixels((CubemapFace)f, 0);
                float sum = 0f; foreach (var c0 in px) sum += c0.g;
                means += " " + (CubemapFace)f + "=" + (sum / px.Length).ToString("0.000");
                for (int y = 0; y < n; y += 2)
                    for (int x = 0; x < n; x += 2)
                    {
                        var c = px[y * n + x]; float l = c.r + c.g + c.b;
                        if (l <= best) continue;
                        best = l;
                        float s = 2f * (x + 0.5f) / n - 1f, t = 2f * (y + 0.5f) / n - 1f;
                        switch ((CubemapFace)f)
                        {
                            case CubemapFace.PositiveX: bestDir = new Vector3(1, -t, -s); break;
                            case CubemapFace.NegativeX: bestDir = new Vector3(-1, -t, s); break;
                            case CubemapFace.PositiveY: bestDir = new Vector3(s, 1, t); break;
                            case CubemapFace.NegativeY: bestDir = new Vector3(s, -1, -t); break;
                            case CubemapFace.PositiveZ: bestDir = new Vector3(s, -t, 1); break;
                            default: bestDir = new Vector3(-s, -t, -1); break;
                        }
                    }
            }
            Debug.Log("TOWN reflection cube face means (expect -X > +Z > -Z,+X for a correctly oriented sky):" + means);
            Debug.Log("TOWN reflection cube size=" + cube.width + " mips=" + cube.mipmapCount + " format=" + cube.format + " brightest=" + best + " dir=" + bestDir.normalized + " expected=" + DirToSun.normalized);
        }
        catch (Exception e) { Debug.LogWarning("TOWN cube check failed: " + e.Message); }
    }

    // ------------------------------------------------------------------ post processing profile
    static VolumeProfile BuildProfile()
    {
        if (AssetDatabase.LoadAssetAtPath<VolumeProfile>(Profile) != null) AssetDatabase.DeleteAsset(Profile);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, Profile);

        var tm = AddFx<Tonemapping>(profile);
        tm.mode.Override((TonemappingMode)ToneMode);
        var ca = AddFx<ColorAdjustments>(profile);
        ca.postExposure.Override(PostExposure); ca.contrast.Override(Contrast); ca.saturation.Override(Saturation);
        var wb = AddFx<WhiteBalance>(profile);
        wb.temperature.Override(Temperature); wb.tint.Override(0f);
        var bl = AddFx<Bloom>(profile);
        bl.threshold.Override(1.1f); bl.intensity.Override(BloomIntensity); bl.scatter.Override(0.65f); bl.clamp.Override(12f); bl.highQualityFiltering.Override(true);
        var vg = AddFx<Vignette>(profile);
        vg.intensity.Override(VignetteIntensity); vg.smoothness.Override(0.45f);
        var lgg = AddFx<LiftGammaGain>(profile);
        lgg.lift.Override(new Vector4(1f, 1f, 1f, Lift)); lgg.gamma.Override(new Vector4(1f, 1f, 1f, Gamma)); lgg.gain.Override(new Vector4(1f, 1f, 1f, 0f));
        var fg = AddFx<FilmGrain>(profile);
        fg.type.Override(FilmGrainLookup.Thin1); fg.intensity.Override(GrainIntensity); fg.response.Override(0.8f);

        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();
        return profile;
    }

    static T AddFx<T>(VolumeProfile profile) where T : VolumeComponent
    {
        var c = profile.Add<T>(false);
        c.hideFlags = HideFlags.HideInInspector | HideFlags.HideInHierarchy;
        AssetDatabase.AddObjectToAsset(c, profile);
        return c;
    }

    // ------------------------------------------------------------------ editor-side preview (needs a GL context: run under xvfb WITHOUT -nographics)
    /// Unity ... -executeMethod TownSetup.Preview -townshots <dir> [-towntweak k=v;..] [-townviews file.json] [-townonly 1,2]
    public static void Preview()
    {
        var dir = TownShots.Arg("-townshots");
        if (string.IsNullOrEmpty(dir)) { Debug.Log("TOWNPREVIEW no -townshots dir"); return; }
        Directory.CreateDirectory(dir);
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var ts = Object.FindFirstObjectByType<TownShots>();
        ts.env.Apply();
        ts.LoadViewOverride(TownShots.Arg("-townviews"));
        var variants = (TownShots.Arg("-towntweak") ?? "").Split('|');
        var only = TownShots.Arg("-townonly");
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        float baseShadow = urp.shadowDistance, baseScale = urp.renderScale;
        int w = 1920, h = 1080;
        var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
        var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        for (int n = 0; n < variants.Length; n++)
        {
            ts.ApplyTweaks(variants[n]);
            // editor-only switches for tuning the SSAO feature: ssao=0/1, ssaoSrc=0/1, ssaoR=<radius>, ssaoI=<intensity>, ssaoD=<direct>
            foreach (var f in AssetDatabase.LoadAssetAtPath<ScriptableRendererData>(TownRenderer).rendererFeatures)
            {
                if (f == null) continue;
                var so = new SerializedObject(f);
                foreach (var kv in variants[n].Split(';'))
                {
                    var p = kv.Split('=');
                    if (p.Length != 2 || !p[0].StartsWith("ssao")) continue;
                    float val = float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture);
                    if (p[0] == "ssao") f.SetActive(val > 0f);
                    if (p[0] == "ssaoSrc") so.FindProperty("m_Settings.Source").intValue = (int)val;
                    if (p[0] == "ssaoR") so.FindProperty("m_Settings.Radius").floatValue = val;
                    if (p[0] == "ssaoI") so.FindProperty("m_Settings.Intensity").floatValue = val;
                    if (p[0] == "ssaoD") so.FindProperty("m_Settings.DirectLightingStrength").floatValue = val;
                }
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            for (int i = 0; i < ts.views.Length; i++)
            {
                if (!TownShots.Selected(only, i + 1)) continue;
                var v = ts.views[i];
                ts.Place(v);
                urp.shadowDistance = v.shadowDistance > 0f ? v.shadowDistance : baseShadow;
                ts.cam.targetTexture = rt;
                for (int k = 0; k < 2; k++) ts.cam.Render();
                RenderTexture.active = rt;
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0); tex.Apply();
                RenderTexture.active = null;
                var path = Path.Combine(dir, "prev_" + (i + 1).ToString("00") + (variants.Length > 1 ? "_" + (char)('a' + n) : "") + ".png");
                File.WriteAllBytes(path, tex.EncodeToPNG());
                Debug.Log("TOWNPREVIEW " + path + " " + v.name + " [" + variants[n] + "]");
            }
        }
        ts.cam.targetTexture = null;
        urp.shadowDistance = baseShadow; urp.renderScale = baseScale;
        Debug.Log("TOWNPREVIEW_DONE");
    }
}
