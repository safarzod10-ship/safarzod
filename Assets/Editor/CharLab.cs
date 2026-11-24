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
        RenderSettings.ambientLight = new Color(0.78f, 0.8f, 0.84f);
        var l = new GameObject("Sun").AddComponent<Light>(); l.type = LightType.Directional; l.intensity = 1.7f;
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

    /// Saves Assets/Scenes/CharLab.unity: ground, light, camera and the CharLabDemo driver (press Play to watch the fighters).
    public static void BuildScene()
    {
        NewLabScene();
        new GameObject("CharLabDemo").AddComponent<CharLabDemo>();
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), "Assets/Scenes/CharLab.unity");
        Debug.Log("LAB scene saved");
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

    // ------------------------------------------------------------------ proof sheets
    static readonly int[] LabWeapons = { 0, 1, 4, 16, 21 };   // knife, usp, deagle, ak, awp
    const float Dt = 1f / 30f;

    static CharBody Spawn(string key, int weapon, Vector3 pos)
    {
        var holder = new GameObject("Holder_" + key); holder.transform.position = pos;
        var b = CharBody.Create(holder.transform, key);
        b.manual = true; b.SetWeapon(weapon, true);
        return b;
    }
    static void Run(CharBody b, int steps) { for (int i = 0; i < steps; i++) b.Step(Dt); }
    public static void DebugDeath()
    {
        NewLabScene();
        var b = Spawn("ct1", 16, Vector3.zero);
        Run(b, 20); Debug.Log($"LAB alive hips {b.rig.hips.position} head {b.rig.head.position}");
        b.Die(0);
        for (int i = 0; i < 6; i++) { Run(b, 25); Debug.Log($"LAB dead step {(i + 1) * 25} hips {b.rig.hips.position} head {b.rig.head.position} info {b.DebugInfo()}"); }
        var clip = b.rig.clips.death;
        foreach (float t in new[] { 0f, 1f, 2f, 3f, 3.4f }) { clip.SampleAnimation(b.gameObject, t); Debug.Log($"LAB sample {t} hips {b.rig.hips.position} len {clip.length}"); }
    }
    static void Clear() { foreach (var g in Object.FindObjectsByType<GameObject>(FindObjectsSortMode.None)) if (g != null && g.name.StartsWith("Holder_")) Object.DestroyImmediate(g); baked.Clear(); }

    /// (a) every character x {idle, walk, run, crouch idle, reload mid, death end} with the AKM
    public static void SheetStates()
    {
        var cam = NewLabScene();
        string only = CharSetup.Arg("-chars"); int wid = int.Parse(CharSetup.Arg("-weapon") ?? "16");
        var keys = CharSetup.Keys.Where(k => only == null || only.Split(',').Contains(k)).ToArray();
        var sheet = new Sheet(cam, 6, keys.Length, 400, 400);
        for (int r = 0; r < keys.Length; r++)
            for (int c = 0; c < 6; c++)
            {
                var b = Spawn(keys[r], wid, Vector3.zero);
                switch (c)
                {
                    case 0: Run(b, 30); break;
                    case 1: b.speed = 2f; Run(b, 44); break;
                    case 2: b.speed = 4.6f; Run(b, 40); break;
                    case 3: b.crouch = true; Run(b, 30); break;
                    case 4: Run(b, 20); b.Reload(2.5f); Run(b, 24); break;
                    case 5: Run(b, 20); b.Die(r == 1 ? 1 : r == 2 ? 2 : 0); if (r == 1) b.crouch = true; Run(b, 150); break;
                }
                Vector3 look = b.rig.hips.position; look.y = c == 5 ? 0.25f : c == 3 ? 0.75f : 0.95f;
                sheet.Shot(c, r, look + new Vector3(-1.5f, c == 5 ? 1.3f : 0.35f, 2.9f), look, c == 5 ? 34f : 30f);
                Clear();
            }
        sheet.Save("a_states_" + Weapons.Get(wid).key);
    }

    /// (b) the five weapons held by ct1 and t1, third person: front-left, right side, plus a wider front view
    public static void SheetHold()
    {
        var cam = NewLabScene();
        string only = CharSetup.Arg("-chars") ?? "ct1,t1";
        foreach (var key in only.Split(','))
        {
            var sheet = new Sheet(cam, 3, LabWeapons.Length, 520, 400);
            for (int r = 0; r < LabWeapons.Length; r++)
            {
                var b = Spawn(key, LabWeapons[r], Vector3.zero);
                if (LabWeapons[r] == 0) b.speed = 1.2f;
                Run(b, 30);
                Vector3 mid = (b.rig.right.hand.position + b.rig.left.hand.position) * 0.5f;
                if (LabWeapons[r] == 0) mid = b.rig.right.hand.position;
                sheet.Shot(0, r, mid + new Vector3(-0.55f, 0.18f, 0.85f), mid, 40f);
                sheet.Shot(1, r, mid + new Vector3(1.05f, 0.08f, 0.1f), mid + Vector3.forward * 0.08f, 40f);
                sheet.Shot(2, r, new Vector3(-1.2f, 1.25f, 2.6f), new Vector3(0, 0.95f, 0.1f), 32f);
                Clear();
            }
            sheet.Save("b_hold_" + key);
        }
    }

    /// third-person actions: reload phases, weapon switch, aim pitch, pistol / sniper / knife states
    public static void SheetActions()
    {
        var cam = NewLabScene();
        string only = CharSetup.Arg("-chars") ?? "ct1";
        foreach (var key in only.Split(','))
        {
            var sheet = new Sheet(cam, 8, 3, 380, 380);
            for (int r = 0; r < 3; r++)
                for (int c = 0; c < 8; c++)
                {
                    int wid = r == 0 ? 16 : r == 1 ? 1 : c < 4 ? 21 : 0;
                    var b = Spawn(key, wid, Vector3.zero);
                    Run(b, 20);
                    float[] us = r == 0 ? new[] { 0.15f, 0.3f, 0.5f, 0.78f } : new[] { 0.2f, 0.3f, 0.6f, 0.82f };
                    if (r < 2)
                    {
                        if (c < 4) { b.Reload(3f); Run(b, Mathf.RoundToInt(us[c] * 90f)); }
                        else if (c == 4 && r == 0) { b.SetWeapon(1); Run(b, 5); }
                        else if (c == 4) { b.Shot(); b.Step(0.02f); }
                        else if (c == 5) { b.pitch = -40f; Run(b, 10); }
                        else if (c == 6) { b.pitch = 40f; Run(b, 10); }
                        else { b.speed = 4.6f; Run(b, 40); }
                    }
                    else
                    {
                        if (c == 1) { b.Shot(); Run(b, 19); }
                        else if (c == 2) { b.crouch = true; Run(b, 30); }
                        else if (c == 3) { b.speed = 2f; Run(b, 44); }
                        else if (c == 4) Run(b, 30);
                        else if (c == 5) { b.speed = 4.6f; Run(b, 40); }
                        else if (c == 6) { b.speed = 1f; Run(b, 30); b.Shot(); Run(b, 5); }
                        else if (c == 7) { b.crouch = true; Run(b, 30); }
                    }
                    Vector3 look = b.rig.hips.position; look.y = b.crouch ? 0.8f : 1.1f;
                    sheet.Shot(c, r, look + new Vector3(-1.3f, 0.3f, 2.2f), look, 30f);
                    Clear();
                }
            sheet.Save("e_actions_" + key);
        }
    }

    /// close-ups of both hands on every weapon (tuning aid): right hand from the right, left hand from the left, both from below-front
    public static void SheetHands()
    {
        var cam = NewLabScene();
        string only = CharSetup.Arg("-chars") ?? "ct1,t1";
        foreach (var key in only.Split(','))
        {
            var sheet = new Sheet(cam, 4, LabWeapons.Length, 440, 360);
            for (int r = 0; r < LabWeapons.Length; r++)
            {
                var b = Spawn(key, LabWeapons[r], Vector3.zero);
                if (LabWeapons[r] == 0) b.speed = 1.2f;
                Run(b, 30);
                Vector3 gr = b.weapon.gripR.position, gl = b.weapon.gripL ? b.weapon.gripL.position : b.rig.left.hand.position;
                sheet.Shot(0, r, gr + new Vector3(0.5f, 0.06f, 0.06f), gr + new Vector3(0, 0.02f, 0.03f), 28f);
                sheet.Shot(1, r, gl + new Vector3(-0.5f, 0.04f, 0.12f), gl + new Vector3(0, 0.0f, 0.0f), 28f);
                Vector3 mid = (gr + gl) * 0.5f;
                sheet.Shot(2, r, mid + new Vector3(0.12f, -0.45f, 0.35f), mid, 34f);
                sheet.Shot(3, r, mid + new Vector3(0.10f, 0.42f, -0.36f), mid + new Vector3(0, 0, 0.05f), 34f);
                Clear();
            }
            sheet.Save("hands_" + key);
        }
    }

    /// (c) first-person frames for the five weapons: idle, firing, mid-reload (knife: mid-swing), mid-switch
    public static void SheetFp()
    {
        var cam = NewLabScene();
        string only = CharSetup.Arg("-chars") ?? "ct1,t1";
        cam.transform.position = new Vector3(0, 1.6f, 0); cam.transform.rotation = Quaternion.Euler(2f, 0, 0); cam.fieldOfView = 68f; cam.nearClipPlane = 0.05f;
        foreach (var key in only.Split(','))
        {
            int tw = int.Parse(CharSetup.Arg("-tw") ?? "640"), th = tw * 9 / 16;
            int[] rows = (CharSetup.Arg("-rows") ?? "0,1,2,3,4").Split(',').Select(int.Parse).ToArray(), cols = (CharSetup.Arg("-cols") ?? "0,1,2,3").Split(',').Select(int.Parse).ToArray();
            var sheet = new Sheet(cam, cols.Length, rows.Length, tw, th);
            for (int ri = 0; ri < rows.Length; ri++)
                for (int ci = 0; ci < cols.Length; ci++)
                {
                    int r = rows[ri], c = cols[ci];
                    var fp = FpView.Create(cam.transform); fp.gameObject.name = "Holder_fp";
                    var st = new FpView.State { weapon = LabWeapons[r], charKey = key, reloadU = -1f, sinceShot = 9f };
                    if (c == 3) { st.weapon = LabWeapons[(r + 1) % LabWeapons.Length]; }
                    for (int i = 0; i < 10; i++) fp.Tick(st, Dt);
                    if (c == 1) { fp.Fire(); st.sinceShot = 0.03f; fp.Tick(st, 0.03f); }
                    if (c == 2) { if (LabWeapons[r] == 0) { fp.Fire(); for (int i = 0; i < 5; i++) fp.Tick(st, Dt); } else { st.reloadU = float.Parse(CharSetup.Arg("-reloadu") ?? "0.3", System.Globalization.CultureInfo.InvariantCulture); fp.Tick(st, Dt); } }
                    if (c == 3) { st.weapon = LabWeapons[r]; for (int i = 0; i < 11; i++) fp.Tick(st, Dt); }
                    if (c >= 4) { st.reloadU = (c - 4) / 10f + 0.05f; fp.Tick(st, Dt); }     // reload strip: columns 4..13 = u 0.05 .. 0.95
                    sheet.Shot(ci, ri);
                    Clear();
                }
            sheet.Save((CharSetup.Arg("-name") ?? "c_fp_") + key);
        }
    }

    /// (d) every prepared weapon from the right side and from above with its markers drawn (GripR red, GripL green, Muzzle yellow, MagGrip blue, SlideGrip magenta)
    public static void SheetWeapons()
    {
        var cam = NewLabScene();
        GameObject.Find("Ground").SetActive(false);
        cam.orthographic = true;
        var sheet = new Sheet(cam, 2, LabWeapons.Length, 800, 300);
        var lit = AssetDatabase.LoadAssetAtPath<Material>("Assets/Resources/Mat/Fx.mat");
        for (int r = 0; r < LabWeapons.Length; r++)
        {
            var d = Weapons.Get(LabWeapons[r]);
            var holder = new GameObject("Holder_w"); holder.transform.position = new Vector3(0, 1, 0);
            var wh = new GameObject("Holder_w2"); wh.transform.position = new Vector3(0, 1, 0);
            var go = Object.Instantiate(Resources.Load<GameObject>("Weapons/" + d.key), wh.transform);
            var w = go.GetComponent<WeaponRig>();
            var marks = new (Transform, Color)[] { (w.gripR, Color.red), (w.gripL, Color.green), (w.muzzle, Color.yellow), (w.magGrip, Color.blue), (w.slideGrip, Color.magenta) };
            foreach (var (t, col) in marks)
            {
                if (t == null) continue;
                var s = GameObject.CreatePrimitive(PrimitiveType.Sphere); s.transform.SetParent(holder.transform, false);
                s.transform.position = t.position; s.transform.localScale = Vector3.one * 0.012f;
                var m = new Material(lit); m.SetColor("_BaseColor", col); s.GetComponent<Renderer>().sharedMaterial = m;
                foreach (var (axis, len) in new[] { (Vector3.forward, 0.05f), (Vector3.up, 0.03f) })
                {
                    var l = GameObject.CreatePrimitive(PrimitiveType.Cube); l.transform.SetParent(holder.transform, false);
                    l.transform.position = t.position + t.rotation * axis * len * 0.5f; l.transform.rotation = t.rotation;
                    l.transform.localScale = new Vector3(0.003f, 0.003f, 0.003f) + axis * len; l.GetComponent<Renderer>().sharedMaterial = m;
                }
            }
            var b = new Bounds(go.transform.position, Vector3.zero);
            foreach (var mr in go.GetComponentsInChildren<MeshRenderer>()) b.Encapsulate(mr.bounds);
            cam.orthographicSize = Mathf.Max(b.size.z * 0.5f * 300f / 800f, b.size.y * 0.5f) * 1.15f;
            cam.transform.position = b.center + Vector3.right * 2f; cam.transform.rotation = Quaternion.LookRotation(Vector3.left, Vector3.up);
            holder.transform.position = new Vector3(0.3f, 1, 0);          // markers in front of the model for this view
            sheet.Shot(0, r);
            cam.transform.position = b.center + Vector3.up * 2f; cam.transform.rotation = Quaternion.LookRotation(Vector3.down, Vector3.left);
            holder.transform.position = new Vector3(0, 1.3f, 0);
            sheet.Shot(1, r);
            Clear();
        }
        sheet.Save("d_weapons");
    }
}
