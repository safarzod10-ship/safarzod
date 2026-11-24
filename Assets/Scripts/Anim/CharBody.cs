using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

/// Third-person fighter: plays the baked clips through a Playables graph (locomotion blend + masked upper-body fire/reload layer,
/// three deaths) and then, after the animation, fits the weapon to the hands: the weapon pose is derived from the animated hands
/// (rifles) or from the aim (pistols/knife), both arms are re-solved with two-bone IK onto the weapon's GripR / GripL markers and the
/// fingers are curled around the grips.
public class CharBody : MonoBehaviour
{
    public CharRig rig;
    public WeaponRig weapon;
    public int weaponId = -1;
    // inputs
    public float speed, pitch;
    public bool crouch, airborne, manual, shadowsOnly;
    public bool Dead => dead;

    const float SwitchDur = 0.5f;
    Animator anim; PlayableGraph graph; AnimationLayerMixerPlayable layers; AnimationMixerPlayable baseMix, upMix;
    readonly AnimationClipPlayable[] bp = new AnimationClipPlayable[10], up = new AnimationClipPlayable[6];
    AnimationClip[] bc, uc;
    readonly float[] bw = new float[10], uw = new float[6];
    float locoPhase, crouchPhase, idleT, crouchW, airW, moveS, rifleW, deadW, deathT, shootT = 9f, shootW, reloadT = -1f, reloadDur = 1f, reloadW;
    float switchT = -1f, kick, sinceShot = 9f, readyW, attackT = 9f, lowW;
    int deathKind, reloadClip, pendingWeapon = -1; bool dead;
    HoldKind kind;

    public static CharBody Create(Transform parent, string key)
    {
        var prefab = Resources.Load<GameObject>("Chars/" + key);
        if (prefab == null) return null;
        var go = Instantiate(prefab, parent); go.name = key;
        go.transform.localPosition = Vector3.zero; go.transform.localRotation = Quaternion.identity;
        var b = go.AddComponent<CharBody>(); b.Init();
        return b;
    }

    void Init()
    {
        rig = GetComponent<CharRig>(); anim = GetComponent<Animator>();
        var c = rig.clips;
        bc = new[] { c.idle, c.idleRifle, c.walk, c.run, c.crouchIdle, c.crouchWalk, c.jump, c.death, c.deathCrouch, c.deathProne };
        uc = new[] { c.shoot, c.crouchShoot, c.reloadIdle, c.reloadWalk, c.reloadRun, c.reloadCrouch };
        graph = PlayableGraph.Create("Char " + name);
        graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
        baseMix = AnimationMixerPlayable.Create(graph, bc.Length); upMix = AnimationMixerPlayable.Create(graph, uc.Length);
        for (int i = 0; i < bc.Length; i++) { bp[i] = AnimationClipPlayable.Create(graph, bc[i]); bp[i].SetApplyFootIK(false); bp[i].SetSpeed(0); graph.Connect(bp[i], 0, baseMix, i); }
        for (int i = 0; i < uc.Length; i++) { up[i] = AnimationClipPlayable.Create(graph, uc[i]); up[i].SetApplyFootIK(false); up[i].SetSpeed(0); graph.Connect(up[i], 0, upMix, i); }
        layers = AnimationLayerMixerPlayable.Create(graph, 2);
        graph.Connect(baseMix, 0, layers, 0); graph.Connect(upMix, 0, layers, 1);
        layers.SetInputWeight(0, 1f); layers.SetInputWeight(1, 0f);
        layers.SetLayerMaskFromAvatarMask(1, c.upperMask);
        var output = AnimationPlayableOutput.Create(graph, "pose", anim);
        output.SetSourcePlayable(layers);
        graph.Play();
    }

    void OnDestroy() { if (graph.IsValid()) graph.Destroy(); }

    // ------------------------------------------------------------------ events
    public void SetWeapon(int id, bool instant = false)
    {
        if (id == weaponId && pendingWeapon < 0) return;
        reloadT = -1f;
        if (instant || weapon == null || dead) { Swap(id); switchT = -1f; pendingWeapon = -1; return; }
        pendingWeapon = id;
        if (switchT < 0f) switchT = 0f; else if (switchT > SwitchDur * 0.5f) switchT = SwitchDur - switchT;
    }

    void Swap(int id)
    {
        if (weapon) { if (Application.isPlaying) Destroy(weapon.gameObject); else DestroyImmediate(weapon.gameObject); }
        weaponId = id;
        var d = Weapons.Get(id);
        var go = WeaponModels.Create(id, false);
        go.transform.SetParent(transform, false);
        weapon = WeaponRig.Ensure(go, d); kind = WeaponRig.Kind(d);
        ApplyVisibility();
    }

    public void ApplyVisibility()
    {
        var mode = shadowsOnly ? UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly : UnityEngine.Rendering.ShadowCastingMode.On;
        foreach (var r in rig.renderers) if (r) r.shadowCastingMode = mode;
        if (weapon) foreach (var r in weapon.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = mode;
    }

    public void Shot() { shootT = 0f; sinceShot = 0f; kick = 1f; attackT = 0f; }

    public void Reload(float duration)
    {
        if (dead || kind == HoldKind.Knife || kind == HoldKind.Grenade) return;
        reloadT = 0f; reloadDur = Mathf.Max(0.5f, duration);
        reloadClip = crouch ? 3 : moveS > 3f ? 2 : moveS > 0.5f ? 1 : 0;
    }

    /// kind: 0 standing, 1 crouched, 2 drop flat; -1 picks by state.
    public void Die(int which = -1)
    {
        if (dead) return;
        dead = true; deathT = 0f; reloadT = -1f; switchT = -1f;
        if (pendingWeapon >= 0) { Swap(pendingWeapon); pendingWeapon = -1; }
        deathKind = which >= 0 ? which : crouch ? 1 : Random.value < 0.25f ? 2 : 0;
    }

    public void Revive() { dead = false; deadW = 0f; deathT = 0f; shootT = 9f; }

    public string DebugInfo() => $"deadW {deadW} deathT {deathT} kind {deathKind} w {baseMix.GetInputWeight(7 + deathKind)} time {bp[7 + deathKind].GetTime()} dur {bp[7 + deathKind].GetDuration()} done {bp[7 + deathKind].IsDone()} idle {baseMix.GetInputWeight(1)}";

    // ------------------------------------------------------------------ frame
    void LateUpdate() { if (!manual) Step(Time.deltaTime); }

    public void Step(float dt)
    {
        if (!graph.IsValid()) return;
        if (dead && deadW >= 1f && deathT > bc[7 + deathKind].length + 0.3f) return;      // lying still: nothing left to animate
        Animate(dt);
        graph.Evaluate(0f);
        Hold(dt);
    }

    void Animate(float dt)
    {
        var c = rig.clips;
        moveS = Mathf.Lerp(moveS, speed, 1f - Mathf.Exp(-dt * 10f));
        crouchW = Mathf.MoveTowards(crouchW, crouch ? 1f : 0f, dt * 5f);
        airW = Mathf.MoveTowards(airW, airborne ? 1f : 0f, dt * 7f);
        rifleW = Mathf.MoveTowards(rifleW, kind == HoldKind.Rifle && weapon != null ? 1f : 0f, dt * 4f);
        deadW = Mathf.MoveTowards(deadW, dead ? 1f : 0f, dt * (deathKind == 2 ? 3.5f : 6f));
        float s = moveS; const float wRef = 2.0f, rRef = 4.2f;
        float idleW, walkW, runW;
        if (s < wRef) { walkW = s / wRef; idleW = 1f - walkW; runW = 0f; }
        else { runW = Mathf.Clamp01((s - wRef) / (rRef - wRef)); walkW = 1f - runW; idleW = 0f; }
        float cMove = Mathf.Clamp01(s / 1.0f);
        float walkRate = Mathf.Clamp(s / c.walkSpeed, 0.55f, 1.5f) / c.walk.length, runRate = Mathf.Clamp(s / c.runSpeed, 0.7f, 1.4f) / c.run.length;
        locoPhase = Mathf.Repeat(locoPhase + Mathf.Lerp(walkRate, runRate, runW) * dt, 1f);
        crouchPhase = Mathf.Repeat(crouchPhase + Mathf.Clamp(s / c.crouchSpeed, 0.5f, 1.8f) / c.crouchWalk.length * dt, 1f);
        idleT += dt;
        if (dead) deathT += dt;

        float live = 1f - deadW, g = live * (1f - airW), st = g * (1f - crouchW), cr = g * crouchW;
        bw[0] = st * idleW * (1f - rifleW); bw[1] = st * idleW * rifleW; bw[2] = st * walkW; bw[3] = st * runW;
        bw[4] = cr * (1f - cMove); bw[5] = cr * cMove; bw[6] = live * airW;
        bw[7] = bw[8] = bw[9] = 0f; bw[7 + deathKind] = deadW;
        T(bp[0], bc[0], idleT, true); T(bp[1], bc[1], idleT, true);
        T(bp[2], bc[2], locoPhase * bc[2].length, true); T(bp[3], bc[3], Mathf.Repeat(locoPhase + c.runPhase, 1f) * bc[3].length, true);
        T(bp[4], bc[4], idleT, true); T(bp[5], bc[5], crouchPhase * bc[5].length, true);
        T(bp[6], bc[6], 0.62f * bc[6].length, false);
        T(bp[7 + deathKind], bc[7 + deathKind], deathT, false);
        for (int i = 0; i < bw.Length; i++) baseMix.SetInputWeight(i, bw[i]);

        // upper body: fire and reload on top of the legs
        shootT += dt; sinceShot += dt;
        shootW = Mathf.MoveTowards(shootW, shootT < 0.25f ? 1f : 0f, dt * (shootT < 0.25f ? 30f : 5f));
        float reloadU = -1f;
        if (reloadT >= 0f) { reloadT += dt; reloadU = reloadT / reloadDur; if (reloadU >= 1f) { reloadT = -1f; reloadU = -1f; } }
        reloadW = Mathf.MoveTowards(reloadW, reloadU >= 0f && reloadU < 0.93f ? 1f : 0f, dt * 6f);
        float rW = reloadW * rifleW, sW = shootW * rifleW * (1f - rW);
        for (int i = 0; i < uw.Length; i++) uw[i] = 0f;
        uw[0] = sW * (1f - crouchW); uw[1] = sW * crouchW; uw[2 + reloadClip] = rW;
        float total = (rW + sW);
        T(up[0], uc[0], shootT, false); T(up[1], uc[1], shootT, false);
        if (reloadU >= 0f) T(up[2 + reloadClip], uc[2 + reloadClip], reloadU * uc[2 + reloadClip].length, false);
        for (int i = 0; i < uw.Length; i++) upMix.SetInputWeight(i, total > 1e-4f ? uw[i] / total : (i == 0 ? 1f : 0f));
        layers.SetInputWeight(1, Mathf.Clamp01(total) * live);
    }

    static void T(AnimationClipPlayable p, AnimationClip clip, float t, bool loop)
    {
        p.SetTime(loop ? Mathf.Repeat(t, clip.length) : Mathf.Min(t, clip.length - 0.005f));
    }

    void BendSpine(Quaternion delta)
    {
        float ang = Quaternion.Angle(Quaternion.identity, delta);
        if (ang < 0.01f) return;
        if (ang > 80f) delta = Quaternion.Slerp(Quaternion.identity, delta, 80f / ang);
        int n = rig.spine.Length;
        Quaternion step = Quaternion.Slerp(Quaternion.identity, delta, 1f / n);
        for (int i = 0; i < n; i++) rig.spine[i].rotation = step * rig.spine[i].rotation;
    }

    // ------------------------------------------------------------------ weapon in the hands
    void Hold(float dt)
    {
        kick = Mathf.MoveTowards(kick, 0f, dt * 7f);
        attackT += dt;
        ArmRig R = rig.right, L = rig.left;
        float live = 1f - deadW;
        Quaternion body = transform.rotation;
        Vector3 right = body * Vector3.right, upv = Vector3.up;
        Quaternion aim = body * Quaternion.Euler(pitch, 0, 0);

        float sw = 0f;
        if (switchT >= 0f)
        {
            switchT += dt; float u = switchT / SwitchDur;
            if (u >= 0.5f && pendingWeapon >= 0) { Swap(pendingWeapon); pendingWeapon = -1; }
            if (u >= 1f) switchT = -1f; else sw = Mathf.Sin(u * Mathf.PI);
        }
        if (weapon == null) { R.Fingers(HandPose.Relaxed); L.Fingers(HandPose.Relaxed); return; }
        float reloadU = reloadT >= 0f ? Mathf.Clamp01(reloadT / reloadDur) : -1f;
        float boltU = weapon.boltAction && reloadU < 0f && sinceShot > 0.3f && sinceShot < 1.2f ? (sinceShot - 0.3f) / 0.9f : -1f;

        Vector3 wp; Quaternion wr; float lIk = 1f;
        Vector3 lGuardP = Vector3.zero; Quaternion lGuardR = Quaternion.identity; bool guard = false;
        if (kind == HoldKind.Rifle)
        {
            Vector3 pr = R.GripPoint, pl = L.GripPoint;
            Quaternion qr = R.hand.rotation * R.animRot;
            Quaternion q2 = Quaternion.FromToRotation(qr * rig.animGripDir, (pl - pr).normalized) * qr;
            Quaternion q = Quaternion.Slerp(qr, q2, live * (1f - reloadW));
            float runF = Mathf.Clamp01((moveS - 2.5f) / 1.5f) * (1f - crouchW) * Mathf.Clamp01((sinceShot - 0.4f) / 0.4f);
            float aimW = live * Mathf.Lerp(1f, 0.4f, runF) * Mathf.Lerp(1f, 0.45f, reloadW) * (1f - 0.5f * airW);
            Quaternion delta = Quaternion.Slerp(Quaternion.identity, Quaternion.FromToRotation(q * Vector3.forward, aim * Vector3.forward), aimW);
            BendSpine(delta);
            wr = R.hand.rotation * R.animRot;
            if (live * (1f - reloadW) > 0f) wr = Quaternion.Slerp(wr, Quaternion.FromToRotation(wr * rig.animGripDir, (L.GripPoint - R.GripPoint).normalized) * wr, live * (1f - reloadW));
            if (reloadW > 0f && live > 0f)
            {
                // while reloading the weapon follows the right hand only; keep the muzzle within 45 degrees of the aim
                float off = Vector3.Angle(wr * Vector3.forward, aim * Vector3.forward);
                if (off > 45f) wr = Quaternion.Slerp(wr, Quaternion.FromToRotation(wr * Vector3.forward, aim * Vector3.forward) * wr, (1f - 45f / off) * live);
            }
            wp = R.GripPoint - wr * weapon.gripR.localPosition;
            if (weapon.butt.z < -0.1f)
            {
                // shoulder the stock: butt plate into the pocket in front of the right shoulder joint
                float seat = live * (1f - 0.75f * runF) * (1f - reloadW) * (1f - 0.6f * airW);
                Vector3 pocket = R.upper.position + body * new Vector3(-0.045f, -0.035f, 0.075f);
                wp = Vector3.Lerp(wp, pocket - wr * weapon.butt, seat);
            }
        }
        else if (kind == HoldKind.Pistol)
        {
            BendSpine(Quaternion.AngleAxis(pitch * live, right));
            lowW = Mathf.MoveTowards(lowW, moveS > 3.2f && sinceShot > 0.6f && !crouch ? 1f : 0f, dt * 4f);
            float low = Mathf.SmoothStep(0, 1, lowW);
            Vector3 anchor = rig.head.position;
            Vector3 pA = anchor + aim * new Vector3(0.03f, -0.10f, 0.46f), pB = anchor + body * new Vector3(0.07f, -0.36f, 0.30f);
            wp = Vector3.Lerp(pA, pB, low); wr = Quaternion.Slerp(aim, body * Quaternion.Euler(38f, -8f, 0), low);
            float rl = reloadW;
            wr = wr * Quaternion.Euler(-24f * rl, 4f * rl, -28f * rl); wp += aim * new Vector3(0.02f, -0.07f, -0.10f) * rl;
        }
        else
        {
            BendSpine(Quaternion.AngleAxis(pitch * 0.6f * live, right));
            readyW = Mathf.MoveTowards(readyW, moveS > 0.6f || attackT < 0.8f || crouch || airborne ? 1f : 0f, dt * 4f);
            float rd = Mathf.SmoothStep(0, 1, readyW) * live;
            Quaternion hr = R.GripRotation * Quaternion.Inverse(weapon.gripR.localRotation);
            Vector3 hp = R.GripPoint - hr * weapon.gripR.localPosition;
            Transform chest = rig.spine[rig.spine.Length - 1];
            float a = attackT < 0.35f ? Mathf.Sin(attackT / 0.35f * Mathf.PI) : 0f;
            Vector3 pB; Quaternion rB;
            if (kind == HoldKind.Knife)
            {
                pB = chest.position + aim * (new Vector3(0.21f, -0.20f, 0.30f) + new Vector3(-0.20f, 0.05f, 0.24f) * a);
                rB = aim * Quaternion.Euler(-48f + 38f * a, -18f - 45f * a, -15f * a);
            }
            else { pB = chest.position + aim * new Vector3(0.22f, -0.12f, 0.30f); rB = aim * Quaternion.Euler(-70f, 0, 0); }
            wp = Vector3.Lerp(hp, pB, rd); wr = Quaternion.Slerp(hr, rB, rd);
            guard = true; lIk = rd;
            lGuardP = chest.position + aim * new Vector3(-0.17f, -0.16f, 0.30f);
            lGuardR = aim * WeaponRig.LeftFrame(new Vector3(1f, 0f, 0.3f), new Vector3(0.2f, 0.6f, 0.8f));
        }
        if (deadW > 0f)
        {
            Quaternion hr = kind == HoldKind.Rifle ? R.hand.rotation * R.animRot : R.GripRotation * Quaternion.Inverse(weapon.gripR.localRotation);
            wr = Quaternion.Slerp(wr, hr, deadW); wp = Vector3.Lerp(wp, R.GripPoint - hr * weapon.gripR.localPosition, deadW);
        }
        if (kind == HoldKind.Rifle || kind == HoldKind.Pistol)
        {
            float k = kick * kick;
            wr = wr * Quaternion.Euler(-k * (kind == HoldKind.Pistol ? 9f : 2.5f), 0, 0);
            wp -= wr * Vector3.forward * (k * (kind == HoldKind.Pistol ? 0.02f : 0.03f));
        }
        if (sw > 0f)
        {
            Vector3 sh = R.upper.position; Quaternion qs = Quaternion.AngleAxis(62f * sw, right);
            wp = sh + qs * (wp - sh) - upv * (0.10f * sw); wr = qs * wr;
        }
        weapon.transform.SetPositionAndRotation(wp, wr);
        weapon.Pose(kind, reloadU, boltU);
        if (kind == HoldKind.Pistol && reloadU < 0f) weapon.Recoil(kick > 0.5f ? (1f - kick) * 2f : kick * 2f);

        if (live > 0f)
        {
            Vector3 hintR = R.fore.position - upv * 0.06f + right * 0.04f, hintL = L.fore.position - upv * 0.06f - right * 0.04f;
            R.HandFor(weapon.rPos, weapon.rRot, out var wpos, out var wrot);
            R.Solve(wpos, wrot, hintR, live);
            if (guard) L.HandFor(lGuardP, lGuardR, out wpos, out wrot); else L.HandFor(weapon.lPos, weapon.lRot, out wpos, out wrot);
            if (guard || weapon.gripL != null) L.Solve(wpos, wrot, hintL, live * lIk);
        }
        float[] rp = kind == HoldKind.Knife ? HandPose.Fist : kind == HoldKind.Grenade ? HandPose.Mag : sinceShot < 0.1f ? HandPose.Trigger : HandPose.Pistol;
        R.Fingers(HandPose.Lerp(rp, HandPose.Relaxed, Mathf.Max(deadW * 0.6f, weapon.rightBusy * 0.5f)), kind == HoldKind.Knife ? 0f : ThumbWrap);
        if (kind == HoldKind.Rifle) L.Fingers(HandPose.Lerp(HandPose.Lerp(HandPose.Guard, HandPose.Mag, weapon.leftBusy), HandPose.Relaxed, deadW));
        else if (kind == HoldKind.Pistol) L.Fingers(HandPose.Lerp(HandPose.Lerp(HandPose.Guard, HandPose.Mag, weapon.leftBusy), HandPose.Relaxed, deadW));
        else L.Fingers(HandPose.Lerp(HandPose.Relaxed, HandPose.Fist, readyW * 0.8f * live));
    }
    public static float ThumbWrap = 0f;
}
