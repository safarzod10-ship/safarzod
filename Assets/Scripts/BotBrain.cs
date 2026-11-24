using UnityEngine;
using UnityEngine.AI;

/// Host-side AI for one bot: moves on the navmesh, fights, plants, defuses and buys.
public class BotBrain : MonoBehaviour
{
    Player p;
    NavMeshAgent agent;
    Player target, lastAttacker;
    float nextThink, seenSince, burstEnd, pauseEnd, holdUntil, workTime, hurtTime, strafeUntil;
    Vector3 goal; bool hasGoal; int strafeDir = 1;
    float skill;

    // ---- team plan for levels with one bomb site (Town). Unity coordinates, y ignored.
    // Defenders hold angles on the entries; attackers split over two routes, stage, then execute together.
    static readonly Vector3[] HoldCT = { new Vector3(-3.5f, 0, -1.0f), new Vector3(-6.0f, 0, -3.0f), new Vector3(2.5f, 0, -1.5f), new Vector3(-5.0f, 0, 2.0f), new Vector3(-0.6f, 0, -5.6f) };
    static readonly Vector3[] WatchCT = { new Vector3(1.2f, 0, 9.2f), new Vector3(-12.7f, 0, 5.6f), new Vector3(1.2f, 0, 9.2f), new Vector3(-12.7f, 0, 5.6f), new Vector3(-0.6f, 0, 8f) };
    static readonly Vector3[][] RouteT =
    {
        new[] { new Vector3(-1.5f, 0, 17.0f), new Vector3(-0.5f, 0, 14.0f), new Vector3(1.2f, 0, 11.5f), new Vector3(1.2f, 0, 7.5f) },                        // south gate
        new[] { new Vector3(-6.0f, 0, 14.0f), new Vector3(-17.0f, 0, 13.0f), new Vector3(-17.0f, 0, 8.0f), new Vector3(-12.7f, 0, 5.6f), new Vector3(-9.0f, 0, 3.5f) }, // east lane + arch
    };
    int rank, group, wp; float executeAt; bool planMode; Vector3 watch; bool holding;

    void Awake()
    {
        p = GetComponent<Player>();
        skill = Mathf.Clamp01(Game.BotSkill + Random.Range(-0.15f, 0.15f));
    }

    void EnsureAgent()
    {
        if (agent != null) return;
        if (!NavMesh.SamplePosition(transform.position, out var hit, 4f, NavMesh.AllAreas)) return;
        agent = gameObject.AddComponent<NavMeshAgent>();
        agent.radius = 0.32f; agent.height = 1.8f; agent.speed = 4.7f; agent.acceleration = 40f;
        agent.angularSpeed = 0; agent.updateRotation = false; agent.stoppingDistance = 0.4f;
        agent.obstacleAvoidanceType = ObstacleAvoidanceType.LowQualityObstacleAvoidance;
        agent.avoidancePriority = Random.Range(20, 80);
        agent.Warp(hit.position);
    }

    public void OnRoundStart()
    {
        target = null; lastAttacker = null; hasGoal = false; workTime = 0; holdUntil = 0;
        Invoke(nameof(Buy), Random.Range(0.3f, 2f));
        planMode = GameObject.Find("BombSite") != null;
        rank = 0;
        foreach (var o in Player.All) if (o != p && o.Team.Value == p.Team.Value && o.NetworkObjectId < p.NetworkObjectId) rank++;
        group = rank % 2; wp = 0; holding = false;
        executeAt = Random.Range(16f, 22f);              // seconds after the round goes live
        watch = Vector3.zero;
    }

    public void OnHurt(Player attacker) { lastAttacker = attacker; hurtTime = Time.time; }

    void Buy()
    {
        if (!p.Alive || !Game.I.CanBuy) return;
        int money = p.Money.Value;
        int rifle = p.Team.Value == 1 ? 16 : 17;                      // Калаш / Карабин
        int[] wish = money > 5200 && Random.value < 0.15f ? new[] { 21, rifle, 11 } : new[] { rifle, p.Team.Value == 1 ? 14 : 15, 11, 9 };
        if (p.slots[2] < 0)
            foreach (int id in wish)
                if (Weapons.Get(id).price <= money) { p.Money.Value -= Weapons.Get(id).price; p.GiveRpc(id); money = p.Money.Value; break; }
        if (money >= 650 && p.Armor.Value < 100) { p.Money.Value -= 650; p.Armor.Value = 100; }
    }

    void Update()
    {
        if (p == null || !p.IsSpawned || !p.IsServer) return;
        var g = Game.I;
        if (g == null) return;
        if (!p.Alive) { if (agent && agent.enabled && agent.isOnNavMesh) agent.isStopped = true; p.NetSpeed.Value = 0; return; }
        EnsureAgent();
        if (agent == null || !agent.isOnNavMesh) return;
        if (!g.CanAct) { agent.isStopped = true; p.NetSpeed.Value = 0; return; }

        if (Time.time >= nextThink) { nextThink = Time.time + 0.2f; Think(g); }

        if (target != null && target.Alive) Fight();
        else
        {
            target = null;
            agent.isStopped = Time.time < holdUntil || workTime > 0;
            Vector3 v = agent.desiredVelocity; v.y = 0;
            if (v.sqrMagnitude > 0.3f) Turn(Mathf.Atan2(v.x, v.z) * Mathf.Rad2Deg, 0, 420f);
            else if (holding && watch != Vector3.zero)
            {
                Vector3 w = watch - transform.position; w.y = 0;
                Turn(Mathf.Atan2(w.x, w.z) * Mathf.Rad2Deg + Mathf.Sin(Time.time * 0.6f + rank) * 12f, 0, 200f);
            }
            else Turn(p.yaw + Mathf.Sin(Time.time * 0.7f + GetInstanceID()) * 40f * Time.deltaTime, 0, 200f);
            p.zoomed = false;
            if (p.Def.slot != Slot.Knife && p.mag[p.cur] < p.Def.mag / 2 && !p.Reloading) p.Reload();
            Objective(g);
        }
        p.NetSpeed.Value = agent.isStopped ? 0 : agent.velocity.magnitude;
    }

    void Think(Game g)
    {
        Player best = null; float bd = float.MaxValue;
        Vector3 fwd = Quaternion.Euler(0, p.yaw, 0) * Vector3.forward;
        foreach (var o in Player.All)
        {
            if (!o.Alive || o.Team.Value == p.Team.Value || o == p) continue;
            Vector3 to = o.Chest - p.Eye; float d = to.magnitude;
            if (d > 75f) continue;
            bool aware = d < 7f || Vector3.Angle(fwd, to) < 62f || (o == lastAttacker && Time.time - hurtTime < 3f);
            if (!aware || !p.CanSee(o)) continue;
            if (d < bd) { bd = d; best = o; }
        }
        if (best != target) { target = best; seenSince = Time.time; }
        p.SelectBest();
    }

    void Fight()
    {
        Vector3 aimPoint = Random.value < 0.25f * skill ? target.Eye : target.Chest;
        Vector3 to = aimPoint - p.Eye; float d = to.magnitude;
        float wantYaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
        float wantPitch = -Mathf.Asin(Mathf.Clamp(to.y / Mathf.Max(d, 0.01f), -1f, 1f)) * Mathf.Rad2Deg;
        Turn(wantYaw, wantPitch, Mathf.Lerp(260f, 560f, skill));
        workTime = 0;

        // move: close in with a knife, otherwise stop or strafe a little
        if (p.Def.slot == Slot.Knife) { agent.isStopped = false; agent.SetDestination(target.transform.position); }
        else if (d > 28f && !p.Def.auto && p.Def.zoomFov == 0) { agent.isStopped = false; agent.SetDestination(target.transform.position); }
        else
        {
            if (Time.time > strafeUntil) { strafeUntil = Time.time + Random.Range(0.5f, 1.4f); strafeDir = Random.value < 0.4f ? 0 : (Random.value < 0.5f ? -1 : 1); }
            agent.isStopped = true;
            if (strafeDir != 0) agent.Move(Quaternion.Euler(0, p.yaw, 0) * Vector3.right * strafeDir * 1.6f * Time.deltaTime);
        }

        float reaction = Mathf.Lerp(0.75f, 0.28f, skill);
        float off = Mathf.Abs(Mathf.DeltaAngle(p.yaw, wantYaw)) + Mathf.Abs(p.pitch - wantPitch);
        if (Time.time - seenSince < reaction || off > 9f) return;
        if (p.Def.slot == Slot.Knife && d > 2.1f) return;
        // fire in bursts: shoot until burstEnd, rest until pauseEnd, then start the next burst
        if (Time.time >= burstEnd)
        {
            if (Time.time < pauseEnd) return;
            burstEnd = Time.time + Random.Range(0.25f, 0.8f);
            pauseEnd = burstEnd + Random.Range(0.15f, 0.5f) * (p.Def.auto ? 1f : 0.3f);
        }
        float err = Mathf.Lerp(4.2f, 1.1f, skill) * (1f + d / 40f) * (p.Def.zoomFov > 0 ? 0.6f : 1f);
        Vector2 e = Random.insideUnitCircle * err;
        Vector3 dir = Quaternion.Euler(p.pitch + e.y, p.yaw + e.x, 0) * Vector3.forward;
        p.zoomed = p.Def.zoomFov > 0;
        p.TryFire(dir, agent.velocity.sqrMagnitude > 1f, true);
    }

    void Turn(float wantYaw, float wantPitch, float speed)
    {
        p.yaw = Mathf.MoveTowardsAngle(p.yaw, wantYaw, speed * Time.deltaTime);
        p.pitch = Mathf.MoveTowards(p.pitch, wantPitch, speed * 0.6f * Time.deltaTime);
    }

    void Go(Vector3 center, float radius, float hold)
    {
        if (hasGoal && (goal - center).sqrMagnitude < (radius + 2f) * (radius + 2f))
        {
            if (agent.remainingDistance < 0.8f && !agent.pathPending && Time.time > holdUntil + 0.5f)
            {
                holdUntil = Time.time + hold * Random.Range(0.6f, 1.4f);
                hasGoal = false;
            }
            return;
        }
        if (Time.time < holdUntil) return;
        if (Game.NavPoint(center, radius, out goal)) { hasGoal = true; agent.SetDestination(goal); }
    }

    bool Reach(Vector3 p0, float tol)
    {
        if (!hasGoal || (goal - p0).sqrMagnitude > 1f)
        {
            if (!NavMesh.SamplePosition(p0, out var h, 3f, NavMesh.AllAreas)) return true;   // unreachable point: skip it
            goal = h.position; hasGoal = true; agent.SetDestination(goal);
        }
        Vector3 d = goal - transform.position; d.y = 0;
        return d.sqrMagnitude < tol * tol || (!agent.pathPending && agent.remainingDistance < tol);
    }

    void PlanObjective(Game g)
    {
        Vector3 site = g.sites[0].center; site.y = 0;
        float live = g.Now - g.PhaseStart.Value;
        holding = false;
        if (p.Team.Value == 2)
        {   // defenders: take a hold spot and keep the angle; on plant everybody goes to the bomb
            if (g.Phase == Phase.Planted) { workTime = 0; DefuseRun(g); return; }
            int i = rank % HoldCT.Length;
            watch = WatchCT[i];
            if (Reach(HoldCT[i], 0.7f)) { agent.isStopped = true; holding = true; p.crouch = rank % 3 == 2; }
            return;
        }
        // attackers
        p.crouch = false;
        if (g.Phase == Phase.Planted)
        {
            watch = WatchCT[rank % WatchCT.Length];
            if (Reach(g.BombPos.Value + new Vector3(Mathf.Sin(rank * 2.1f), 0, Mathf.Cos(rank * 2.1f)) * 5f, 1.2f)) { agent.isStopped = true; holding = true; }
            return;
        }
        var route = RouteT[group];
        if (wp < route.Length)
        {
            bool staging = wp == route.Length - 1 && live < executeAt;
            if (staging) { watch = route[wp]; holding = true; agent.isStopped = true; return; }
            if (Reach(route[wp], 1.5f)) { wp++; hasGoal = false; }
            return;
        }
        if (p.HasBomb.Value)
        {
            if (g.CanPlant(p) && (transform.position - site).sqrMagnitude < 9f)
            {
                workTime += Time.deltaTime; agent.isStopped = true; p.crouch = true;
                if (workTime >= 3.2f) { g.PlantRpc(p.NetworkObject, transform.position); workTime = 0; p.crouch = false; }
                return;
            }
            workTime = 0; Reach(site, 0.8f); return;
        }
        // escorts: cover the carrier from points around the site
        watch = WatchCT[(rank + 1) % WatchCT.Length];
        if (Reach(site + new Vector3(Mathf.Sin(rank * 2.4f), 0, Mathf.Cos(rank * 2.4f)) * 4.5f, 1.2f)) { agent.isStopped = true; holding = true; }
    }

    void DefuseRun(Game g)
    {
        Vector3 b = g.BombPos.Value;
        if (g.CanDefuse(p))
        {
            workTime += Time.deltaTime; agent.isStopped = true; p.crouch = true;
            if (workTime >= 7f) { g.DefuseRpc(p.NetworkObject); workTime = 0; p.crouch = false; }
            return;
        }
        workTime = 0; Reach(b, 1.2f);
    }

    void Objective(Game g)
    {
        if (g.sites.Count == 0) return;
        if (planMode) { PlanObjective(g); return; }
        Vector3 site = g.sites[Mathf.Clamp(g.botSite, 0, g.sites.Count - 1)].center; site.y = 0;
        if (p.Team.Value == 1)
        {
            if (g.Phase == Phase.Planted) { Go(g.BombPos.Value, 9f, 4f); return; }
            if (p.HasBomb.Value && g.CanPlant(p) && (transform.position - site).sqrMagnitude < 16f)
            {
                workTime += Time.deltaTime; agent.isStopped = true;
                if (workTime >= 3.2f) { g.PlantRpc(p.NetworkObject, transform.position); workTime = 0; }
                return;
            }
            workTime = 0;
            if (p.HasBomb.Value) { if (!hasGoal || (goal - site).sqrMagnitude > 9f) { hasGoal = Game.NavPoint(site, 2.5f, out goal); agent.SetDestination(goal); } }
            else Go(site, 8f, 2.5f);
        }
        else
        {
            if (g.Phase == Phase.Planted)
            {
                Vector3 b = g.BombPos.Value;
                if (g.CanDefuse(p))
                {
                    workTime += Time.deltaTime; agent.isStopped = true;
                    if (workTime >= 7f) { g.DefuseRpc(p.NetworkObject); workTime = 0; }
                    return;
                }
                workTime = 0;
                if (!hasGoal || (goal - b).sqrMagnitude > 2.5f) { hasGoal = Game.NavPoint(b, 1.2f, out goal); agent.SetDestination(goal); }
                return;
            }
            workTime = 0;
            int mine = Mathf.Abs(GetInstanceID()) % g.sites.Count;
            Vector3 c = g.sites[mine].center; c.y = 0;
            Go(c, 9f, 5f);
        }
    }
}
