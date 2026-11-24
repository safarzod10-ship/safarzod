using UnityEngine;

public enum HoldKind { Rifle, Pistol, Knife, Grenade }

/// Hand markers and moving parts of a weapon model, plus the reload / bolt choreography shared by the first- and third-person views.
/// Convention: barrel along +Z, up +Y, origin at the pistol grip (GripR).
public class WeaponRig : MonoBehaviour
{
    public Transform gripR, gripL, muzzle, mag, magGrip, slide, slideGrip;
    public float slideTravel;
    public Vector3 butt;               // centre of the butt plate (long guns), zero when there is no stock
    public bool boltAction;            // bolt worked by the right hand after every shot (AWM)

    // results of Pose(): world-space grip frames for both hands
    [System.NonSerialized] public Vector3 rPos, lPos;
    [System.NonSerialized] public Quaternion rRot, lRot;
    [System.NonSerialized] public float leftBusy, rightBusy;   // 0 = on the grip, 1 = handling magazine / bolt
    Vector3 magRest, slideRest, slideGripRest; bool inited;

    public static HoldKind Kind(WeaponDef d) =>
        d.slot == Slot.Knife ? HoldKind.Knife : d.slot == Slot.Pistol ? HoldKind.Pistol : d.slot == Slot.Grenade ? HoldKind.Grenade : HoldKind.Rifle;

    /// Left-hand grip frame from the palm normal (pointing at the gripped part) and the finger direction, in any space.
    public static Quaternion LeftFrame(Vector3 n, Vector3 f)
    {
        n.Normalize(); f = Vector3.ProjectOnPlane(f, n).normalized;
        Vector3 t = Vector3.Cross(f, n);
        const float a = 28f * Mathf.Deg2Rad;
        return Quaternion.LookRotation(Mathf.Cos(a) * t + Mathf.Sin(a) * f, n);
    }

    /// Makes sure a weapon object (prefab instance or placeholder) has a rig with sensible markers.
    public static WeaponRig Ensure(GameObject go, WeaponDef d)
    {
        var w = go.GetComponent<WeaponRig>();
        if (w == null)
        {
            w = go.AddComponent<WeaponRig>();
            var k = Kind(d);
            w.gripR = Marker(go, "GripR", Vector3.zero, Quaternion.identity);
            if (k == HoldKind.Knife) w.gripR.localRotation = Quaternion.LookRotation(Vector3.down, Vector3.forward);
            if (k == HoldKind.Rifle)
            {
                bool sniper = d.zoomFov > 0 && d.zoomFov < 30;
                w.gripL = Marker(go, "GripL", new Vector3(0, 0.035f, sniper ? 0.36f : 0.3f), Quaternion.identity);
                w.muzzle = Marker(go, "Muzzle", new Vector3(0, 0.04f, sniper ? 0.8f : 0.55f), Quaternion.identity);
                w.magGrip = Marker(go, "MagGrip", new Vector3(0.012f, -0.05f, 0.16f), LeftFrame(Vector3.right, new Vector3(0, -0.2f, 1)));
                w.butt = new Vector3(0, 0.02f, -0.3f);
            }
            else if (k == HoldKind.Pistol)
            {
                w.gripL = Marker(go, "GripL", new Vector3(0.004f, -0.014f, 0.012f), LeftFrame(Vector3.right, new Vector3(0, -0.64f, 0.77f)));
                w.muzzle = Marker(go, "Muzzle", new Vector3(0, 0.07f, 0.15f), Quaternion.identity);
                w.magGrip = Marker(go, "MagGrip", new Vector3(0, -0.03f, -0.005f), Quaternion.identity);
            }
        }
        w.Init();
        return w;
    }

    static Transform Marker(GameObject go, string name, Vector3 p, Quaternion r)
    {
        var t = new GameObject(name).transform; t.SetParent(go.transform, false); t.localPosition = p; t.localRotation = r; return t;
    }

    void Init()
    {
        if (inited) return; inited = true;
        if (mag) magRest = mag.localPosition;
        if (slide) slideRest = slide.localPosition;
        if (slideGrip) slideGripRest = slideGrip.localPosition;
    }

    static float Seg(float u, float a, float b) { float t = Mathf.Clamp01((u - a) / (b - a)); return t * t * (3f - 2f * t); }

    /// Evaluates the weapon's moving parts and both hand targets.
    /// reloadU: 0..1 during a reload, otherwise negative.  boltU: 0..1 while the bolt is being cycled (bolt-action only), otherwise negative.
    public void Pose(HoldKind kind, float reloadU, float boltU)
    {
        Init();
        Transform root = transform;
        Vector3 aP = gripL ? root.InverseTransformPoint(gripL.position) : new Vector3(-0.15f, -0.1f, 0.1f);
        Quaternion aR = gripL ? Quaternion.Inverse(root.rotation) * gripL.rotation : Quaternion.identity;
        Vector3 lp = aP; Quaternion lr = aR; Vector3 magOff = Vector3.zero; float sl = 0f; leftBusy = 0f; rightBusy = 0f;
        Vector3 rp = root.InverseTransformPoint(gripR.position); Quaternion rr = Quaternion.Inverse(root.rotation) * gripR.rotation;

        if (reloadU >= 0f && magGrip != null && kind != HoldKind.Knife)
        {
            float u = reloadU;
            if (mag) mag.localPosition = magRest;
            Vector3 bP = root.InverseTransformPoint(magGrip.position); Quaternion bR = Quaternion.Inverse(root.rotation) * magGrip.rotation;
            Vector3 outV = kind == HoldKind.Pistol ? new Vector3(0, -0.12f, -0.035f) : new Vector3(0, -0.13f, 0.04f);
            Vector3 awayV = outV + (kind == HoldKind.Pistol ? new Vector3(-0.10f, -0.22f, -0.05f) : new Vector3(-0.14f, -0.26f, -0.12f));
            float end = boltAction ? 0.62f : 0.70f, k = end / 0.70f;       // magazine part of the timeline
            float toMag = Seg(u, 0.00f, 0.13f * k), pull = Seg(u, 0.13f * k, 0.27f * k), away = Seg(u, 0.27f * k, 0.38f * k);
            float back = Seg(u, 0.44f * k, 0.55f * k), push = Seg(u, 0.55f * k, 0.68f * k);
            magOff = Vector3.Lerp(Vector3.zero, outV, pull); magOff = Vector3.Lerp(magOff, awayV, away);
            magOff = Vector3.Lerp(magOff, outV, back); magOff = Vector3.Lerp(magOff, Vector3.zero, push);
            if (u > 0.685f * k && u < 0.70f * k) magOff += new Vector3(0, 0.004f, 0);       // seat
            lp = Vector3.Lerp(aP, bP, toMag) + magOff; lr = Quaternion.Slerp(aR, bR, toMag);
            leftBusy = toMag;
            if (!boltAction && slideGrip != null)
            {
                Vector3 eP = slideGripRest; Quaternion eR = slideGrip.localRotation;
                float toSl = Seg(u, 0.70f, 0.79f), rack = Seg(u, 0.79f, 0.87f), rel = Seg(u, 0.88f, 0.91f), home = Seg(u, 0.92f, 1f);
                sl = rack * (1f - rel);
                lp = Vector3.Lerp(lp, eP + Vector3.back * slideTravel * rack, toSl); lr = Quaternion.Slerp(lr, eR, toSl);
                lp = Vector3.Lerp(lp, aP, home); lr = Quaternion.Slerp(lr, aR, home);
                leftBusy = 1f - home;
            }
            else
            {
                float home = Seg(u, end, end + 0.14f);
                lp = Vector3.Lerp(lp, aP, home); lr = Quaternion.Slerp(lr, aR, home);
                leftBusy = toMag * (1f - home);
                if (boltAction && boltU < 0f) boltU = Mathf.Clamp01((u - 0.68f) / 0.30f);
            }
        }
        if (boltAction && boltU >= 0f && slideGrip != null)
        {
            float b = boltU;
            float reach = Seg(b, 0.0f, 0.22f), lift = Seg(b, 0.22f, 0.32f), pullB = Seg(b, 0.32f, 0.50f), pushB = Seg(b, 0.52f, 0.70f), down = Seg(b, 0.70f, 0.78f), home = Seg(b, 0.80f, 1f);
            sl = pullB * (1f - pushB);
            Vector3 hp = slideGripRest + new Vector3(0, 0.03f * lift * (1f - down), 0) + Vector3.back * slideTravel * sl;
            Vector3 p0 = rp;
            rp = Vector3.Lerp(p0, hp, reach); rp = Vector3.Lerp(rp, p0, home);
            rr = rr * Quaternion.Euler(0, 0, -25f * reach * (1f - home));
            rightBusy = reach * (1f - home);
        }
        if (mag) mag.localPosition = magRest + magOff;
        if (slide) slide.localPosition = slideRest + Vector3.back * slideTravel * sl;
        lPos = root.TransformPoint(lp); lRot = root.rotation * lr;
        rPos = root.TransformPoint(rp); rRot = root.rotation * rr;
    }

    /// Slide blow-back for semi-auto pistols (0..1), ignored while reloading.
    public void Recoil(float t)
    {
        if (slide == null || boltAction) return;
        Init();
        slide.localPosition = slideRest + Vector3.back * slideTravel * Mathf.Clamp01(t);
    }
}
