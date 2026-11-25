using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.Rendering.Universal;

/// First-person view model: artist-animated arm packs (Resources/FpArms/<pack>, built by Assets/Editor/FpPackSetup.cs),
/// one per weapon family: knife, pistol, rifle (AK pack: rifles, SMGs, shotguns, MG) and sniper (scoped bolt rifles).
/// Each pack carries its own weapon model. The clips (idle, walk, fire, reload, draw, ...) are mixed by a PlayableGraph
/// that is evaluated manually every Tick, so they can be restarted per shot, time-scaled to the weapon's reload time and
/// sampled in edit mode for the proof sheets. On top: look sway, a small recoil kick, procedural bob (packs without a walk
/// clip) and a procedural lower/raise around weapon switches when a pack has no holster / draw clip.
[ExecuteAlways]
public class FpView : MonoBehaviour
{
    public struct State
    {
        public int weapon; public string charKey;
        public float reloadU;      // 0..1 while reloading, otherwise < 0
        public bool magEmpty;      // the reload started from an empty magazine (packs with a separate empty reload)
        public float sinceShot, speed, bob;
        public Vector2 look;       // look delta this frame (degrees)
    }

    /// Layer of the first-person arms and weapon. They are drawn by a separate overlay camera with its own narrower
    /// field of view (like the view-model of classic shooters): the weapon is not stretched by the wide world FOV and
    /// never pokes into walls, because the overlay camera only sees this layer and starts from a clean depth buffer.
    public const int Layer = 30;
    public const float ViewModelFov = 52f;
    public Camera vmCam;
    /// The local player's view (the most recently created one); Fx uses its muzzle for tracers and flashes.
    public static FpView Local;

    public int Shown => shown;
    public FpPack Pack => cur != null ? cur.pack : null;
    public string Debug() => $"shown={shown} pack={(cur != null ? cur.key : "-")} act={act} actT={actT:0.00}/{actDur:0.00} sw={swPhase}:{swT:0.00} kick={kick:0.00} sway={sway} pos={(cur != null ? cur.pack.transform.localPosition : Vector3.zero)} vmFov={(vmCam ? vmCam.fieldOfView : 0)}";

    // ------------------------------------------------------------------ per-pack placement (camera space, metres / degrees)
    // The pack root sits on the eye with the pack's authored camera; these offsets move the whole view model so that the
    // weapon sits lower-right with the barrel toward the crosshair and both hands on the weapon are on screen.
    struct Tune { public Vector3 pos, rot, reloadPos; public float draw, lower, kickZ, kickPitch; }
    static Tune TuneFor(string key)
    {
        switch (key)
        {
            case "ak": return new Tune { pos = new Vector3(0.0f, 0.0f, 0.0f), rot = new Vector3(0f, 0f, 0f), draw = 0.75f, lower = 0.16f, kickZ = 0.025f, kickPitch = 1.6f };
            case "pistol": return new Tune { pos = new Vector3(0.0f, 0.0f, 0.0f), rot = new Vector3(0f, 0f, 0f), reloadPos = new Vector3(0.07f, -0.09f, 0.10f),   // the reload lifts the pistol to eye level 30 cm away: keep it off the crosshair
                 draw = 0.6f, lower = 0.16f, kickZ = 0.02f, kickPitch = 3f };
            case "sniper": return new Tune { pos = new Vector3(0.065f, -0.075f, 0.06f), rot = new Vector3(0f, 0f, 0f), draw = 0.45f, lower = 0.16f, kickZ = 0.03f, kickPitch = 3f };
            default: return new Tune { pos = new Vector3(0.0f, 0.0f, 0.0f), rot = new Vector3(0f, 0f, 0f), draw = 0.5f, lower = 0.14f, kickZ = 0f, kickPitch = 0f };
        }
    }

    public static string PackFor(int id)
    {
        var d = Weapons.Get(id);
        switch (d.slot)
        {
            case Slot.Knife: case Slot.Grenade: return "knife";   // grenade: the knife pack's bare arms with the grenade in the right hand
            case Slot.Pistol: return "pistol";
            default: return d.zoomFov > 0 && d.zoomFov < 30 ? "sniper" : "ak";
        }
    }

    // ------------------------------------------------------------------ instances
    class Inst
    {
        public string key; public FpPack pack; public Tune tune;
        public PlayableGraph graph; public AnimationMixerPlayable mixer;
        public AnimationClip[] clips; public AnimationClipPlayable[] play; public float[] w;
        public int iIdle = -1, iWalk = -1, iRun = -1, iFire = -1, iFire2 = -1, iReload = -1, iReloadEmpty = -1, iDraw = -1, iHolster = -1;
        public GameObject item; public int itemId = -1;
    }
    readonly Dictionary<string, Inst> insts = new Dictionary<string, Inst>();
    Inst cur;
    Transform cam;
    int shown = -1, target = -1;

    enum Act { None, Fire, Reload, Draw, Holster }
    Act act; int actClip = -1; float actT, actDur, actFrom, actTo;   // plays clip time actFrom..actTo over actDur seconds
    bool fireAlt; float idleT, walkPhase, kick, prevReloadU = -1f;
    Vector2 sway; float reloadW;
    enum Sw { None, Lower, Raise } Sw swPhase; float swT, swDur;

    public static FpView Create(Transform cam)
    {
        var go = new GameObject("FpView"); go.transform.SetParent(cam, false);
        go.layer = Layer;
        var v = go.AddComponent<FpView>(); v.cam = cam;
        var main = cam.GetComponent<Camera>();
        if (main != null)
        {
            main.cullingMask &= ~(1 << Layer);
            var cgo = new GameObject("ViewModelCamera"); cgo.transform.SetParent(cam, false);
            var vc = cgo.AddComponent<Camera>();
            vc.cullingMask = 1 << Layer; vc.fieldOfView = ViewModelFov; vc.nearClipPlane = 0.01f; vc.farClipPlane = 3f;
            vc.clearFlags = CameraClearFlags.Depth; vc.allowHDR = main.allowHDR; vc.allowMSAA = main.allowMSAA;
            var vd = vc.GetUniversalAdditionalCameraData();
            vd.renderType = CameraRenderType.Overlay;
            vd.renderShadows = false; vd.renderPostProcessing = true;
            var md = main.GetUniversalAdditionalCameraData();
            if (!md.cameraStack.Contains(vc)) md.cameraStack.Add(vc);
            v.vmCam = vc;
        }
        Local = v;
        return v;
    }

    void OnDestroy()
    {
        foreach (var i in insts.Values) if (i.graph.IsValid()) i.graph.Destroy();
        insts.Clear();
        if (Local == this) Local = null;
        if (vmCam == null || cam == null) return;
        var main = cam.GetComponent<Camera>();
        if (main != null) main.GetUniversalAdditionalCameraData().cameraStack.Remove(vmCam);
        Kill(vmCam.gameObject);
    }

    static void Kill(GameObject g) { if (Application.isPlaying) Destroy(g); else DestroyImmediate(g); }
    static void SetLayer(GameObject g) { foreach (var t in g.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = Layer; }

    Inst Get(string key)
    {
        if (insts.TryGetValue(key, out var i)) return i;
        var prefab = Resources.Load<GameObject>("FpArms/" + key);
        if (prefab == null) return null;
        var go = Instantiate(prefab, transform);
        go.name = "fp_" + key;
        SetLayer(go);
        i = new Inst { key = key, pack = go.GetComponent<FpPack>(), tune = TuneFor(key) };
        var p = i.pack;
        var list = new List<AnimationClip>();
        int Add(AnimationClip c) { if (c == null) return -1; list.Add(c); return list.Count - 1; }
        i.iIdle = Add(p.idle); i.iWalk = Add(p.walk); i.iRun = Add(p.run); i.iFire = Add(p.fire); i.iFire2 = Add(p.fire2);
        i.iReload = Add(p.reload); i.iReloadEmpty = Add(p.reloadEmpty); i.iDraw = Add(p.draw); i.iHolster = Add(p.holster);
        i.clips = list.ToArray(); i.w = new float[i.clips.Length]; i.play = new AnimationClipPlayable[i.clips.Length];
        i.graph = PlayableGraph.Create("FpView_" + key);
        i.graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
        i.mixer = AnimationMixerPlayable.Create(i.graph, i.clips.Length);
        for (int k = 0; k < i.clips.Length; k++)
        {
            i.play[k] = AnimationClipPlayable.Create(i.graph, i.clips[k]);
            i.play[k].SetApplyFootIK(false);
            i.graph.Connect(i.play[k], 0, i.mixer, k);
        }
        if (i.iIdle >= 0) i.w[i.iIdle] = 1f;
        var output = AnimationPlayableOutput.Create(i.graph, "anim", p.animator);
        output.SetSourcePlayable(i.mixer);
        insts[key] = i;
        go.SetActive(false);
        return i;
    }

    /// Shows weapon `id` (switches pack if its family differs, hides / adds the hand-held item for the grenade).
    void Show(int id)
    {
        shown = id;
        var n = Get(PackFor(id));
        if (n == null) return;
        if (cur != n)
        {
            if (cur != null) cur.pack.gameObject.SetActive(false);
            cur = n; cur.pack.gameObject.SetActive(true);
            for (int k = 0; k < cur.w.Length; k++) cur.w[k] = k == cur.iIdle ? 1f : 0f;
        }
        // grenade: the knife pack lends its arms; its own knife is hidden and the grenade model sits in the hand
        bool item = Weapons.Get(id).slot == Slot.Grenade;
        foreach (var r in cur.pack.weaponRenderers) if (r) r.enabled = !item;
        if (cur.item && cur.itemId != id) { Kill(cur.item); cur.item = null; }
        if (item && cur.item == null && cur.pack.weaponBone)
        {
            var g = WeaponModels.Create(id, true);
            if (g != null)
            {
                g.transform.SetParent(cur.pack.weaponBone, false);
                g.transform.localScale = Vector3.one / Mathf.Max(1e-4f, cur.pack.weaponBone.lossyScale.x / cur.pack.transform.lossyScale.x);
                foreach (var r in g.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                SetLayer(g); cur.item = g; cur.itemId = id;
            }
        }
        act = Act.None; actClip = -1;
    }

    void Play(Act a, int clip, float dur, float from = 0f, float to = -1f)
    {
        if (cur == null || clip < 0) { act = Act.None; actClip = -1; return; }
        act = a; actClip = clip; actT = 0f; actDur = Mathf.Max(0.01f, dur);
        actFrom = from; actTo = to < 0f ? cur.clips[clip].length : to;
    }

    public void Fire()
    {
        kick = 1f;
        if (cur == null) return;
        var d = Weapons.Get(shown);
        int c = cur.iFire;
        if (cur.iFire2 >= 0) { fireAlt = !fireAlt; if (fireAlt) c = cur.iFire2; }
        if (c < 0) return;
        float len = cur.clips[c].length;
        // fast-firing weapons only show the recoil part of a long fire clip (e.g. the sniper pack's bolt cycle) and blend back
        float to = d.slot == Slot.Primary && d.rate < 0.5f && len > 0.8f ? 0.45f : len;
        Play(Act.Fire, c, to, 0f, to);
    }

    void StartDraw()
    {
        if (cur == null) return;
        if (cur.iDraw >= 0) { Play(Act.Draw, cur.iDraw, cur.tune.draw); swPhase = Sw.None; }
        else { act = Act.None; actClip = -1; swPhase = Sw.Raise; swT = 0f; swDur = 0.4f; }
    }

    static float Smooth(float u) => Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(u));

    public void Tick(in State s, float dt)
    {
        // ---- weapon switching: lower (holster clip or procedural), swap, draw (draw clip or procedural raise)
        if (shown < 0 || cur == null) { Show(s.weapon); StartDraw(); }
        else if (s.weapon != shown && swPhase != Sw.Lower)
        {
            target = s.weapon; swPhase = Sw.Lower; swT = 0f; swDur = cur.tune.lower;
            if (cur.iHolster >= 0) Play(Act.Holster, cur.iHolster, swDur);
        }
        else if (swPhase == Sw.Lower) target = s.weapon;
        if (cur == null) return;
        if (swPhase != Sw.None)
        {
            swT += dt;
            if (swPhase == Sw.Lower && swT >= swDur) { Show(target); StartDraw(); }
            else if (swPhase == Sw.Raise && swT >= swDur) swPhase = Sw.None;
        }

        // ---- reload: starts when reloadU becomes >= 0; the clip is mapped onto the weapon's reload time
        if (s.reloadU >= 0f && prevReloadU < 0f && swPhase != Sw.Lower)
        {
            int c = s.magEmpty && cur.iReloadEmpty >= 0 ? cur.iReloadEmpty : cur.iReload;
            if (c >= 0) Play(Act.Reload, c, Mathf.Max(0.1f, Weapons.Get(shown).reload));
        }
        if (act == Act.Reload)
        {
            if (s.reloadU >= 0f) actT = s.reloadU * actDur;
            else if (actT < actDur) actT = actDur;            // reload finished or was cancelled: blend out from the clip's end
        }
        prevReloadU = s.reloadU;

        // ---- timers
        if (act != Act.None && act != Act.Reload) actT += dt;
        else if (act == Act.Reload && s.reloadU < 0f) actT += dt;
        const float BlendOut = 0.14f;
        float actW = 0f;
        if (act != Act.None)
        {
            float over = actT - actDur;
            actW = over <= 0f ? 1f : 1f - over / BlendOut;
            if (act == Act.Holster) actW = 1f;
            if (actW <= 0f) { act = Act.None; actClip = -1; actW = 0f; }
        }
        float mv = Mathf.Clamp01(s.speed / 3.2f);
        idleT += dt;
        if (cur.iWalk >= 0) walkPhase += dt / cur.clips[cur.iWalk].length * Mathf.Lerp(0.75f, 1.1f, Mathf.Clamp01(s.speed / 5.2f)) * (mv > 0.01f ? 1f : 0f);

        // ---- target weights (normalised): action over locomotion; walk by speed (run clip: only above walking speed)
        float loco = 1f - actW;
        float wWalk = cur.iWalk >= 0 ? mv : 0f;
        float wRun = cur.iRun >= 0 ? Mathf.Clamp01((s.speed - 6f) / 1f) : 0f;    // the game has no sprint: practically unused
        var tw = new float[cur.w.Length];
        if (cur.iIdle >= 0) tw[cur.iIdle] = loco * (1f - wWalk);
        if (cur.iWalk >= 0) tw[cur.iWalk] = loco * wWalk * (1f - wRun);
        if (cur.iRun >= 0) tw[cur.iRun] = loco * wWalk * wRun;
        if (actClip >= 0) tw[actClip] += actW;
        float rate = 1f - Mathf.Exp(-dt / 0.06f), sum = 0f;
        for (int k = 0; k < tw.Length; k++)
        {
            // actions snap in (a restarted shot starts from frame 0 at once); everything else blends
            cur.w[k] = k == actClip && actW >= 1f ? Mathf.Max(cur.w[k], Mathf.Lerp(cur.w[k], tw[k], 0.6f)) : Mathf.Lerp(cur.w[k], tw[k], rate);
            sum += cur.w[k];
        }
        for (int k = 0; k < tw.Length; k++)
        {
            cur.mixer.SetInputWeight(k, sum > 1e-4f ? cur.w[k] / sum : (k == cur.iIdle ? 1f : 0f));
            float len = cur.clips[k].length, t;
            if (k == cur.iIdle) t = Mathf.Repeat(idleT, len);
            else if (k == cur.iWalk || k == cur.iRun) t = Mathf.Repeat(walkPhase, 1f) * len;
            else if (k == actClip) t = Mathf.Lerp(actFrom, actTo, Mathf.Clamp01(actT / actDur));
            else t = cur.w[k] > 0.001f ? (float)cur.play[k].GetTime() : 0f;      // fading out: hold its last time
            cur.play[k].SetTime(t); cur.play[k].SetTime(t);
        }
        cur.graph.Evaluate(0f);
        if (cur.pack.hide != null) foreach (var h in cur.pack.hide) if (h) h.localScale = Vector3.zero;

        // ---- procedural layer on the pack root
        kick = Mathf.MoveTowards(kick, 0f, dt * 7f);
        sway = Vector2.Lerp(sway, Vector2.ClampMagnitude(s.look, 6f), 1f - Mathf.Exp(-dt * 12f));
        var tu = cur.tune;
        reloadW = Mathf.MoveTowards(reloadW, act == Act.Reload ? actW : 0f, dt / 0.2f);
        Vector3 pos = tu.pos + tu.reloadPos * Smooth(reloadW); Quaternion rot = Quaternion.Euler(tu.rot);
        float k2 = kick * kick;
        pos += new Vector3(0f, 0f, -tu.kickZ * k2); rot = rot * Quaternion.Euler(-tu.kickPitch * k2, 0f, 0f);
        if (cur.iWalk < 0)
        {
            float m = Mathf.Clamp01(s.speed / 4f);
            pos += new Vector3(Mathf.Cos(s.bob * 0.5f) * 0.006f, Mathf.Sin(s.bob) * 0.005f, 0f) * m;
        }
        pos += new Vector3(-sway.x * 0.0012f, sway.y * 0.0012f, 0f);
        rot = Quaternion.Euler(-sway.y * 0.3f, sway.x * 0.3f, sway.x * 0.4f) * rot;
        float low = 0f;
        if (swPhase == Sw.Lower && cur.iHolster < 0) low = Smooth(swT / swDur);
        else if (swPhase == Sw.Raise) low = 1f - Smooth(swT / swDur);
        if (low > 0f) { pos += new Vector3(0.02f, -0.22f, -0.04f) * low; rot = Quaternion.Euler(35f * low, 0f, -12f * low) * rot; }
        cur.pack.transform.localPosition = pos; cur.pack.transform.localRotation = rot;
    }

    /// Muzzle of the shown weapon, projected from the view-model camera into the world camera at the same screen point
    /// and depth (the view model is drawn with its own FOV), so effects spawned there line up with the barrel on screen.
    public bool TryMuzzle(out Vector3 world)
    {
        world = default;
        if (cur == null || cur.pack.muzzle == null || !isActiveAndEnabled || vmCam == null || cam == null) return false;
        var main = cam.GetComponent<Camera>();
        if (main == null) return false;
        var vp = vmCam.WorldToViewportPoint(cur.pack.muzzle.position);
        if (vp.z <= main.nearClipPlane) return false;
        world = main.ViewportToWorldPoint(vp);
        return true;
    }
}
