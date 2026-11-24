using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// Contact-sheet renders that prove the character / weapon work. Needs a GL context:
/// xvfb-run -a -s "-screen 0 1280x720x24" Unity -batchmode -force-glcore -quit -projectPath . -executeMethod CharLab.<Method> -labout <dir>
public static partial class CharLab
{
    public class Sheet
    {
        public readonly Texture2D tex; readonly RenderTexture rt; public readonly Camera cam; readonly int tw, th, rows;
        public Sheet(Camera cam, int cols, int rows, int tw = 480, int th = 360)
        {
            this.cam = cam; this.tw = tw; this.th = th; this.rows = rows;
            tex = new Texture2D(cols * tw, rows * th, TextureFormat.RGB24, false);
            rt = new RenderTexture(tw, th, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
        }
        public void Shot(int col, int row, Vector3 pos, Vector3 look, float fov = 30f)
        {
            cam.transform.position = pos; cam.transform.rotation = Quaternion.LookRotation(look - pos); cam.fieldOfView = fov;
            Shot(col, row);
        }
        public void Shot(int col, int row)
        {
            BakeSkins();
            var sun = GameObject.Find("Sun");
            if (sun) sun.transform.rotation = cam.transform.rotation * Quaternion.Euler(38f, 28f, 0);
            cam.aspect = tw / (float)th;
            cam.targetTexture = rt; cam.Render(); cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, tw, th), col * tw, (rows - 1 - row) * th); 
            RenderTexture.active = null; cam.targetTexture = null;
        }
        public void Save(string name)
        {
            tex.Apply();
            string dir = CharSetup.Arg("-labout") ?? "/tmp/claude-0/-home-user-safarzod/c42128fe-0193-50cc-948b-d4f4ab93dd76/scratchpad/chars/out";
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, name + ".png"), tex.EncodeToPNG());
            Debug.Log("LAB saved " + Path.Combine(dir, name + ".png"));
        }
    }

    // Skinned meshes are not re-skinned between manual Camera.Render calls in edit mode, so the lab draws CPU-baked copies.
    static readonly System.Collections.Generic.Dictionary<SkinnedMeshRenderer, Mesh> baked = new System.Collections.Generic.Dictionary<SkinnedMeshRenderer, Mesh>();
    public static void BakeSkins()
    {
        foreach (var r in Object.FindObjectsByType<SkinnedMeshRenderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
        {
            if (!baked.TryGetValue(r, out var m) || m == null)
            {
                m = new Mesh { name = "baked" }; baked[r] = m;
                var go = new GameObject("Baked"); go.transform.SetParent(r.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = m;
                var mr = go.AddComponent<MeshRenderer>(); mr.sharedMaterials = r.sharedMaterials; mr.shadowCastingMode = r.shadowCastingMode;
                r.forceRenderingOff = true;
            }
            r.BakeMesh(m, true);
            m.RecalculateBounds();
        }
    }

    public static Camera NewLabScene()
    {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
        return BuildLabObjects();
    }

    public static Camera BuildLabObjects()
    {
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.52f, 0.54f, 0.58f);
        var l = new GameObject("Sun").AddComponent<Light>(); l.type = LightType.Directional; l.intensity = 1.25f;
        l.transform.rotation = Quaternion.Euler(48f, -35f, 0); l.shadows = LightShadows.Soft;
        var g = GameObject.CreatePrimitive(PrimitiveType.Plane); g.name = "Ground"; g.transform.localScale = Vector3.one * 6f;
        var m = new Material(AssetDatabase.LoadAssetAtPath<Material>("Assets/Resources/Mat/Lit.mat")); m.SetColor("_BaseColor", new Color(0.42f, 0.44f, 0.42f)); m.name = "LabGround";
        if (!AssetDatabase.IsValidFolder("Assets/Chars/Gen")) AssetDatabase.CreateFolder("Assets/Chars", "Gen");
        AssetDatabase.DeleteAsset("Assets/Chars/Gen/LabGround.mat"); AssetDatabase.CreateAsset(m, "Assets/Chars/Gen/LabGround.mat");
        g.GetComponent<Renderer>().sharedMaterial = m;
        var cam = new GameObject("LabCamera").AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color(0.62f, 0.68f, 0.74f); cam.nearClipPlane = 0.03f; cam.farClipPlane = 60f;
        cam.tag = "MainCamera";
        return cam;
    }

    /// Raw retarget check: every character sampled straight from its baked clips, no weapon, no IK.
    public static void PoseSheet()
    {
        var cam = NewLabScene();
        string[] cols = { "idle@0", "idleRifle@0", "walk@0.25", "run@0.3", "crouchIdle@0", "crouchWalk@0.5", "shoot@0", "reloadIdle@0.4", "jump@0.7", "death@1", "deathCrouch@1", "deathProne@1" };
        var sheet = new Sheet(cam, cols.Length / 2, CharSetup.Keys.Length * 2, 360, 360);
        for (int r = 0; r < CharSetup.Keys.Length; r++)
        {
            var go = Object.Instantiate(Resources.Load<GameObject>("Chars/" + CharSetup.Keys[r]));
            var rig = go.GetComponent<CharRig>();
            for (int c = 0; c < cols.Length; c++)
            {
                var p = cols[c].Split('@');
                var clip = (AnimationClip)typeof(CharClips).GetField(p[0]).GetValue(rig.clips);
                clip.SampleAnimation(go, clip.length * float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture));
                Vector3 c0 = rig.hips.position; c0.y = Mathf.Max(0.5f, c0.y * 0.5f + 0.45f);
                sheet.Shot(c % 6, r * 2 + c / 6, c0 + new Vector3(-2.1f, 0.5f, 3.3f), c0, 28f);
            }
            Object.DestroyImmediate(go);
        }
        sheet.Save("pose_sheet");
    }
}
