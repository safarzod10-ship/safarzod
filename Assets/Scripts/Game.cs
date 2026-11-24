using System.Collections;
using System.Collections.Generic;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;

public enum Phase { Lobby = 0, Freeze = 1, Live = 2, Planted = 3, End = 4 }

/// Match rules, run by the host: teams, bots, rounds, money, the bomb, damage and grenades.
public class Game : NetworkBehaviour
{
    public static Game I;
    public static int TeamSize = 5;          // fighters per team, bots fill the free places
    public static float BotSkill = 0.5f;     // 0 easy .. 1 hard
    public const int WinRounds = 13, MaxMoney = 16000;
    const float FreezeTime = 6f, RoundTime = 115f, BombTime = 40f, EndTime = 5f, BuyTime = 20f;

    public GameObject playerPrefab;

    public NetworkVariable<int> PhaseV = new NetworkVariable<int>(0);
    public NetworkVariable<float> PhaseEnd = new NetworkVariable<float>(0);
    public NetworkVariable<float> PhaseStart = new NetworkVariable<float>(0);
    public NetworkVariable<int> ScoreT = new NetworkVariable<int>(0);
    public NetworkVariable<int> ScoreCT = new NetworkVariable<int>(0);
    public NetworkVariable<bool> BombDown = new NetworkVariable<bool>(false);
    public NetworkVariable<Vector3> BombPos = new NetworkVariable<Vector3>();

    public Phase Phase => (Phase)PhaseV.Value;
    public float Now => NetworkManager != null ? NetworkManager.ServerTime.TimeAsFloat : 0f;
    public float TimeLeft => Mathf.Max(0, PhaseEnd.Value - Now);
    public bool CanAct => Phase == Phase.Live || Phase == Phase.Planted || Phase == Phase.End;
    public bool CanBuy => Phase == Phase.Freeze || (Phase == Phase.Live && Now - PhaseStart.Value < BuyTime);

    public readonly List<Bounds> sites = new List<Bounds>();
    readonly List<Transform> spawnsT = new List<Transform>(), spawnsCT = new List<Transform>();
    readonly HashSet<Player> survivors = new HashSet<Player>();
    public int botSite;                       // site the bot band attacks this round
    GameObject bombVis; float nextBeep;
    public string banner = ""; public float bannerUntil;
    public readonly List<string> feed = new List<string>(); public float feedUntil;

    static readonly string[] BotNames = { "Фаррух", "Далер", "Рустам", "Бахтиёр", "Сухроб", "Фирдавс", "Умед", "Шахром", "Зафар", "Хуршед", "Парвиз", "Некруз", "Джамшед", "Комрон" };

    void Awake()
    {
        I = this;
        foreach (var n in new[] { "SiteA", "SiteB" }) { var s = GameObject.Find(n); if (s) sites.Add(new Bounds(s.transform.position, s.GetComponent<BoxCollider>().size)); }
        Collect("SpawnsT", spawnsT); Collect("SpawnsCT", spawnsCT);
        // Town level: one bomb site and the two team starts come from the level's marker objects
        var bs = GameObject.Find("BombSite");
        if (bs != null && sites.Count == 0) { var bc = bs.GetComponent<BoxCollider>(); sites.Add(new Bounds(bs.transform.position, bc != null ? bc.size : new Vector3(4, 2.5f, 6))); }
        if (spawnsT.Count == 0) Collect("SpawnA", spawnsT);
        if (spawnsCT.Count == 0) Collect("SpawnB", spawnsCT);
    }

    static void Collect(string root, List<Transform> list)
    {
        var r = GameObject.Find(root);
        if (r) foreach (Transform t in r.transform) list.Add(t);
    }

    public override void OnDestroy() { if (I == this) I = null; base.OnDestroy(); }

    public override void OnNetworkSpawn()
    {
        if (!IsServer) return;
        var surface = FindFirstObjectByType<Unity.AI.Navigation.NavMeshSurface>();
        if (surface != null) surface.BuildNavMesh();
        NetworkManager.OnClientConnectedCallback += OnClient;
        NetworkManager.OnClientDisconnectCallback += OnClientLeft;
        foreach (var id in NetworkManager.ConnectedClientsIds) OnClient(id);
        FillBots();
        StartRound(true);
    }

    public override void OnNetworkDespawn()
    {
        if (NetworkManager != null) { NetworkManager.OnClientConnectedCallback -= OnClient; NetworkManager.OnClientDisconnectCallback -= OnClientLeft; }
        if (bombVis) Destroy(bombVis);
    }

    // ---------------------------------------------------------------- teams
    int Count(int team, bool humansOnly = false, bool aliveOnly = false)
    {
        int n = 0;
        foreach (var p in Player.All) if (p.Team.Value == team && (!humansOnly || !p.IsBot.Value) && (!aliveOnly || p.Alive)) n++;
        return n;
    }

    void OnClient(ulong id)
    {
        foreach (var p in Player.All) if (!p.IsBot.Value && p.OwnerClientId == id) return;
        int team = Count(1, true) <= Count(2, true) ? 1 : 2;
        // a human takes the place of a bot
        if (Count(team) >= TeamSize)
            foreach (var p in Player.All) if (p.IsBot.Value && p.Team.Value == team) { p.NetworkObject.Despawn(true); break; }
        var pl = Create(team, false, id);
        if (Phase != Phase.Lobby) SpawnAt(pl, false);
    }

    void OnClientLeft(ulong id) { if (IsServer) Invoke(nameof(FillBots), 0.5f); }

    Player Create(int team, bool bot, ulong owner)
    {
        var go = Instantiate(playerPrefab, new Vector3(0, -50, 0), Quaternion.identity);
        var no = go.GetComponent<NetworkObject>();
        var p = go.GetComponent<Player>();
        p.Team.Value = team; p.IsBot.Value = bot; p.Money.Value = 800;
        p.Skin.Value = Count(team) % 2;
        if (bot) no.Spawn(true); else no.SpawnAsPlayerObject(owner, true);
        if (bot)
        {
            var used = new HashSet<string>();
            foreach (var o in Player.All) used.Add(o.Nick.Value.ToString());
            string name = BotNames[Random.Range(0, BotNames.Length)];
            for (int i = 0; i < 30 && used.Contains(name); i++) name = BotNames[Random.Range(0, BotNames.Length)];
            p.Nick.Value = name;
            go.AddComponent<BotBrain>();
        }
        return p;
    }

    void FillBots()
    {
        if (!IsServer) return;
        for (int team = 1; team <= 2; team++)
            while (Count(team) < TeamSize) { var b = Create(team, true, 0); if (Phase != Phase.Lobby) b.Health.Value = 0; }
    }

    // ---------------------------------------------------------------- rounds
    void SetPhase(Phase ph, float duration)
    {
        PhaseV.Value = (int)ph; PhaseStart.Value = Now; PhaseEnd.Value = Now + duration;
    }

    void StartRound(bool first)
    {
        BombDown.Value = false;
        botSite = Random.Range(0, Mathf.Max(1, sites.Count));
        var ts = new List<Player>();
        foreach (var p in Player.All)
        {
            p.HasBomb.Value = false;
            SpawnAt(p, survivors.Contains(p));
            if (p.Team.Value == 1) ts.Add(p);
        }
        survivors.Clear();
        if (ts.Count > 0) ts[Random.Range(0, ts.Count)].HasBomb.Value = true;
        SetPhase(Phase.Freeze, FreezeTime);
        foreach (var p in Player.All) { var b = p.GetComponent<BotBrain>(); if (b) b.OnRoundStart(); }
    }

    void SpawnAt(Player p, bool keepWeapons)
    {
        var list = p.Team.Value == 1 ? spawnsT : spawnsCT;
        Vector3 pos = Vector3.up; float yaw = 0;
        if (list.Count > 0)
        {
            int idx = 0, k = 0;
            foreach (var o in Player.All) { if (o == p) idx = k; if (o.Team.Value == p.Team.Value) k++; }
            var t = list[idx % list.Count]; pos = t.position; yaw = t.eulerAngles.y;
        }
        p.Health.Value = 100;
        if (!keepWeapons) p.Armor.Value = 0;
        p.RespawnRpc(pos, yaw, keepWeapons);
    }

    void Update()
    {
        UpdateBombVisual();
        if (!IsSpawned || !IsServer) return;
        switch (Phase)
        {
            case Phase.Freeze:
                if (TimeLeft <= 0) SetPhase(Phase.Live, RoundTime);
                break;
            case Phase.Live:
                if (Count(1, false, true) == 0) EndRound(2, "Банда уничтожена");
                else if (Count(2, false, true) == 0) EndRound(1, "Спецназ уничтожен");
                else if (TimeLeft <= 0) EndRound(2, "Время вышло");
                break;
            case Phase.Planted:
                if (TimeLeft <= 0) Explode();
                else if (Count(2, false, true) == 0) EndRound(1, "Спецназ уничтожен");
                break;
            case Phase.End:
                if (TimeLeft <= 0)
                {
                    if (ScoreT.Value >= WinRounds || ScoreCT.Value >= WinRounds)
                    {
                        ScoreT.Value = 0; ScoreCT.Value = 0; survivors.Clear();
                        foreach (var p in Player.All) { p.Money.Value = 800; p.Kills.Value = 0; p.Deaths.Value = 0; }
                    }
                    StartRound(false);
                }
                break;
        }
    }

    void EndRound(int winner, string reason)
    {
        if (Phase == Phase.End) return;
        if (winner == 1) ScoreT.Value++; else ScoreCT.Value++;
        foreach (var p in Player.All)
        {
            if (p.Alive) survivors.Add(p);
            p.Money.Value = Mathf.Min(MaxMoney, p.Money.Value + (p.Team.Value == winner ? 3250 : 1900));
        }
        SetPhase(Phase.End, EndTime);
        bool match = ScoreT.Value >= WinRounds || ScoreCT.Value >= WinRounds;
        BannerRpc((winner == 1 ? "Победа банды" : "Победа спецназа") + " — " + reason + (match ? "\nМАТЧ ОКОНЧЕН" : ""), winner);
    }

    [Rpc(SendTo.Everyone)]
    void BannerRpc(FixedString128Bytes text, int winner)
    {
        banner = text.ToString(); bannerUntil = Time.time + EndTime;
        Fx.Sound2D("plant", 0.6f);
    }

    // ---------------------------------------------------------------- damage
    public void Damage(Player v, Player attacker, int dmg, int weaponId, bool head)
    {
        if (!IsServer || !v.Alive || !CanAct) return;
        if (v.Armor.Value > 0 && Weapons.Get(weaponId).slot != Slot.Knife)
        {
            int absorbed = Mathf.Min(v.Armor.Value * 2, dmg / 2);
            v.Armor.Value -= absorbed / 2; dmg -= absorbed;
        }
        v.Health.Value = Mathf.Max(0, v.Health.Value - dmg);
        var brain = v.GetComponent<BotBrain>();
        if (brain && attacker) brain.OnHurt(attacker);
        if (v.Health.Value > 0) return;
        v.Deaths.Value++;
        if (attacker != null && attacker != v)
        {
            attacker.Kills.Value++;
            attacker.Money.Value = Mathf.Min(MaxMoney, attacker.Money.Value + Weapons.Get(weaponId).killReward);
        }
        if (v.HasBomb.Value)
        {
            v.HasBomb.Value = false;
            Player best = null; float bd = float.MaxValue;
            foreach (var p in Player.All)
                if (p.Alive && p.Team.Value == 1) { float d = (p.transform.position - v.transform.position).sqrMagnitude; if (d < bd) { bd = d; best = p; } }
            if (best) best.HasBomb.Value = true;
        }
        KillRpc(attacker ? attacker.Nick.Value : default, v.Nick.Value, weaponId, head, attacker ? attacker.Team.Value : 0);
    }

    [Rpc(SendTo.Everyone)]
    void KillRpc(FixedString32Bytes killer, FixedString32Bytes victim, int weaponId, bool head, int killerTeam)
    {
        feed.Add($"{killer}  [{Weapons.Get(weaponId).title}{(head ? " в голову" : "")}]  {victim}");
        if (feed.Count > 5) feed.RemoveAt(0);
        feedUntil = Time.time + 6f;
    }

    // ---------------------------------------------------------------- bomb
    public int SiteIndex(Vector3 pos)
    {
        for (int i = 0; i < sites.Count; i++)
        {
            var b = sites[i];
            if (pos.x > b.min.x && pos.x < b.max.x && pos.z > b.min.z && pos.z < b.max.z) return i;
        }
        return -1;
    }

    public bool CanPlant(Player p) => p.Alive && p.HasBomb.Value && Phase == Phase.Live && SiteIndex(p.transform.position) >= 0;
    public bool CanDefuse(Player p) => p.Alive && p.Team.Value == 2 && Phase == Phase.Planted && BombDown.Value && (p.transform.position - BombPos.Value).sqrMagnitude < 2.2f * 2.2f;

    [Rpc(SendTo.Server)]
    public void PlantRpc(NetworkObjectReference who, Vector3 pos)
    {
        if (!who.TryGet(out var no)) return;
        var p = no.GetComponent<Player>();
        if (p == null || !p.HasBomb.Value || Phase != Phase.Live || SiteIndex(pos) < 0) return;
        if (Physics.Raycast(pos + Vector3.up, Vector3.down, out var hit, 3f, ~0, QueryTriggerInteraction.Ignore)) pos = hit.point;
        p.HasBomb.Value = false; p.Money.Value = Mathf.Min(MaxMoney, p.Money.Value + 300);
        BombPos.Value = pos; BombDown.Value = true;
        SetPhase(Phase.Planted, BombTime);
        NoticeRpc("Бомба заложена!");
    }

    [Rpc(SendTo.Server)]
    public void DefuseRpc(NetworkObjectReference who)
    {
        if (!who.TryGet(out var no)) return;
        var p = no.GetComponent<Player>();
        if (p == null || !CanDefuse(p)) return;
        BombDown.Value = false; p.Money.Value = Mathf.Min(MaxMoney, p.Money.Value + 300);
        EndRound(2, "Бомба обезврежена");
    }

    [Rpc(SendTo.Everyone)]
    void NoticeRpc(FixedString64Bytes text) { banner = text.ToString(); bannerUntil = Time.time + 3f; Fx.Sound2D("plant", 0.7f); }

    void Explode()
    {
        Vector3 pos = BombPos.Value;
        BombDown.Value = false;
        ExplodeRpc(pos, true);
        foreach (var p in new List<Player>(Player.All))
        {
            float d = Vector3.Distance(p.Chest, pos);
            if (p.Alive && d < 28f) Damage(p, null, Mathf.RoundToInt(500f * (1f - d / 28f)), Weapons.Grenade, false);
        }
        EndRound(1, "Бомба взорвана");
    }

    [Rpc(SendTo.Everyone)]
    void ExplodeRpc(Vector3 pos, bool big)
    {
        Fx.Explosion(pos);
        if (big) for (int i = 0; i < 6; i++) Fx.Explosion(pos + Random.insideUnitSphere * 4f + Vector3.up * 2f);
    }

    void UpdateBombVisual()
    {
        if (!IsSpawned) return;
        if (BombDown.Value && bombVis == null)
        {
            var prefab = Resources.Load<GameObject>("Weapons/c4");
            if (prefab) bombVis = Instantiate(prefab);
            else
            {
                bombVis = GameObject.CreatePrimitive(PrimitiveType.Cube);
                bombVis.transform.localScale = new Vector3(0.3f, 0.1f, 0.2f);
                bombVis.GetComponent<Renderer>().sharedMaterial = Mats.Lit(new Color(0.35f, 0.3f, 0.2f));
            }
            foreach (var c in bombVis.GetComponentsInChildren<Collider>()) Destroy(c);
            bombVis.transform.position = BombPos.Value + Vector3.up * 0.03f;
            var l = new GameObject("led").AddComponent<Light>();
            l.transform.SetParent(bombVis.transform, false); l.transform.localPosition = Vector3.up * 0.3f;
            l.color = Color.red; l.range = 3f; l.intensity = 0;
        }
        else if (!BombDown.Value && bombVis != null) Destroy(bombVis);
        if (bombVis != null && Phase == Phase.Planted && Time.time >= nextBeep)
        {
            float t = Mathf.Clamp01(TimeLeft / BombTime);
            nextBeep = Time.time + Mathf.Lerp(0.12f, 1f, t);
            Fx.Sound("beep", bombVis.transform.position, 1f, 45f);
            var led = bombVis.GetComponentInChildren<Light>();
            if (led) { led.intensity = 3f; StartCoroutine(LedOff(led)); }
        }
    }

    IEnumerator LedOff(Light l) { yield return new WaitForSeconds(0.07f); if (l) l.intensity = 0; }

    // ---------------------------------------------------------------- grenades
    public void ThrowGrenade(Player owner, Vector3 from, Vector3 vel)
    {
        GrenadeRpc(from, vel);
        StartCoroutine(GrenadeBoom(owner, from, vel));
    }

    public static Vector3 SimGrenade(Vector3 pos, ref Vector3 vel, float dt)
    {
        vel += Vector3.down * 16f * dt;
        Vector3 step = vel * dt;
        if (Physics.Raycast(pos, step.normalized, out var hit, step.magnitude + 0.08f, ~0, QueryTriggerInteraction.Ignore) && !hit.collider.GetComponentInParent<Player>())
        {
            vel = Vector3.Reflect(vel, hit.normal) * 0.42f;
            return hit.point + hit.normal * 0.08f;
        }
        return pos + step;
    }

    IEnumerator GrenadeBoom(Player owner, Vector3 pos, Vector3 vel)
    {
        float t = 0;
        while (t < 1.9f) { pos = SimGrenade(pos, ref vel, 0.02f); t += 0.02f; if (Mathf.RoundToInt(t * 50) % 1 == 0) yield return new WaitForSeconds(0.02f); }
        ExplodeRpc(pos, false);
        foreach (var p in new List<Player>(Player.All))
        {
            if (!p.Alive || (owner != null && p != owner && p.Team.Value == owner.Team.Value)) continue;
            float d = Vector3.Distance(p.Chest, pos);
            if (d > 9f) continue;
            if (Physics.Linecast(pos + Vector3.up * 0.2f, p.Chest, out var hit, ~0, QueryTriggerInteraction.Ignore) && hit.collider.GetComponentInParent<Player>() == null) continue;
            Damage(p, owner, Mathf.RoundToInt(98f * (1f - d / 9f)), Weapons.Grenade, false);
        }
    }

    [Rpc(SendTo.Everyone)]
    void GrenadeRpc(Vector3 from, Vector3 vel) { StartCoroutine(GrenadeFly(from, vel)); }

    IEnumerator GrenadeFly(Vector3 pos, Vector3 vel)
    {
        var g = WeaponModels.Create(Weapons.Grenade, false);
        float t = 0;
        while (t < 1.9f)
        {
            pos = SimGrenade(pos, ref vel, 0.02f); t += 0.02f;
            g.transform.position = pos; g.transform.Rotate(400f * 0.02f, 250f * 0.02f, 0);
            yield return new WaitForSeconds(0.02f);
        }
        Destroy(g);
    }

    public static bool NavPoint(Vector3 center, float radius, out Vector3 result)
    {
        for (int i = 0; i < 8; i++)
        {
            Vector2 r = Random.insideUnitCircle * radius;
            if (NavMesh.SamplePosition(center + new Vector3(r.x, 0, r.y), out var hit, 3f, NavMesh.AllAreas)) { result = hit.position; return true; }
        }
        result = center; return false;
    }
}
