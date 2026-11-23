using System.IO;
using System.Linq;
using System.Reflection;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class Build
{
    const string ScenePath = "Assets/Scenes/Bazaar.unity";

    static void Dir(string p) { if (!Directory.Exists(p)) Directory.CreateDirectory(p); }

    public static void SetupProject()
    {
        Dir("Assets/Settings"); Dir("Assets/Scenes"); Dir("Assets/Prefabs"); Dir("Assets/Resources/Mat");

        // --- render pipeline
        var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/URP.asset");
        if (urp == null)
        {
            var mi = typeof(UniversalRenderPipelineAsset).GetMethod("CreateRendererAsset", BindingFlags.NonPublic | BindingFlags.Static);
            var rd = (ScriptableRendererData)mi.Invoke(null, new object[] { "Assets/Settings/URP_Renderer.asset", RendererType.UniversalRenderer, false, "Renderer" });
            urp = UniversalRenderPipelineAsset.Create(rd);
            AssetDatabase.CreateAsset(urp, "Assets/Settings/URP.asset");
        }
        urp.shadowDistance = 45f; urp.msaaSampleCount = 2; urp.supportsHDR = false; urp.renderScale = 1f;
        urp.shadowCascadeCount = 2; urp.mainLightShadowmapResolution = 2048;
        EditorUtility.SetDirty(urp);
        GraphicsSettings.defaultRenderPipeline = urp;
        for (int i = 0; i < QualitySettings.names.Length; i++) { QualitySettings.SetQualityLevel(i, false); QualitySettings.renderPipeline = urp; }

        // --- material templates (keeps the shaders in builds)
        var lit = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        AssetDatabase.CreateAsset(lit, "Assets/Resources/Mat/Lit.mat");
        var fx = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit"));
        fx.SetFloat("_Surface", 1); fx.SetFloat("_Blend", 2);
        fx.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha); fx.SetInt("_DstBlend", (int)BlendMode.One); fx.SetInt("_ZWrite", 0);
        fx.SetOverrideTag("RenderType", "Transparent"); fx.renderQueue = 3000; fx.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        AssetDatabase.CreateAsset(fx, "Assets/Resources/Mat/Fx.mat");
        AssetDatabase.CreateAsset(new Material(Shader.Find("Skybox/Procedural")), "Assets/Resources/Mat/Sky.mat");

        // --- player prefab
        var pgo = new GameObject("Player");
        var cc = pgo.AddComponent<CharacterController>();
        cc.height = 1.8f; cc.radius = 0.32f; cc.center = new Vector3(0, 0.9f, 0); cc.stepOffset = 0.4f; cc.slopeLimit = 50f; cc.skinWidth = 0.03f;
        pgo.AddComponent<NetworkObject>();
        pgo.AddComponent<Player>();
        var prefab = PrefabUtility.SaveAsPrefabAsset(pgo, "Assets/Prefabs/Player.prefab");
        Object.DestroyImmediate(pgo);
        var list = ScriptableObject.CreateInstance<NetworkPrefabsList>();
        list.Add(new NetworkPrefab { Prefab = prefab });
        AssetDatabase.CreateAsset(list, "Assets/Settings/NetworkPrefabs.asset");

        // --- scene
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var cam = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener));
        cam.tag = "MainCamera"; cam.transform.position = new Vector3(0, 16, -34); cam.transform.rotation = Quaternion.Euler(28, 0, 0);
        var c = cam.GetComponent<Camera>(); c.nearClipPlane = 0.05f; c.farClipPlane = 400f; c.fieldOfView = 68f;
        cam.AddComponent<UniversalAdditionalCameraData>();

        var nmGo = new GameObject("NetworkManager");
        var nm = nmGo.AddComponent<NetworkManager>();
        var ut = nmGo.AddComponent<UnityTransport>();
        nm.NetworkConfig = new NetworkConfig { NetworkTransport = ut, EnableSceneManagement = false, TickRate = 30, ConnectionApproval = false };
        nm.NetworkConfig.Prefabs.NetworkPrefabsLists.Add(list);

        var map = new GameObject("MapBuilder", typeof(MapBuilder));
        var surface = map.AddComponent<Unity.AI.Navigation.NavMeshSurface>();
        surface.collectObjects = Unity.AI.Navigation.CollectObjects.All;
        surface.useGeometry = UnityEngine.AI.NavMeshCollectGeometry.PhysicsColliders;

        var gameGo = new GameObject("Game");
        gameGo.AddComponent<NetworkObject>();
        gameGo.AddComponent<Game>().playerPrefab = prefab;
        new GameObject("Hud", typeof(Hud));

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

        // --- player settings
        PlayerSettings.companyName = "Safarzod"; PlayerSettings.productName = "Bazar";
        PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.safarzod.bazar");
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
        PlayerSettings.runInBackground = true;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel25;
        PlayerSettings.Android.forceInternetPermission = true;
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan, GraphicsDeviceType.OpenGLES3 });
        AssetDatabase.SaveAssets();
        Debug.Log("SETUP_OK");
    }

    public static void Linux()
    {
        Dir("Builds/linux");
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Builds/linux/bazar.x86_64", target = BuildTarget.StandaloneLinux64, options = BuildOptions.Development });
        Debug.Log("BUILD_RESULT " + r.summary.result + " errors=" + r.summary.totalErrors);
        EditorApplication.Exit(r.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
    }

    public static void Android()
    {
        Dir("Builds/android");
        EditorUserBuildSettings.buildAppBundle = false;
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Builds/android/bazar.apk", target = BuildTarget.Android, options = BuildOptions.None });
        Debug.Log("BUILD_RESULT " + r.summary.result + " errors=" + r.summary.totalErrors + " size=" + r.summary.totalSize);
        EditorApplication.Exit(r.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
    }
}
