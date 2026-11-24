using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

/// Paints the big graffiti onto flat walls of the Town level (run with -executeMethod TownGraffiti.Apply).
public static class TownGraffiti
{
    struct Spot { public string tex; public Vector3 pos, normal; public float width; public Spot(string t, Vector3 p, Vector3 n, float w) { tex = t; pos = p; normal = n; width = w; } }

    // positions and wall normals in Unity coordinates (glTF x is negated on import)
    static readonly Spot[] Spots =
    {
        // the big clean wall in the east lane by the defenders' start: both lines, one above the other
        new Spot("graffiti_safarzod", new Vector3(-13.43f, 3.35f, -9.4f), new Vector3(-1, 0, 0), 6.0f),
        new Spot("graffiti_11a",      new Vector3(-13.43f, 1.80f, -9.4f), new Vector3(-1, 0, 0), 5.6f),
        // the wooden gate that closes the south-east gap, seen from the south street
        new Spot("graffiti_safarzod", new Vector3(-9.5f, 2.15f, 9.18f), new Vector3(-0.24f, 0, 0.97f), 3.1f),
    };

    public static void Apply()
    {
        const string dir = "Assets/Town/Graffiti";
        var scene = EditorSceneManager.OpenScene("Assets/Scenes/Town.unity", OpenSceneMode.Single);
        var old = GameObject.Find("Graffiti");
        if (old != null) Object.DestroyImmediate(old);
        var root = new GameObject("Graffiti");
        foreach (var s in Spots)
        {
            string texPath = dir + "/" + s.tex + ".png";
            var ti = (TextureImporter)AssetImporter.GetAtPath(texPath);
            if (ti != null && (!ti.alphaIsTransparency || ti.maxTextureSize != 2048 || ti.wrapMode != TextureWrapMode.Clamp))
            {
                ti.alphaIsTransparency = true; ti.maxTextureSize = 2048; ti.wrapMode = TextureWrapMode.Clamp; ti.mipmapEnabled = true; ti.anisoLevel = 8; ti.sRGBTexture = true;
                ti.SaveAndReimport();
            }
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
            string matPath = dir + "/" + s.tex + ".mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
            if (mat == null)
            {
                mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(mat, matPath);
            }
            mat.SetTexture("_BaseMap", tex); mat.mainTexture = tex;
            mat.SetColor("_BaseColor", new Color(1f, 1f, 1f, 0.93f));
            mat.SetFloat("_Surface", 1f); mat.SetFloat("_Blend", 0f); mat.SetFloat("_Smoothness", 0.12f); mat.SetFloat("_Metallic", 0f);
            mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One); mat.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_ZWrite", 0f); mat.SetFloat("_AlphaClip", 0f); mat.SetFloat("_ReceiveShadows", 1f);
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)RenderQueue.Transparent;
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); mat.DisableKeyword("_ALPHATEST_ON"); mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.SetShaderPassEnabled("ShadowCaster", false); mat.SetShaderPassEnabled("DepthOnly", false);
            EditorUtility.SetDirty(mat);

            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.DestroyImmediate(q.GetComponent<Collider>());
            q.name = s.tex;
            q.transform.SetParent(root.transform, false);
            float aspect = tex != null ? (float)tex.height / tex.width : 0.3125f;
            q.transform.position = s.pos + s.normal.normalized * 0.035f;
            q.transform.rotation = Quaternion.LookRotation(-s.normal.normalized, Vector3.up);
            q.transform.localScale = new Vector3(s.width, s.width * aspect, 1f);
            var mr = q.GetComponent<MeshRenderer>();
            mr.sharedMaterial = mat; mr.shadowCastingMode = ShadowCastingMode.Off; mr.receiveShadows = true;
        }
        AssetDatabase.SaveAssets();
        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
        Debug.Log("GRAFFITI_DONE " + Spots.Length);
    }
}
