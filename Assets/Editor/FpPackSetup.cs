using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

/// Builds Resources/FpArms/<key>.prefab (+ Assets/FpArms/<key>/clips/<role>.anim) from the glTF packs written by
/// tools/fparms/prep.py.  Run: Unity -batchmode -quit -projectPath . -executeMethod FpPackSetup.Build
public static class FpPackSetup
{
    class Cfg
    {
        public string key, eye, weaponBone, handR; public string[] weaponMeshes; public float scale = 1f;
    }

    static readonly Cfg[] Packs =
    {
        // eye: the pack's authored camera (AK, sniper, knife) or the head bone the AK camera sits on (pistol: same rig, no camera)
        new Cfg { key = "ak", eye = "Camera", weaponBone = "Grip_01", handR = "DEF-hand.R", weaponMeshes = new[] { "Object_14", "Object_15", "Object_17", "Object_18" } },
        new Cfg { key = "pistol", eye = "DEF-spine.006", weaponBone = "DEF_Cuerpo", handR = "DEF-hand.R", weaponMeshes = new[] { "Object_20" }, scale = 1f / (1.9637157f * 1.505f) },   // file is 2.955x too large (root * armature scale)
        new Cfg { key = "sniper", eye = "Camera", weaponBone = "Body_057", handR = "Hand_R_037", weaponMeshes = new[] { "Object_89", "Object_90" } },
        new Cfg { key = "knife", eye = "A_Camera", weaponBone = "Base_076", handR = "Hand.R_04", weaponMeshes = new[] { "Object_122" } },
    };

    static Transform Find(Transform root, string prefix) =>
        root.GetComponentsInChildren<Transform>(true).Where(t => t.name.StartsWith(prefix)).OrderBy(t => t.name.Length).FirstOrDefault();

    public static void Build()
    {
        Directory.CreateDirectory("Assets/Resources/FpArms");
        UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
        foreach (var c in Packs) BuildPack(c);
        AssetDatabase.SaveAssets();
        Debug.Log("FPPACK_DONE");
    }

    static void BuildPack(Cfg c)
    {
        string dir = $"Assets/FpArms/{c.key}", src = $"{dir}/{c.key}.gltf";
        var model = AssetDatabase.LoadAssetAtPath<GameObject>(src);
        if (model == null) { Debug.LogError("FPPACK missing " + src); return; }
        Directory.CreateDirectory(dir + "/clips");
        var clips = new Dictionary<string, AnimationClip>();
        foreach (var s in AssetDatabase.LoadAllAssetsAtPath(src).OfType<AnimationClip>())
        {
            string path = $"{dir}/clips/{s.name}.anim";
            var copy = Object.Instantiate(s); copy.name = s.name;
            var st = AnimationUtility.GetAnimationClipSettings(copy);
            st.loopTime = s.name == "idle" || s.name == "walk" || s.name == "run";
            AnimationUtility.SetAnimationClipSettings(copy, st);
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(copy, path);
            clips[s.name] = copy;
        }

        var inst = Object.Instantiate(model); inst.name = "Model";
        foreach (var a in inst.GetComponentsInChildren<Animation>(true)) Object.DestroyImmediate(a);
        foreach (var a in inst.GetComponentsInChildren<Animator>(true)) Object.DestroyImmediate(a);
        foreach (var cam in inst.GetComponentsInChildren<Camera>(true)) Object.DestroyImmediate(cam);
        foreach (var l in inst.GetComponentsInChildren<Light>(true)) Object.DestroyImmediate(l);
        clips["idle"].SampleAnimation(inst, 0f);

        var root = new GameObject("fp_" + c.key);
        var eye = Find(inst.transform, c.eye);
        Vector3 eyePos = eye.position;
        inst.transform.SetParent(root.transform, false);
        inst.transform.localScale = Vector3.one * c.scale;
        inst.transform.localPosition = -eyePos * c.scale;

        var pack = root.AddComponent<FpPack>();
        pack.animator = inst.AddComponent<Animator>();
        pack.animator.cullingMode = AnimatorCullingMode.AlwaysAnimate; pack.animator.applyRootMotion = false;
        clips.TryGetValue("idle", out pack.idle); clips.TryGetValue("walk", out pack.walk); clips.TryGetValue("run", out pack.run);
        clips.TryGetValue("fire", out pack.fire); clips.TryGetValue("fire2", out pack.fire2);
        clips.TryGetValue("reload", out pack.reload); clips.TryGetValue("reload_empty", out pack.reloadEmpty);
        clips.TryGetValue("draw", out pack.draw); clips.TryGetValue("holster", out pack.holster);
        pack.weaponBone = Find(inst.transform, c.weaponBone);
        pack.handR = Find(inst.transform, c.handR);

        var smrs = inst.GetComponentsInChildren<SkinnedMeshRenderer>(true);
        var weaponR = smrs.Where(r => c.weaponMeshes.Contains(r.name)).ToArray();
        pack.weaponRenderers = weaponR;
        foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
        {
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; r.receiveShadows = false;
            r.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off; r.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
        }
        foreach (var r in smrs)
        {
            r.updateWhenOffscreen = false; r.skinnedMotionVectors = false;
            // the pack is always in front of the view-model camera: a generous fixed box avoids per-frame bounds updates
            var rb = r.rootBone ? r.rootBone : r.transform;
            r.localBounds = new Bounds(rb.InverseTransformPoint(root.transform.TransformPoint(0, -0.2f, 0.3f)), Vector3.one * 2f / Mathf.Max(1e-4f, rb.lossyScale.x));
        }

        // muzzle = the most forward vertex cluster of the weapon in the idle pose
        Vector3 best = Vector3.zero; float bz = float.MinValue; var pts = new List<Vector3>();
        foreach (var r in weaponR)
        {
            var m = new Mesh(); r.BakeMesh(m, true);
            foreach (var v in m.vertices) { var w = root.transform.InverseTransformPoint(r.transform.TransformPoint(v)); pts.Add(w); if (w.z > bz) { bz = w.z; best = w; } }
            Object.DestroyImmediate(m);
        }
        var tip = pts.Where(p => p.z > bz - 0.012f).ToList();
        Vector3 mz = tip.Count > 0 ? tip.Aggregate(Vector3.zero, (a, b) => a + b) / tip.Count : best;
        var mt = new GameObject("Muzzle").transform; mt.SetParent(pack.weaponBone, false);
        mt.position = root.transform.TransformPoint(mz); mt.rotation = root.transform.rotation;
        pack.muzzle = mt;

        // report
        var sb = new System.Text.StringBuilder($"FPPACK {c.key}: eye={eye.name} {eyePos} scale={c.scale:F4}\n");
        foreach (var r in smrs)
        {
            var m = new Mesh(); r.BakeMesh(m, true);
            var b = new Bounds(root.transform.InverseTransformPoint(r.transform.TransformPoint(m.vertices[0])), Vector3.zero);
            foreach (var v in m.vertices) b.Encapsulate(root.transform.InverseTransformPoint(r.transform.TransformPoint(v)));
            sb.Append($"  mesh {r.name} tris={r.sharedMesh.triangles.Length / 3} verts={r.sharedMesh.vertexCount} bones={r.bones.Length} weapon={weaponR.Contains(r)} mats={string.Join(",", r.sharedMaterials.Select(x => x ? x.name + "/" + x.shader.name : "-"))} bounds(eye)={b.min:F3}..{b.max:F3}\n");
            Object.DestroyImmediate(m);
        }
        foreach (var kv in clips) sb.Append($"  clip {kv.Key} len={kv.Value.length:F3} curves={AnimationUtility.GetCurveBindings(kv.Value).Length} legacy={kv.Value.legacy}\n");
        sb.Append($"  muzzle(eye)={mz:F3} handR(eye)={(pack.handR ? root.transform.InverseTransformPoint(pack.handR.position) : Vector3.zero):F3} weaponBone={pack.weaponBone?.name}");
        Debug.Log(sb.ToString());

        string pf = $"Assets/Resources/FpArms/{c.key}.prefab";
        PrefabUtility.SaveAsPrefabAsset(root, pf);
        Object.DestroyImmediate(root);
    }
}
