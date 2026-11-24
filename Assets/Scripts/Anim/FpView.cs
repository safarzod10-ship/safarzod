using UnityEngine;

/// First-person view model: the weapon in camera space (sway, bob, recoil, reload, switch) held by the fighter's own arms
/// (Resources/Chars/<key>_fp: the character skeleton with only the arm geometry), which are placed by two-bone IK on the
/// weapon's GripR / GripL markers exactly like the third-person body.
public class FpView : MonoBehaviour
{
    public struct State
    {
        public int weapon; public string charKey;
        public float reloadU;      // 0..1 while reloading, otherwise < 0
        public float sinceShot, speed, bob;
        public Vector2 look;       // look delta this frame (degrees)
    }

    public WeaponRig weapon; public CharRig arms;
    public int Shown => shown;
    Transform cam; string armsKey; int shown = -1, pending = -1; HoldKind kind;
    float switchT = -1f, kick, attackT = 9f; Vector2 sway;
    Quaternion[] armRest; Transform[] armBones;
    const float SwitchDur = 0.45f;

    public static FpView Create(Transform cam)
    {
        var go = new GameObject("FpView"); go.transform.SetParent(cam, false);
        var v = go.AddComponent<FpView>(); v.cam = cam; return v;
    }

    public void Fire() { kick = 1f; attackT = 0f; }

    void Kill(GameObject g) { if (Application.isPlaying) Destroy(g); else DestroyImmediate(g); }

    void SetArms(string key)
    {
        armsKey = key;
        if (arms) Kill(arms.gameObject);
        arms = null;
        var prefab = Resources.Load<GameObject>("Chars/" + key + "_fp");
        if (prefab == null) return;
        var go = Instantiate(prefab, transform);
        go.transform.localPosition = new Vector3(0, -1.6f, -0.15f); go.transform.localRotation = Quaternion.identity;
        arms = go.GetComponent<CharRig>();
        armBones = new[] { arms.right.upper, arms.right.fore, arms.right.hand, arms.left.upper, arms.left.fore, arms.left.hand };
        armRest = new Quaternion[armBones.Length];
        for (int i = 0; i < armBones.Length; i++) armRest[i] = armBones[i].localRotation;
        foreach (var r in go.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
    }

    void Swap(int id)
    {
        if (weapon) Kill(weapon.gameObject);
        shown = id;
        var d = Weapons.Get(id);
        var go = WeaponModels.Create(id, true);
        go.transform.SetParent(transform, false);
        weapon = WeaponRig.Ensure(go, d); kind = WeaponRig.Kind(d);
    }

    static float Hump(float u, float a, float b) { return Mathf.SmoothStep(0, 1, Mathf.Clamp01(u / a)) * Mathf.SmoothStep(0, 1, Mathf.Clamp01((1f - u) / b)); }

    public void Tick(in State s, float dt)
    {
        if (s.charKey != armsKey) SetArms(s.charKey);
        if (shown < 0) Swap(s.weapon);
        else if (s.weapon != shown && pending != s.weapon) { pending = s.weapon; if (switchT < 0f) switchT = 0f; else if (switchT > SwitchDur * 0.5f) switchT = SwitchDur - switchT; }
        else if (s.weapon == shown && pending >= 0) pending = -1;
        float sw = 0f;
        if (switchT >= 0f)
        {
            switchT += dt; float u = switchT / SwitchDur;
            if (u >= 0.5f && pending >= 0) { Swap(pending); pending = -1; }
            if (u >= 1f) switchT = -1f; else sw = Mathf.Sin(u * Mathf.PI);
        }
        kick = Mathf.MoveTowards(kick, 0f, dt * 8f); attackT += dt;
        sway = Vector2.Lerp(sway, Vector2.ClampMagnitude(s.look, 6f), 1f - Mathf.Exp(-dt * 12f));
        var def = Weapons.Get(shown);
        bool sniper = def.zoomFov > 0 && def.zoomFov < 30;

        Vector3 pos; Quaternion rot;
        float k = kick * kick, rl = s.reloadU >= 0f ? Hump(s.reloadU, 0.1f, 0.1f) : 0f;
        float rk = s.reloadU >= 0f ? Mathf.SmoothStep(0, 1, Mathf.Clamp01((s.reloadU - 0.66f) / 0.08f)) : 0f;     // racking phase: roll back so the action is visible
        switch (kind)
        {
            case HoldKind.Rifle:
                pos = sniper ? new Vector3(0.14f, -0.22f, 0.33f) : new Vector3(0.155f, -0.155f, 0.36f); rot = Quaternion.Euler(-1.5f, -1f, 0f);
                pos += new Vector3(0, 0, -0.04f * k); rot *= Quaternion.Euler(-(sniper ? 5f : 1.8f) * k, 0, 0);
                pos += new Vector3(-0.015f, sniper ? 0.13f : 0.09f, 0f) * rl; rot *= Quaternion.Euler(-10f * rl, 6f * rl, -40f * rl * (1f - 0.7f * rk));
                break;
            case HoldKind.Pistol:
                pos = new Vector3(0.12f, -0.135f, 0.44f); rot = Quaternion.Euler(-1f, -1.5f, 0f);
                pos += new Vector3(0, 0.006f * k, -0.025f * k); rot *= Quaternion.Euler(-10f * k, 0, 0);
                pos += new Vector3(-0.04f, 0.04f, -0.06f) * rl; rot *= Quaternion.Euler(-30f * rl * (1f - 0.6f * rk), 0f, -38f * rl * (1f - 0.8f * rk));
                break;
            case HoldKind.Knife:
            {
                float a = attackT < 0.35f ? Mathf.Sin(attackT / 0.35f * Mathf.PI) : 0f;
                pos = new Vector3(0.17f, -0.17f, 0.40f) + new Vector3(-0.18f, 0.05f, 0.14f) * a;
                rot = Quaternion.Euler(-42f + 30f * a, -22f - 50f * a, 12f - 30f * a);
                break;
            }
            default:
                pos = new Vector3(0.16f, -0.16f, 0.40f); rot = Quaternion.Euler(-70f, 0, 0); break;
        }
        float mv = Mathf.Clamp01(s.speed / 4f);
        pos += new Vector3(Mathf.Cos(s.bob * 0.5f) * 0.005f, Mathf.Sin(s.bob) * 0.004f, 0) * mv;
        pos += new Vector3(-sway.x * 0.0012f, sway.y * 0.0012f, 0);
        rot = Quaternion.Euler(-sway.y * 0.35f, sway.x * 0.35f, sway.x * 0.5f) * rot;
        if (sw > 0f) { pos += new Vector3(0.02f, -0.30f, -0.05f) * sw; rot = Quaternion.Euler(48f * sw, 0, -18f * sw) * rot; }
        weapon.transform.localPosition = pos; weapon.transform.localRotation = rot;
        float boltU = weapon.boltAction && s.reloadU < 0f && s.sinceShot > 0.3f && s.sinceShot < 1.2f ? (s.sinceShot - 0.3f) / 0.9f : -1f;
        weapon.Pose(kind, s.reloadU, boltU);
        if (kind == HoldKind.Pistol && s.reloadU < 0f) weapon.Recoil(kick > 0.5f ? (1f - kick) * 2f : kick * 2f);
        if (arms == null) return;

        for (int i = 0; i < armBones.Length; i++) armBones[i].localRotation = armRest[i];
        Vector3 sR = cam.TransformPoint(0.22f, -0.28f, -0.10f), sL = cam.TransformPoint(-0.18f, -0.30f, -0.04f);
        Place(arms.right, sR, weapon.rPos, weapon.rRot, sR + cam.TransformVector(0.30f, -0.25f, 0.10f));
        if (kind == HoldKind.Rifle || kind == HoldKind.Pistol)
            Place(arms.left, sL, weapon.lPos, weapon.lRot, sL + cam.TransformVector(-0.25f, -0.30f, 0.10f));
        else
            Place(arms.left, sL, cam.TransformPoint(-0.20f, -0.50f, 0.20f), cam.rotation * WeaponRig.LeftFrame(new Vector3(1, 0, 0.3f), new Vector3(0.2f, 0.6f, 0.8f)), sL + cam.TransformVector(-0.25f, -0.30f, 0.10f));
        float[] rp = kind == HoldKind.Knife ? HandPose.Fist : kind == HoldKind.Grenade ? HandPose.Mag : s.sinceShot < 0.1f ? HandPose.Trigger : HandPose.Pistol;
        arms.right.Fingers(HandPose.Lerp(rp, HandPose.Relaxed, weapon.rightBusy * 0.5f), kind == HoldKind.Knife ? 0f : CharBody.ThumbWrap);
        arms.left.Fingers(HandPose.Lerp(HandPose.Guard, HandPose.Mag, weapon.leftBusy));
    }

    static void Place(ArmRig a, Vector3 shoulder, Vector3 gripPos, Quaternion gripRot, Vector3 hint)
    {
        a.HandFor(gripPos, gripRot, out var wrist, out var rot);
        a.upper.position = shoulder;
        float reach = (Vector3.Distance(a.upper.position, a.fore.position) + Vector3.Distance(a.fore.position, a.hand.position)) * 0.95f;
        Vector3 d = shoulder - wrist;
        if (d.magnitude > reach) { shoulder = wrist + d.normalized * reach; a.upper.position = shoulder; }
        a.Solve(wrist, rot, hint);
    }
}
