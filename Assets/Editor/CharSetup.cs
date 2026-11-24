using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

/// Builds the four fighter prefabs (Resources/Chars/ct1|ct2|t1|t2 and *_fp arms) from Assets/Chars/Src and bakes the
/// rifle animation pack onto each skeleton.   Unity -batchmode -nographics -quit -executeMethod CharSetup.BuildChars [-chars ct1,t1]
public static partial class CharSetup
{
    public const string Src = "Assets/Chars/Src", Gen = "Assets/Chars/Gen", OutDir = "Assets/Resources/Chars";
    public static readonly string[] Keys = { "ct1", "ct2", "t1", "t2" };
    static readonly string[] Body = { "Hips", "Spine", "SpineMid", "Chest", "Neck", "Head",
        "LShoulder", "LArm", "LFore", "LHand", "RShoulder", "RArm", "RFore", "RHand",
        "LUpLeg", "LLeg", "LFoot", "LToe", "RUpLeg", "RLeg", "RFoot", "RToe" };
    static readonly string[] FingerNames = { "Thumb", "Index", "Middle", "Ring", "Pinky" };

    public static string Arg(string name)
    {
        var a = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
        return null;
    }

    // ------------------------------------------------------------------ skeleton analysis
    public class Skel
    {
        public string key;
        public GameObject root, model;
        public Transform pivot, rootJoint;
        public readonly Dictionary<string, Transform> b = new Dictionary<string, Transform>();
        public Transform this[string k] => b.TryGetValue(k, out var t) ? t : null;
        public Quaternion[] refRot = new Quaternion[Body.Length];
        public float legLen, ankleH;
        public bool threeFingers;
        public Vector3 KnuckleCentre(string s) => (this[s + "Index1"].position + this[s + (threeFingers ? "Middle1" : "Pinky1")].position) * 0.5f;
        public Vector3 PalmNormal(string s)
        {
            Vector3 w = this[s + "Hand"].position, f = (KnuckleCentre(s) - w).normalized;
            Vector3 t = this[s + "Index1"].position - this[s + (threeFingers ? "Middle1" : "Pinky1")].position;
            return (s == "R" ? 1f : -1f) * Vector3.Cross(f, t).normalized;
        }
    }

    static string NormName(string n)
    {
        int c = n.IndexOf(':'); if (c >= 0) n = n.Substring(c + 1);
        string p;
        do { p = n; n = Regex.Replace(n, @"_\d+$", ""); } while (p != n);
        return n;
    }

    static string Canon(string n)
    {
        switch (n)
        {
            case "Hips": case "hip": return "Hips";
            case "Spine": case "spine": return "Spine";
            case "chest": return "Chest";
            case "Neck": case "neck": return "Neck";
            case "Head": case "head": return "Head";
        }
        string side = null, rest = null;
        if (n.StartsWith("Left")) { side = "L"; rest = n.Substring(4); }
        else if (n.StartsWith("Right")) { side = "R"; rest = n.Substring(5); }
        else if (n.StartsWith("L_")) { side = "L"; rest = n.Substring(2); }
        else if (n.StartsWith("R_")) { side = "R"; rest = n.Substring(2); }
        if (side == null) return n;
        switch (rest)
        {
            case "Shoulder": case "shoulder": return side + "Shoulder";
            case "Arm": case "arm": return side + "Arm";
            case "ForeArm": case "elbow": return side + "Fore";
            case "Hand": case "wrist": return side + "Hand";
            case "UpLeg": case "leg": return side + "UpLeg";
            case "Leg": case "knee": return side + "Leg";
            case "Foot": case "ankle": return side + "Foot";
            case "ToeBase": case "foot": return side + "Toe";
        }
        var m = Regex.Match(rest, @"^(?:Hand)?(Thumb|Index|Middle|Ring|Pinky|thumb|point|middle|ring|pink)(\d)$");
        if (m.Success)
        {
            string f = m.Groups[1].Value.ToLower();
            f = f == "point" ? "Index" : f == "pink" ? "Pinky" : char.ToUpper(f[0]) + f.Substring(1);
            return side + f + m.Groups[2].Value;
        }
        return n;
    }

    public static Skel LoadSkel(string key)
    {
        var src = AssetDatabase.LoadAssetAtPath<GameObject>($"{Src}/{key}/{key}.gltf");
        if (src == null) throw new System.Exception("missing model " + key);
        var s = new Skel { key = key, model = Object.Instantiate(src) };
        s.model.name = "Model";
        foreach (var a in s.model.GetComponentsInChildren<Animator>()) Object.DestroyImmediate(a);
        foreach (var a in s.model.GetComponentsInChildren<Animation>()) Object.DestroyImmediate(a);
        var smrs = s.model.GetComponentsInChildren<SkinnedMeshRenderer>();
        var bones = new HashSet<Transform>();
        foreach (var r in smrs) foreach (var bn in r.bones) if (bn) bones.Add(bn);
        foreach (var t in bones)
        {
            string c = Canon(NormName(t.name));
            if (!s.b.ContainsKey(c)) s.b[c] = t;
        }
        if (s["Chest"] == null)
        {
            if (s["Spine2"] != null) { s.b["Chest"] = s["Spine2"]; s.b["SpineMid"] = s["Spine1"]; }
            else s.b["Chest"] = s["Spine1"];
        }
        s.threeFingers = s["RPinky1"] == null;
        s.rootJoint = bones.First(t => !bones.Contains(t.parent));

        // loose rigid parts (patches) are placed for the stored pose: glue them to the nearest bone
        foreach (var mr in s.model.GetComponentsInChildren<MeshRenderer>())
        {
            if (mr.GetComponentsInParent<Transform>().Any(bones.Contains)) continue;
            Vector3 c = mr.bounds.center; Transform best = null; float bd = 1e9f;
            foreach (var bn in bones)
                foreach (Transform ch in bn)
                {
                    if (!bones.Contains(ch)) continue;
                    Vector3 a = bn.position, d = ch.position - a;
                    float u = Mathf.Clamp01(Vector3.Dot(c - a, d) / Mathf.Max(1e-9f, d.sqrMagnitude));
                    float dist = Vector3.Distance(c, a + d * u);
                    if (dist < bd) { bd = dist; best = bn; }
                }
            Debug.Log($"CHAR {key}: rigid part {mr.name} -> {best.name}");
            mr.transform.parent.SetParent(best, true);
        }

        // bind pose. The meshes live in a canonical space (Y up, +Z forward); a bone's bind matrix there is bindpose^-1,
        // scaled by whatever uniform scale the node hierarchy gives the bones (wrapper nodes have arbitrary transforms).
        var bind = new Dictionary<Transform, Matrix4x4>();
        Bounds bb = new Bounds(); bool first = true;
        foreach (var r in smrs)
        {
            var bp = r.sharedMesh.bindposes; int hi = System.Array.IndexOf(r.bones, s["Hips"]);
            if (hi < 0) { Debug.LogWarning($"CHAR {key}: {r.name} has no hips joint"); continue; }
            float sC = s["Hips"].lossyScale.x * bp[hi].lossyScale.x;
            Matrix4x4 baseM = Matrix4x4.Scale(Vector3.one * sC);
            for (int i = 0; i < bp.Length; i++)
            {
                var inv = bp[i].inverse;
                if (r.bones[i] == null || bind.ContainsKey(r.bones[i])) continue;
                if (((Vector3)inv.GetColumn(3)).sqrMagnitude < 1e-12f) continue;      // unbound helper joint: keep its local pose
                bind[r.bones[i]] = baseM * inv;
            }
            var mb = r.sharedMesh.bounds;
            for (int k = 0; k < 8; k++)
            {
                Vector3 p = baseM.MultiplyPoint3x4(mb.center + Vector3.Scale(mb.extents, new Vector3((k & 1) * 2 - 1, (k >> 1 & 1) * 2 - 1, (k >> 2 & 1) * 2 - 1)));
                if (first) { bb = new Bounds(p, Vector3.zero); first = false; } else bb.Encapsulate(p);
            }
        }
        foreach (var t in bind.Keys.OrderBy(Depth)) { var m = bind[t]; t.SetPositionAndRotation(m.GetColumn(3), m.rotation); }

        // normalise: feet on the ground at the origin, 1.80 m tall, facing +Z
        Vector3 fwd = s["LToe"].position + s["RToe"].position - s["LFoot"].position - s["RFoot"].position; fwd.y = 0;
        s.root = new GameObject(key);
        s.pivot = new GameObject("Pivot").transform; s.pivot.SetParent(s.root.transform, false);
        s.model.transform.SetParent(s.pivot, true);
        float sc = 1.8f / bb.size.y;
        Quaternion rot = Quaternion.FromToRotation(fwd.normalized, Vector3.forward);
        Vector3 c0 = new Vector3(s["Hips"].position.x, bb.min.y, s["Hips"].position.z);
        s.pivot.localScale = Vector3.one * sc; s.pivot.localRotation = rot; s.pivot.localPosition = -(rot * c0) * sc;
        Debug.Log($"CHAR {key}: height {bb.size.y:F3} scale {sc:F4} fwd {fwd.normalized} bones {bones.Count} fingers {(s.threeFingers ? 3 : 5)} hipsY {s["Hips"].position.y:F3}");
        foreach (var n in Body) if (s[n] == null && n != "SpineMid") Debug.LogError($"CHAR {key}: bone {n} not found");
        return s;
    }

    static int Depth(Transform t) { int d = 0; while (t.parent) { d++; t = t.parent; } return d; }

    static readonly string[][] AlignPairs = {
        new[] { "LUpLeg", "LLeg" }, new[] { "LLeg", "LFoot" }, new[] { "RUpLeg", "RLeg" }, new[] { "RLeg", "RFoot" },
        new[] { "LArm", "LFore" }, new[] { "LFore", "LHand" }, new[] { "RArm", "RFore" }, new[] { "RFore", "RHand" } };

    /// Puts `t` into the same reference pose as `s` (the pack's T-pose): same limb directions, same palm facing, feet flat.
    static void AlignRef(Skel s, Skel t)
    {
        var footL = t["LFoot"].rotation; var footR = t["RFoot"].rotation;
        foreach (var p in AlignPairs)
        {
            Vector3 want = s[p[1]].position - s[p[0]].position, cur = t[p[1]].position - t[p[0]].position;
            t[p[0]].rotation = Quaternion.FromToRotation(cur, want) * t[p[0]].rotation;
        }
        t["LFoot"].rotation = footL; t["RFoot"].rotation = footR;
        foreach (var side in new[] { "L", "R" })
        {
            var h = t[side + "Hand"];
            Vector3 want = s.KnuckleCentre(side) - s[side + "Hand"].position, cur = t.KnuckleCentre(side) - h.position;
            h.rotation = Quaternion.FromToRotation(cur, want) * h.rotation;
            Vector3 f = want.normalized;
            float ang = Vector3.SignedAngle(Vector3.ProjectOnPlane(t.PalmNormal(side), f), Vector3.ProjectOnPlane(s.PalmNormal(side), f), f);
            h.rotation = Quaternion.AngleAxis(ang, f) * h.rotation;
        }
    }

    static void Measure(Skel s)
    {
        for (int i = 0; i < Body.Length; i++) if (s[Body[i]] != null) s.refRot[i] = s[Body[i]].rotation;
        s.legLen = (Vector3.Distance(s["LUpLeg"].position, s["LLeg"].position) + Vector3.Distance(s["LLeg"].position, s["LFoot"].position)
                  + Vector3.Distance(s["RUpLeg"].position, s["RLeg"].position) + Vector3.Distance(s["RLeg"].position, s["RFoot"].position)) * 0.5f;
        s.ankleH = (s["LFoot"].position.y + s["RFoot"].position.y) * 0.5f;
    }

    // ------------------------------------------------------------------ rig description
    static void FillArm(Skel s, string side, ArmRig a)
    {
        a.shoulder = s[side + "Shoulder"]; a.upper = s[side + "Arm"]; a.fore = s[side + "Fore"]; a.hand = s[side + "Hand"];
        Vector3 w = a.hand.position, kc = s.KnuckleCentre(side);
        Vector3 F = (kc - w).normalized, N = s.PalmNormal(side);
        Vector3 T = Vector3.Cross(N, F).normalized * (side == "R" ? 1f : -1f);   // towards the index finger
        float hl = Vector3.Distance(s[side + "Middle1"].position, w);
        Debug.Log($"CHAR {s.key}: {side} hand F {F} N {N} T {T} len {hl:F3}");
        Quaternion gw; Vector3 gp;
        if (side == "R")
        {
            gw = Quaternion.LookRotation(F, T) * Quaternion.Euler(-RightRake, 0, 0);
            gp = s[side + "Middle1"].position + N * (0.30f * hl) - F * (0.12f * hl);
        }
        else
        {
            gw = Quaternion.LookRotation(T, N) * Quaternion.Euler(0, LeftYaw, 0);
            gp = Vector3.Lerp(w, kc, 0.78f) + N * (0.36f * hl);
        }
        a.gripRot = Quaternion.Inverse(a.hand.rotation) * gw;
        a.gripPos = a.hand.InverseTransformPoint(gp);
        for (int f = 0; f < 5; f++)
            for (int j = 0; j < 3; j++)
            {
                int i = f * 3 + j;
                var bn = s[side + FingerNames[f] + (j + 1)];
                a.fingers[i] = bn; a.fingerRest[i] = Quaternion.identity; a.fingerAxis[i] = Vector3.right; a.fingerSide[i] = Vector3.up;
                if (bn == null) continue;
                Transform child = s[side + FingerNames[f] + (j + 2)];
                if (child == null && bn.childCount > 0) child = bn.GetChild(0);
                Vector3 dir = child != null ? child.position - bn.position : bn.position - bn.parent.position;
                Vector3 toward = f == 0 ? (kc + N * hl * 0.6f - T * hl * 0.2f) - bn.position : N;
                Vector3 axis = Vector3.Cross(dir.normalized, toward.normalized).normalized;
                a.fingerRest[i] = bn.localRotation;
                a.fingerAxis[i] = Quaternion.Inverse(bn.rotation) * axis;
                a.fingerSide[i] = Quaternion.Inverse(bn.rotation) * N;
            }
    }
    public static float RightRake = 14f, LeftYaw = 28f;

    static string PathOf(Transform t, Transform root)
    {
        var parts = new List<string>();
        while (t != root && t != null) { parts.Add(t.name); t = t.parent; }
        parts.Reverse(); return string.Join("/", parts);
    }

    // ------------------------------------------------------------------ retarget + bake
    class Sampler
    {
        public Skel s, t; public float hipScale;
        public Dictionary<string, Quaternion> over;   // world-rotation overrides on the source (composite poses)
        public void Apply()
        {
            Vector3 sp = s["Hips"].position;
            t["Hips"].position = new Vector3(sp.x * hipScale, (sp.y - s.ankleH) * hipScale + t.ankleH, sp.z * hipScale);
            for (int i = 0; i < Body.Length; i++)
            {
                Transform sb = s[Body[i]], tb = t[Body[i]];
                if (sb == null || tb == null) continue;
                Quaternion sw = over != null && over.TryGetValue(Body[i], out var o) ? o : sb.rotation;
                tb.rotation = sw * Quaternion.Inverse(s.refRot[i]) * t.refRot[i];
            }
        }
    }

    static AnimationClip Bake(Sampler sm, AnimationClip src, string name, bool loop, float t0 = 0f, float t1 = -1f)
    {
        const float fps = 30f;
        if (t1 < 0) t1 = src.length;
        int n = Mathf.Max(2, Mathf.CeilToInt((t1 - t0) * fps) + 1);
        var bones = Body.Where(b => sm.s[b] != null && sm.t[b] != null).Select(b => sm.t[b]).ToArray();
        var q = new Quaternion[bones.Length][]; var hp = new Vector3[n]; var times = new float[n];
        for (int i = 0; i < bones.Length; i++) q[i] = new Quaternion[n];
        for (int k = 0; k < n; k++)
        {
            times[k] = (t1 - t0) * k / (n - 1);
            src.SampleAnimation(sm.s.model, Mathf.Min(t0 + times[k], src.length - 0.0005f));   // sampling exactly at the end wraps to frame 0
            sm.Apply();
            hp[k] = sm.t["Hips"].localPosition;
            for (int i = 0; i < bones.Length; i++)
            {
                var r = bones[i].localRotation;
                if (k > 0 && Quaternion.Dot(r, q[i][k - 1]) < 0) r = new Quaternion(-r.x, -r.y, -r.z, -r.w);
                q[i][k] = r;
            }
        }
        var clip = new AnimationClip { name = name, frameRate = fps };
        int total = 0;
        for (int i = 0; i < bones.Length; i++)
        {
            var keep = new List<int> { 0 }; int a = 0;
            while (a < n - 1)
            {
                int b = a + 1;
                while (b + 1 < n && Fits(q[i], a, b + 1)) b++;
                keep.Add(b); a = b;
            }
            total += keep.Count;
            string path = PathOf(bones[i], sm.t.root.transform);
            for (int c = 0; c < 4; c++)
            {
                int cc = c;
                clip.SetCurve(path, typeof(Transform), "localRotation." + "xyzw"[c], Linear(keep.Select(k => times[k]).ToArray(), keep.Select(k => q[i][k][cc]).ToArray()));
            }
        }
        string hpath = PathOf(sm.t["Hips"], sm.t.root.transform);
        for (int c = 0; c < 3; c++) { int cc = c; clip.SetCurve(hpath, typeof(Transform), "localPosition." + "xyz"[c], Linear(times, hp.Select(v => v[cc]).ToArray())); }
        var st = AnimationUtility.GetAnimationClipSettings(clip); st.loopTime = loop; AnimationUtility.SetAnimationClipSettings(clip, st);
        Debug.Log($"CHAR {sm.t.key}: clip {name} {t1 - t0:F2}s frames {n} keys {total}/{n * bones.Length}");
        return clip;
    }

    static bool Fits(Quaternion[] q, int a, int b)
    {
        for (int k = a + 1; k < b; k++)
            if (Quaternion.Angle(Quaternion.Lerp(q[a], q[b], (k - a) / (float)(b - a)), q[k]) > 0.35f) return false;
        return true;
    }

    static AnimationCurve Linear(float[] t, float[] v)
    {
        var keys = new Keyframe[t.Length];
        for (int i = 0; i < t.Length; i++)
        {
            float tin = i > 0 ? (v[i] - v[i - 1]) / (t[i] - t[i - 1]) : 0f, tout = i < t.Length - 1 ? (v[i + 1] - v[i]) / (t[i + 1] - t[i]) : 0f;
            keys[i] = new Keyframe(t[i], v[i], i > 0 ? tin : tout, i < t.Length - 1 ? tout : tin);
        }
        return new AnimationCurve(keys);
    }

    // ------------------------------------------------------------------ build
    public static void BuildChars()
    {
        var only = Arg("-chars");
        Directory.CreateDirectory(Gen); Directory.CreateDirectory(OutDir);
        UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
        var pack = LoadSkel("pack");
        Measure(pack);
        var clips = AssetDatabase.LoadAllAssetsAtPath($"{Src}/pack/pack.gltf").OfType<AnimationClip>().ToDictionary(c => c.name, c => c);
        Debug.Log("CHAR pack clips: " + string.Join(", ", clips.Keys));
        foreach (var key in Keys)
        {
            if (only != null && !only.Split(',').Contains(key)) continue;
            BuildChar(key, pack, clips);
        }
        AssetDatabase.SaveAssets();
        Debug.Log("CHARS_DONE");
    }

    static void BuildChar(string key, Skel pack, Dictionary<string, AnimationClip> src)
    {
        // the pack must be back in its reference pose before aligning
        var t = LoadSkel(key);
        ResetToRef(pack);
        AlignRef(pack, t);
        Measure(t);
        var rig = t.root.AddComponent<CharRig>();
        rig.hips = t["Hips"]; rig.neck = t["Neck"]; rig.head = t["Head"];
        rig.spine = new[] { "Spine", "SpineMid", "Chest" }.Select(n => t[n]).Where(x => x != null).ToArray();
        FillArm(t, "R", rig.right); FillArm(t, "L", rig.left);
        rig.renderers = t.root.GetComponentsInChildren<Renderer>();
        foreach (var r in rig.renderers.OfType<SkinnedMeshRenderer>()) { r.updateWhenOffscreen = false; r.localBounds = new Bounds(r.rootBone ? r.rootBone.InverseTransformPoint(t.root.transform.position + Vector3.up * 0.9f) : Vector3.up, Vector3.one * 600f); }
        var anim = t.root.AddComponent<Animator>();
        anim.cullingMode = AnimatorCullingMode.AlwaysAnimate; anim.applyRootMotion = false;

        var sm = new Sampler { s = pack, t = t, hipScale = t.legLen / pack.legLen };
        Debug.Log($"CHAR {key}: leg {t.legLen:F3} ankle {t.ankleH:F3} | pack leg {pack.legLen:F3} ankle {pack.ankleH:F3} hipScale {sm.hipScale:F3}");
        string assetPath = $"{Gen}/{key}_clips.asset";
        AssetDatabase.DeleteAsset(assetPath);
        var cc = ScriptableObject.CreateInstance<CharClips>();
        AssetDatabase.CreateAsset(cc, assetPath);
        AnimationClip B(string srcName, string name, bool loop, float t0 = 0, float t1 = -1)
        {
            var c = Bake(sm, src[srcName], name, loop, t0, t1);
            AssetDatabase.AddObjectToAsset(c, cc); return c;
        }
        cc.idle = B("idle simple", "idle", true);
        // rifle idle: the relaxed idle with the arms of the aiming pose kept in world space
        src["simple shoot"].SampleAnimation(pack.model, 0f);
        sm.over = new[] { "LShoulder", "LArm", "LFore", "LHand", "RShoulder", "RArm", "RFore", "RHand" }.ToDictionary(n => n, n => pack[n].rotation);
        cc.idleRifle = B("idle simple", "idleRifle", true);
        sm.over = null;
        cc.walk = B("simple walk", "walk", true);
        cc.run = B("run", "run", true);
        cc.jump = B("jump", "jump", false);
        cc.crouchIdle = B("crouch idle", "crouchIdle", true);
        cc.crouchWalk = B("walk crouch", "crouchWalk", true);
        cc.shoot = B("simple shoot", "shoot", false);
        cc.crouchShoot = B("crouch shoot", "crouchShoot", false);
        cc.reloadIdle = B("reload idle", "reloadIdle", false);
        cc.reloadWalk = B("reload walk", "reloadWalk", false);
        cc.reloadRun = B("reload run", "reloadRun", false);
        cc.reloadCrouch = B("reload crouch", "reloadCrouch", false, 0.35f, 5.9f);
        cc.death = B("simple death", "death", false);
        cc.deathCrouch = B("crouch death", "deathCrouch", false);
        cc.deathProne = B("pron death", "deathProne", false);

        // upper-body mask (spine and everything above it)
        var mask = new AvatarMask { name = "upper" };
        mask.AddTransformPath(t.root.transform, true);
        for (int i = 0; i < mask.transformCount; i++)
        {
            var tr = i == 0 ? t.root.transform : t.root.transform.Find(mask.GetTransformPath(i));
            mask.SetTransformActive(i, tr != null && tr != t.root.transform && (tr == t["Spine"] || tr.IsChildOf(t["Spine"])));
        }
        AssetDatabase.AddObjectToAsset(mask, cc); cc.upperMask = mask;
        EditorUtility.SetDirty(cc);
        rig.clips = cc;

        // how the animations hold the rifle: calibrated on the first frame of the aiming clip
        cc.shoot.SampleAnimation(t.root, 0f);
        Vector3 pr = rig.right.GripPoint, pl = rig.left.GripPoint;
        rig.right.animRot = Quaternion.Inverse(rig.right.hand.rotation);          // weapon frame == world frame in this pose
        rig.animGripDir = (pl - pr).normalized;
        Debug.Log($"CHAR {key}: aim pose grips R {pr} L {pl} dir {rig.animGripDir} dist {Vector3.Distance(pl, pr):F3} head {rig.head.position}");
        foreach (var c in new[] { cc.walk, cc.run, cc.crouchWalk, cc.idle, cc.crouchIdle })
        {
            float lo = 1e9f;
            for (int k = 0; k < 16; k++) { c.SampleAnimation(t.root, c.length * k / 16f); lo = Mathf.Min(lo, Mathf.Min(t["LToe"].position.y, t["RToe"].position.y)); }
            Debug.Log($"CHAR {key}: {c.name} lowest toe joint {lo:F3}");
        }
        cc.idle.SampleAnimation(t.root, 0f);
        rig.right.Fingers(HandPose.Relaxed); rig.left.Fingers(HandPose.Relaxed);

        BuildFpArms(t, rig);
        PrefabUtility.SaveAsPrefabAsset(t.root, $"{OutDir}/{key}.prefab");
        Object.DestroyImmediate(t.root);
        Debug.Log($"CHAR {key}: prefab saved");
    }

    static readonly Dictionary<Skel, Dictionary<Transform, (Vector3, Quaternion)>> refPose = new Dictionary<Skel, Dictionary<Transform, (Vector3, Quaternion)>>();
    static void ResetToRef(Skel s)
    {
        if (!refPose.TryGetValue(s, out var d))
        {
            d = new Dictionary<Transform, (Vector3, Quaternion)>();
            foreach (var tr in s.model.GetComponentsInChildren<Transform>()) d[tr] = (tr.localPosition, tr.localRotation);
            refPose[s] = d; return;
        }
        foreach (var kv in d) kv.Key.SetLocalPositionAndRotation(kv.Value.Item1, kv.Value.Item2);
    }

    // ------------------------------------------------------------------ first-person arms: the same skeleton with only the arm geometry
    static void BuildFpArms(Skel t, CharRig rig)
    {
        var clone = Object.Instantiate(t.root); clone.name = t.key + "_fp";
        var crig = clone.GetComponent<CharRig>();
        Object.DestroyImmediate(clone.GetComponent<Animator>());
        var armBones = new HashSet<Transform>();
        foreach (var a in new[] { crig.left, crig.right }) foreach (var tr in a.upper.GetComponentsInChildren<Transform>()) armBones.Add(tr);
        foreach (var mr in clone.GetComponentsInChildren<MeshRenderer>()) if (!armBones.Contains(mr.transform.parent) && !mr.GetComponentsInParent<Transform>().Any(armBones.Contains)) Object.DestroyImmediate(mr.gameObject);
        int n = 0, tris = 0;
        string meshPath = $"{Gen}/{t.key}_arms.asset"; AssetDatabase.DeleteAsset(meshPath);
        Object main = null;
        foreach (var r in clone.GetComponentsInChildren<SkinnedMeshRenderer>())
        {
            var m = CutMesh(r, armBones);
            if (m == null) { Object.DestroyImmediate(r.gameObject); continue; }
            m.name = t.key + "_arm" + n++;
            if (main == null) { AssetDatabase.CreateAsset(m, meshPath); main = m; } else AssetDatabase.AddObjectToAsset(m, main);
            r.sharedMesh = m; tris += m.triangles.Length / 3;
            r.updateWhenOffscreen = false; r.localBounds = new Bounds(Vector3.zero, Vector3.one * 2000f);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }
        crig.renderers = clone.GetComponentsInChildren<Renderer>();
        crig.clips = null;
        PrefabUtility.SaveAsPrefabAsset(clone, $"{OutDir}/{t.key}_fp.prefab");
        Object.DestroyImmediate(clone);
        Debug.Log($"CHAR {t.key}: fp arms {n} meshes {tris} tris");
    }

    static Mesh CutMesh(SkinnedMeshRenderer r, HashSet<Transform> armBones)
    {
        var src = r.sharedMesh; var bw = src.boneWeights; var bones = r.bones;
        var isArm = bones.Select(b => b != null && armBones.Contains(b)).ToArray();
        var ok = new bool[bw.Length];
        for (int i = 0; i < bw.Length; i++)
        {
            var w = bw[i];
            float a = (isArm[w.boneIndex0] ? w.weight0 : 0) + (isArm[w.boneIndex1] ? w.weight1 : 0) + (isArm[w.boneIndex2] ? w.weight2 : 0) + (isArm[w.boneIndex3] ? w.weight3 : 0);
            ok[i] = a >= 0.5f;
        }
        var remap = new int[bw.Length]; for (int i = 0; i < remap.Length; i++) remap[i] = -1;
        var subs = new List<int[]>(); var mats = new List<Material>(); int cnt = 0;
        for (int sIdx = 0; sIdx < src.subMeshCount; sIdx++)
        {
            var tri = src.GetTriangles(sIdx); var o = new List<int>();
            for (int i = 0; i < tri.Length; i += 3)
            {
                if (!ok[tri[i]] || !ok[tri[i + 1]] || !ok[tri[i + 2]]) continue;
                for (int k = 0; k < 3; k++) { int v = tri[i + k]; if (remap[v] < 0) remap[v] = cnt++; o.Add(remap[v]); }
            }
            if (o.Count > 0) { subs.Add(o.ToArray()); mats.Add(r.sharedMaterials[Mathf.Min(sIdx, r.sharedMaterials.Length - 1)]); }
        }
        if (cnt == 0) return null;
        T[] Pick<T>(T[] a) { if (a == null || a.Length != remap.Length) return null; var o = new T[cnt]; for (int i = 0; i < remap.Length; i++) if (remap[i] >= 0) o[remap[i]] = a[i]; return o; }
        var m = new Mesh { indexFormat = cnt > 65000 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16 };
        m.vertices = Pick(src.vertices); m.normals = Pick(src.normals);
        var tg = Pick(src.tangents); if (tg != null) m.tangents = tg;
        var uv = Pick(src.uv); if (uv != null) m.uv = uv;
        var col = Pick(src.colors32); if (col != null) m.colors32 = col;
        m.boneWeights = Pick(bw); m.bindposes = src.bindposes;
        m.subMeshCount = subs.Count;
        for (int i = 0; i < subs.Count; i++) m.SetTriangles(subs[i], i);
        m.RecalculateBounds();
        r.sharedMaterials = mats.ToArray();
        return m;
    }
}
