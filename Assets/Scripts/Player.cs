using System.Collections.Generic;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;

/// One fighter: a human (owned by its client) or a bot (owned by the host).
public class Player : NetworkBehaviour
{
    public static readonly List<Player> All = new List<Player>();
    public static Player Local;

    // written by the host
    public NetworkVariable<int> Team = new NetworkVariable<int>(0);       // 1 = band (T), 2 = special forces (CT)
    public NetworkVariable<int> Health = new NetworkVariable<int>(0);
    public NetworkVariable<int> Armor = new NetworkVariable<int>(0);
    public NetworkVariable<int> Money = new NetworkVariable<int>(800);
    public NetworkVariable<int> Kills = new NetworkVariable<int>(0);
    public NetworkVariable<int> Deaths = new NetworkVariable<int>(0);
    public NetworkVariable<bool> IsBot = new NetworkVariable<bool>(false);
    public NetworkVariable<bool> HasBomb = new NetworkVariable<bool>(false);
    public NetworkVariable<int> Skin = new NetworkVariable<int>(0);
    public NetworkVariable<FixedString32Bytes> Nick = new NetworkVariable<FixedString32Bytes>("");

    // written by the owner
    const NetworkVariableReadPermission R = NetworkVariableReadPermission.Everyone;
    const NetworkVariableWritePermission O = NetworkVariableWritePermission.Owner;
    public NetworkVariable<Vector3> NetPos = new NetworkVariable<Vector3>(default, R, O);
    public NetworkVariable<Vector2> NetLook = new NetworkVariable<Vector2>(default, R, O); // yaw, pitch
    public NetworkVariable<bool> NetCrouch = new NetworkVariable<bool>(false, R, O);
    public NetworkVariable<int> NetWeapon = new NetworkVariable<int>(0, R, O);
    public NetworkVariable<float> NetSpeed = new NetworkVariable<float>(0, R, O);

    public bool Alive => Health.Value > 0;
    public bool IsHumanOwner => IsOwner && !IsBot.Value;
    public Vector3 Eye => transform.position + Vector3.up * (crouch ? 1.05f : 1.6f);
    public Vector3 Chest => transform.position + Vector3.up * (crouch ? 0.75f : 1.15f);

    // inventory (owner side)
    public readonly int[] slots = { 0, -1, -1, -1 };
    public readonly int[] mag = new int[Weapons.All.Length];
    public readonly int[] res = new int[Weapons.All.Length];
    public int cur;                    // weapon id in hands
    public float yaw, pitch;
    public bool crouch, zoomed;
    public float reloadEnd, nextFire, useProgress, recoilKick, lastShotTime, hitMarker, damageFlash;
    public bool Reloading => Time.time < reloadEnd;
    public WeaponDef Def => Weapons.Get(cur);

    CharacterController cc;
    SphereCollider head;
    Transform body, cam, viewModel, handWeapon;
    CharView view;
    FpView fp;                         // first-person arms + weapon (Assets/Scripts/Anim/FpView.cs)
    float vy, stepTimer, viewBob, viewKick, fovBase = 68f;
    int shownWeapon = -1, shownVm = -1;
    bool wasAlive, triggerHeld;
    static readonly RaycastHit[] hits = new RaycastHit[24];

    public override void OnNetworkSpawn()
    {
        All.Add(this);
        cc = GetComponent<CharacterController>();
        var h = new GameObject("Head");
        h.transform.SetParent(transform, false);
        h.transform.localPosition = new Vector3(0, 1.62f, 0.02f);
        head = h.AddComponent<SphereCollider>();
        head.radius = 0.16f;
        body = new GameObject("Body").transform;
        body.SetParent(transform, false);
        view = body.gameObject.AddComponent<CharView>();
        view.Init(this);
        Skin.OnValueChanged += (a, b) => view.Rebuild();
        Team.OnValueChanged += (a, b) => view.Rebuild();
        Health.OnValueChanged += OnHealth;
        if (IsOwner && !IsBot.Value)
        {
            Local = this;
            cam = Camera.main.transform;
            SubmitNickRpc(PlayerPrefs.GetString("nick", "Игрок" + Random.Range(10, 99)));
        }
        ApplyAliveState();
    }

    public override void OnNetworkDespawn()
    {
        All.Remove(this);
        if (Local == this) Local = null;
    }

    [Rpc(SendTo.Server)]
    void SubmitNickRpc(FixedString32Bytes n) { Nick.Value = n; }

    void OnHealth(int before, int now)
    {
        if (now < before && IsHumanOwner) damageFlash = 1f;
        if (now < before) Fx.Sound(now <= 0 ? "death" : "pain", Chest, now <= 0 ? 1f : 0.7f, 35f);
        if ((before > 0) != (now > 0)) ApplyAliveState();
    }

    void ApplyAliveState()
    {
        bool a = Alive;
        if (cc) cc.enabled = a;
        if (head) head.enabled = a;
        if (view) view.SetAlive(a);
        if (!a) { zoomed = false; useProgress = 0; }
    }

    // ---------------------------------------------------------------- host -> owner
    [Rpc(SendTo.Owner)]
    public void RespawnRpc(Vector3 pos, float newYaw, bool keepWeapons)
    {
        if (!keepWeapons)
        {
            slots[1] = Team.Value == 1 ? Weapons.DefaultT : Weapons.DefaultCT;
            slots[2] = -1; slots[3] = -1;
            Fill(slots[1]);
        }
        foreach (int s in slots) if (s > 0 && Weapons.Get(s).slot != Slot.Grenade) { mag[s] = Weapons.Get(s).mag; res[s] = Weapons.Get(s).reserve; }
        if (cc) cc.enabled = false;
        transform.position = pos;
        if (cc) cc.enabled = true;
        yaw = newYaw; pitch = 0; vy = 0; crouch = false; zoomed = false; reloadEnd = 0; recoilKick = 0;
        NetPos.Value = pos; NetLook.Value = new Vector2(yaw, 0);
        Select(slots[2] >= 0 ? slots[2] : slots[1]);
        var agent = GetComponent<UnityEngine.AI.NavMeshAgent>();
        if (agent && agent.isOnNavMesh) agent.Warp(pos);
    }

    [Rpc(SendTo.Owner)]
    public void GiveRpc(int id)
    {
        var d = Weapons.Get(id);
        slots[(int)d.slot] = id;
        Fill(id);
        if (d.slot != Slot.Grenade) Select(id);
    }

    void Fill(int id) { mag[id] = Weapons.Get(id).mag; res[id] = Weapons.Get(id).reserve; }

    // ---------------------------------------------------------------- owner -> host
    [Rpc(SendTo.Server)]
    public void BuyRpc(int id)
    {
        if (!Alive || Game.I == null || !Game.I.CanBuy) return;
        if (id == 100) // armour
        {
            if (Money.Value < 650 || Armor.Value >= 100) return;
            Money.Value -= 650; Armor.Value = 100; return;
        }
        var d = Weapons.Get(id);
        if (d.slot == Slot.Knife || Money.Value < d.price) return;
        Money.Value -= d.price;
        GiveRpc(id);
    }

    [Rpc(SendTo.Server)]
    void HitRpc(NetworkObjectReference victimRef, int weaponId, bool headshot, float dist)
    {
        if (!Alive || !victimRef.TryGet(out var no)) return;
        var v = no.GetComponent<Player>();
        var d = Weapons.Get(weaponId);
        if (v == null || !v.Alive || dist > d.range + 3f) return;
        float dmg = d.damage * (headshot ? d.headMul : 1f) * Mathf.Lerp(1f, 0.75f, Mathf.Clamp01(dist / 80f));
        Game.I.Damage(v, this, Mathf.RoundToInt(dmg), weaponId, headshot);
    }

    [Rpc(SendTo.NotOwner)]
    void ShotFxRpc(Vector3 from, Vector3 to, int weaponId, bool flesh)
    {
        Fx.Shot(from, to, weaponId, flesh, false);
        if (view) view.OnShot();
    }

    [Rpc(SendTo.NotOwner)]
    void ReloadFxRpc(float duration) { if (view) view.OnReload(duration); }

    [Rpc(SendTo.Server)]
    void ThrowRpc(Vector3 from, Vector3 vel) { Game.I.ThrowGrenade(this, from, vel); }

    // ---------------------------------------------------------------- weapons
    bool hasSelected;
    public void Select(int id)
    {
        if (id < 0 || (id == cur && hasSelected)) return;   // already in hands: no new draw delay
        hasSelected = true;
        cur = id; zoomed = false; reloadEnd = 0; nextFire = Time.time + 0.35f;
        if (IsOwner) NetWeapon.Value = id;
    }

    public void NextWeapon()
    {
        int s = (int)Def.slot;
        for (int i = 1; i <= 4; i++)
        {
            int n = (s + i) % 4;
            if (slots[n] >= 0 && (n != 3 || mag[slots[n]] > 0)) { Select(slots[n]); return; }
        }
    }

    public void SelectBest()
    {
        if (slots[2] >= 0 && mag[slots[2]] + res[slots[2]] > 0) Select(slots[2]);
        else if (slots[1] >= 0 && mag[slots[1]] + res[slots[1]] > 0) Select(slots[1]);
        else Select(0);
    }

    public void Reload()
    {
        var d = Def;
        if (d.slot == Slot.Knife || d.slot == Slot.Grenade || Reloading || mag[cur] >= d.mag || res[cur] <= 0) return;
        reloadEnd = Time.time + d.reload; zoomed = false;
        Fx.Sound("reload", transform.position, 0.5f);
        if (view) view.OnReload(d.reload);
        ReloadFxRpc(d.reload);
        Invoke(nameof(FinishReload), d.reload);
    }

    void FinishReload()
    {
        var d = Def;
        if (d.slot == Slot.Knife || d.slot == Slot.Grenade) return;
        int need = Mathf.Min(d.mag - mag[cur], res[cur]);
        mag[cur] += need; res[cur] -= need;
    }

    /// Fires along `dir` if the weapon is ready. Used by both the human owner and bots.
    public bool TryFire(Vector3 dir, bool moving, bool grounded)
    {
        var d = Def;
        if (!Alive || Time.time < nextFire || Reloading || Game.I == null || !Game.I.CanAct) return false;
        if (d.slot == Slot.Grenade)
        {
            if (mag[cur] <= 0) { SelectBest(); return false; }
            mag[cur] = 0; slots[3] = -1;
            ThrowRpc(Eye + dir * 0.4f, dir * 17f + Vector3.up * 3.5f);
            nextFire = Time.time + 0.6f; SelectBest();
            return true;
        }
        if (d.slot != Slot.Knife)
        {
            if (mag[cur] <= 0) { if (res[cur] > 0) Reload(); else if (!IsBot.Value) Fx.Sound("click", transform.position, 0.4f); nextFire = Time.time + 0.25f; return false; }
            mag[cur]--;
        }
        nextFire = Time.time + d.rate;
        float sp = d.spread * (moving ? 2.4f : 1f) * (grounded ? 1f : 4f) * (crouch ? 0.7f : 1f) + recoilKick * 0.35f;
        if (d.zoomFov > 0 && d.zoomFov < 30 && !zoomed) sp += 5f;
        Vector3 origin = Eye;
        Vector3 muzzle = origin + dir * 0.6f - Vector3.up * 0.12f + Vector3.Cross(Vector3.up, dir).normalized * 0.12f;
        bool anyFlesh = false; Vector3 end = origin + dir * d.range;
        for (int p = 0; p < d.pellets; p++)
        {
            Vector2 r = Random.insideUnitCircle * sp;
            Vector3 dd = Quaternion.LookRotation(dir) * Quaternion.Euler(-r.y, r.x, 0) * Vector3.forward;
            if (Cast(origin, dd, d.range, out var hit))
            {
                end = hit.point;
                var v = hit.collider.GetComponentInParent<Player>();
                if (v != null && v.Alive)
                {
                    anyFlesh = true;
                    if (v.Team.Value != Team.Value)
                    {
                        HitRpc(v.NetworkObject, cur, hit.collider.name == "Head", hit.distance);
                        if (IsHumanOwner) hitMarker = 0.18f;
                    }
                    Fx.Blood(hit.point, hit.normal);
                }
                else Fx.Impact(hit.point, hit.normal);
            }
            else end = origin + dd * d.range;
        }
        if (d.slot == Slot.Knife) Fx.Sound("knife", origin, 0.6f);
        else Fx.Shot(muzzle, end, cur, anyFlesh, IsHumanOwner);
        ShotFxRpc(muzzle, end, cur, anyFlesh);
        if (view) view.OnShot();
        recoilKick = Mathf.Min(recoilKick + d.recoil, 9f);
        lastShotTime = Time.time; viewKick = 1f;
        if (fp) fp.Fire();
        if (d.zoomFov > 0 && d.zoomFov < 30) zoomed = false;
        if (d.slot != Slot.Knife && mag[cur] == 0 && res[cur] > 0) Invoke(nameof(Reload), 0.25f);
        return true;
    }

    bool Cast(Vector3 origin, Vector3 dir, float range, out RaycastHit best)
    {
        int n = Physics.RaycastNonAlloc(origin, dir, hits, range, ~0, QueryTriggerInteraction.Ignore);
        best = default; float bd = float.MaxValue; bool ok = false;
        for (int i = 0; i < n; i++)
        {
            if (hits[i].collider.transform.IsChildOf(transform)) continue;
            if (hits[i].distance < bd) { bd = hits[i].distance; best = hits[i]; ok = true; }
        }
        return ok;
    }

    public bool CanSee(Player other)
    {
        Vector3 a = Eye, b = other.Chest;
        float dist = Vector3.Distance(a, b);
        int n = Physics.RaycastNonAlloc(a, (b - a) / dist, hits, dist, ~0, QueryTriggerInteraction.Ignore);
        for (int i = 0; i < n; i++)
        {
            var t = hits[i].collider.transform;
            if (t.IsChildOf(transform) || t.IsChildOf(other.transform)) continue;
            if (hits[i].collider.GetComponentInParent<Player>() != null) continue;
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- frame
    void Update()
    {
        if (!IsSpawned) return;
        recoilKick = Mathf.MoveTowards(recoilKick, 0, Time.deltaTime * (Time.time - lastShotTime > 0.25f ? 18f : 5f));
        if (hitMarker > 0) hitMarker -= Time.deltaTime;
        if (damageFlash > 0) damageFlash -= Time.deltaTime * 1.5f;

        if (IsOwner && !IsBot.Value) HumanUpdate();
        else if (IsOwner) BotOwnerUpdate();
        else RemoteUpdate();

        if (shownWeapon != NetWeapon.Value) { shownWeapon = NetWeapon.Value; view.SetWeapon(shownWeapon); }
        view.Tick(NetSpeed.Value, NetLook.Value.y, NetCrouch.Value);
    }

    void BotOwnerUpdate()
    {
        // BotBrain drives transform, yaw, pitch
        transform.rotation = Quaternion.Euler(0, yaw, 0);
        NetPos.Value = transform.position;
        NetLook.Value = new Vector2(yaw, pitch);
        NetCrouch.Value = crouch;
    }

    void RemoteUpdate()
    {
        Vector3 target = NetPos.Value;
        if ((transform.position - target).sqrMagnitude > 16f) transform.position = target;
        else transform.position = Vector3.Lerp(transform.position, target, Time.deltaTime * 14f);
        yaw = Mathf.LerpAngle(yaw, NetLook.Value.x, Time.deltaTime * 14f);
        pitch = NetLook.Value.y; crouch = NetCrouch.Value; cur = NetWeapon.Value;
        transform.rotation = Quaternion.Euler(0, yaw, 0);
        head.transform.localPosition = new Vector3(0, crouch ? 1.08f : 1.62f, 0.02f);
    }

    void HumanUpdate()
    {
        var g = Game.I;
        if (!Alive) { SpectateCamera(); return; }
        var inp = InputState.I;
        float sens = (zoomed ? Def.zoomFov / fovBase : 1f) * PlayerPrefs.GetFloat("sens", 1f);
        yaw += inp.look.x * sens;
        pitch = Mathf.Clamp(pitch - inp.look.y * sens, -85f, 85f);
        inp.look = Vector2.zero;

        bool canMove = g != null && g.CanAct;
        crouch = inp.crouch;
        float h = crouch ? 1.25f : 1.8f;
        if (Mathf.Abs(cc.height - h) > 0.01f) { cc.height = h; cc.center = new Vector3(0, h / 2f, 0); }
        head.transform.localPosition = new Vector3(0, crouch ? 1.08f : 1.62f, 0.02f);

        Vector2 mv = canMove ? Vector2.ClampMagnitude(inp.move, 1f) : Vector2.zero;
        float speed = 5.2f * Def.moveSpeed * (crouch ? 0.45f : 1f) * (zoomed ? 0.6f : 1f) * (inp.walk ? 0.5f : 1f);
        Vector3 wish = Quaternion.Euler(0, yaw, 0) * new Vector3(mv.x, 0, mv.y) * speed;
        if (cc.isGrounded)
        {
            vy = -2f;
            if (inp.jump && canMove) { vy = 6.4f; Fx.Sound("step", transform.position, 0.5f); }
        }
        inp.jump = false;
        vy -= 19f * Time.deltaTime;
        cc.Move((wish + Vector3.up * vy) * Time.deltaTime);
        float planar = new Vector3(cc.velocity.x, 0, cc.velocity.z).magnitude;
        if (cc.isGrounded && planar > 2.6f && !crouch)
        {
            stepTimer -= Time.deltaTime * planar;
            if (stepTimer <= 0) { stepTimer = 2.3f; Fx.Sound("step", transform.position, 0.35f); StepRpc(); }
        }
        viewBob += Time.deltaTime * planar * 2.2f;

        // weapons
        if (inp.next) { inp.next = false; NextWeapon(); }
        if (inp.slot >= 0) { if (slots[inp.slot] >= 0) Select(slots[inp.slot]); inp.slot = -1; }
        if (inp.reload) { inp.reload = false; Reload(); }
        if (inp.zoom) { inp.zoom = false; if (Def.zoomFov > 0 && !Reloading) zoomed = !zoomed; }
        if (inp.buy >= 0) { BuyRpc(inp.buy); inp.buy = -1; }
        Vector3 aim = Quaternion.Euler(pitch - recoilKick, yaw, 0) * Vector3.forward;
        if (inp.fire && (Def.auto || !triggerHeld)) TryFire(aim, planar > 1.5f, cc.isGrounded);
        triggerHeld = inp.fire;

        // plant / defuse
        bool using_ = false;
        if (inp.use && g != null)
        {
            if (g.CanPlant(this)) { using_ = true; useProgress += Time.deltaTime / 3.2f; if (useProgress >= 1f) { g.PlantRpc(NetworkObject, transform.position); useProgress = 0; } }
            else if (g.CanDefuse(this)) { using_ = true; useProgress += Time.deltaTime / 7f; if (useProgress >= 1f) { g.DefuseRpc(NetworkObject); useProgress = 0; } }
        }
        if (!using_) useProgress = 0;

        // publish
        transform.rotation = Quaternion.Euler(0, yaw, 0);
        NetPos.Value = transform.position;
        NetLook.Value = new Vector2(yaw, pitch);
        NetCrouch.Value = crouch;
        NetSpeed.Value = planar;

        // camera + first person weapon
        var camC = Camera.main;
        cam.position = Eye + Vector3.up * (Mathf.Sin(viewBob) * 0.012f);
        cam.rotation = Quaternion.Euler(pitch - recoilKick * 0.6f, yaw, 0);
        float targetFov = zoomed ? Def.zoomFov : fovBase;
        camC.fieldOfView = Mathf.Lerp(camC.fieldOfView, targetFov, Time.deltaTime * 18f);
        UpdateViewModel();
    }

    [Rpc(SendTo.NotOwner, Delivery = RpcDelivery.Unreliable)]
    void StepRpc() { Fx.Sound("step", transform.position, 0.35f); }

    // First-person view: arms + weapon are handled by FpView; this only feeds it the player's state.
    float fpYaw, fpPitch;
    void UpdateViewModel()
    {
        if (fp == null) { fp = FpView.Create(cam); viewModel = fp.transform; fpYaw = yaw; fpPitch = pitch; }
        shownVm = cur;
        viewKick = Mathf.MoveTowards(viewKick, 0, Time.deltaTime * 9f);
        bool hide = zoomed && Def.zoomFov < 30;
        if (viewModel.gameObject.activeSelf == hide) viewModel.gameObject.SetActive(!hide);
        var st = new FpView.State
        {
            weapon = cur,
            charKey = (Team.Value == 1 ? "t" : "ct") + (1 + Mathf.Abs(Skin.Value) % 2),
            reloadU = Reloading ? 1f - Mathf.Clamp01((reloadEnd - Time.time) / Mathf.Max(0.1f, Def.reload)) : -1f,
            magEmpty = mag[cur] <= 0,
            sinceShot = Time.time - lastShotTime,
            speed = NetSpeed.Value, bob = viewBob,
            look = new Vector2(Mathf.DeltaAngle(fpYaw, yaw), Mathf.DeltaAngle(fpPitch, pitch)),
        };
        fpYaw = yaw; fpPitch = pitch;
        if (!hide) fp.Tick(st, Time.deltaTime);
    }

    void SpectateCamera()
    {
        if (viewModel) viewModel.gameObject.SetActive(false);
        Camera.main.fieldOfView = fovBase;
        Player t = null;
        foreach (var p in All) if (p != this && p.Alive && p.Team.Value == Team.Value) { t = p; break; }
        if (t == null) foreach (var p in All) if (p.Alive) { t = p; break; }
        if (t == null) return;
        Quaternion rot = Quaternion.Euler(18f, t.NetLook.Value.x, 0);
        Vector3 want = t.Eye - rot * Vector3.forward * 3.2f;
        if (Physics.Linecast(t.Eye, want, out var hit, ~0, QueryTriggerInteraction.Ignore) && !hit.collider.GetComponentInParent<Player>()) want = hit.point + hit.normal * 0.2f;
        cam.position = Vector3.Lerp(cam.position, want, Time.deltaTime * 8f);
        cam.rotation = Quaternion.Slerp(cam.rotation, rot, Time.deltaTime * 8f);
        InputState.I.look = Vector2.zero;
    }
}
