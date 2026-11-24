using System.Collections.Generic;
using UnityEngine;

/// Touch / keyboard input shared between the HUD and the local player.
public class InputState
{
    public static readonly InputState I = new InputState();
    public Vector2 move, look;
    public bool fire, jump, crouch, walk, reload, next, use, zoom;
    public int slot = -1, buy = -1;
}

/// Material templates saved as assets so their shaders are included in builds.
public static class Tpl
{
    static Material lit, litN, fx, sky;
    public static Material LitN => litN != null ? litN : litN = Resources.Load<Material>("Mat/LitN");
    public static Material Lit => lit != null ? lit : lit = Resources.Load<Material>("Mat/Lit");
    public static Material Fx => fx != null ? fx : fx = Resources.Load<Material>("Mat/Fx");
    public static Material Sky => sky != null ? sky : sky = Resources.Load<Material>("Mat/Sky");
}

public static class Mats
{
    static readonly Dictionary<Color, Material> cache = new Dictionary<Color, Material>();
    public static Material Lit(Color c, float smooth = 0.2f, float metal = 0f)
    {
        if (cache.TryGetValue(c, out var m)) return m;
        m = new Material(Tpl.Lit) { color = c };
        m.SetColor("_BaseColor", c);
        m.SetFloat("_Smoothness", smooth); m.SetFloat("_Metallic", metal);
        cache[c] = m; return m;
    }
    public static Material Unlit(Color c)
    {
        var m = new Material(Tpl.Fx);
        m.SetColor("_BaseColor", c); m.color = c;
        return m;
    }
}

public static class WeaponModels
{
    public static GameObject Create(int id, bool firstPerson)
    {
        var d = Weapons.Get(id);
        var prefab = Resources.Load<GameObject>("Weapons/" + d.key);
        if (prefab == null)
        {   // weapons whose own model is not prepared yet borrow the closest finished one instead of a box
            bool sniper = d.zoomFov > 0 && d.zoomFov < 30;
            string stand = d.slot == Slot.Pistol ? "usp" : d.slot == Slot.Primary ? (sniper ? "awp" : "ak") : null;
            if (stand != null) prefab = Resources.Load<GameObject>("Weapons/" + stand);
        }
        GameObject go;
        if (prefab != null) go = Object.Instantiate(prefab);
        else go = Placeholder(d);
        foreach (var c in go.GetComponentsInChildren<Collider>()) Object.Destroy(c);
        foreach (var r in go.GetComponentsInChildren<Renderer>())
            r.shadowCastingMode = firstPerson ? UnityEngine.Rendering.ShadowCastingMode.Off : UnityEngine.Rendering.ShadowCastingMode.On;
        WeaponRig.Ensure(go, d);       // hand markers (GripR / GripL / Muzzle): baked on prepared prefabs, defaults on placeholders
        return go;
    }

    static GameObject Box(Transform parent, Vector3 pos, Vector3 size, Color c, float metal = 0.6f)
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
        g.transform.SetParent(parent, false);
        g.transform.localPosition = pos; g.transform.localScale = size;
        g.GetComponent<Renderer>().sharedMaterial = Mats.Lit(c, 0.45f, metal);
        return g;
    }

    static GameObject Placeholder(WeaponDef d)
    {
        var root = new GameObject(d.key);
        Color steel = new Color(0.13f, 0.13f, 0.14f), wood = new Color(0.36f, 0.2f, 0.09f);
        switch (d.slot)
        {
            case Slot.Knife:
                Box(root.transform, new Vector3(0, 0, 0.1f), new Vector3(0.012f, 0.035f, 0.2f), new Color(0.7f, 0.7f, 0.72f), 0.9f);
                Box(root.transform, new Vector3(0, 0, -0.06f), new Vector3(0.025f, 0.03f, 0.11f), steel, 0.1f);
                break;
            case Slot.Pistol:
                Box(root.transform, new Vector3(0, 0.02f, 0.06f), new Vector3(0.03f, 0.035f, 0.2f), steel);
                Box(root.transform, new Vector3(0, -0.05f, -0.02f), new Vector3(0.028f, 0.11f, 0.04f), steel, 0.1f);
                break;
            case Slot.Grenade:
                var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                s.transform.SetParent(root.transform, false); s.transform.localScale = Vector3.one * 0.075f;
                s.GetComponent<Renderer>().sharedMaterial = Mats.Lit(new Color(0.2f, 0.27f, 0.16f));
                break;
            default:
                bool sniper = d.zoomFov > 0 && d.zoomFov < 30;
                float len = sniper ? 1.05f : 0.75f;
                Box(root.transform, new Vector3(0, 0.02f, len * 0.5f - 0.2f), new Vector3(0.035f, 0.05f, len), steel);
                Box(root.transform, new Vector3(0, -0.06f, -0.08f), new Vector3(0.03f, 0.12f, 0.04f), steel, 0.1f);
                Box(root.transform, new Vector3(0, -0.01f, -0.28f), new Vector3(0.035f, 0.09f, 0.26f), d.key == "ak" ? wood : steel, 0.1f);
                Box(root.transform, new Vector3(0, -0.09f, 0.08f), new Vector3(0.025f, 0.16f, 0.05f), steel, 0.3f);
                if (d.zoomFov > 0) Box(root.transform, new Vector3(0, 0.075f, 0.05f), new Vector3(0.035f, 0.035f, 0.26f), steel);
                break;
        }
        return root;
    }
}

/// Third-person body of a fighter. The real work is in CharBody (Assets/Scripts/Anim); this wrapper feeds it from the Player
/// and keeps the old capsule placeholder for characters whose prefab is missing.
public class CharView : MonoBehaviour
{
    Player p;
    CharBody body;
    GameObject model, weapon;
    Transform hand;
    bool alive = true;
    float fall, shotKick, lastY, airT = 9f;
    int weaponId = -1;

    public void Init(Player player) { p = player; Rebuild(); }

    public void Rebuild()
    {
        if (body) Destroy(body.gameObject);
        if (model) Destroy(model);
        body = null; model = null; weapon = null;
        if (p.Team.Value == 0) return;
        string key = (p.Team.Value == 1 ? "t" : "ct") + (1 + Mathf.Abs(p.Skin.Value) % 2);
        body = CharBody.Create(transform, key);
        if (body != null)
        {
            body.SetWeapon(weaponId < 0 ? 0 : weaponId, true);
            if (!alive) body.Die();
        }
        else
        {
            model = Placeholder(p.Team.Value == 1 ? new Color(0.45f, 0.33f, 0.2f) : new Color(0.16f, 0.22f, 0.32f));
            int w = weaponId; weaponId = -1; SetWeapon(w < 0 ? 0 : w);
        }
        ApplyVisibility();
    }

    GameObject Placeholder(Color c)
    {
        var root = new GameObject("Placeholder");
        root.transform.SetParent(transform, false);
        var b = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        b.transform.SetParent(root.transform, false);
        b.transform.localPosition = new Vector3(0, 0.75f, 0); b.transform.localScale = new Vector3(0.52f, 0.75f, 0.34f);
        b.GetComponent<Renderer>().sharedMaterial = Mats.Lit(c);
        var h = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        h.transform.SetParent(root.transform, false);
        h.transform.localPosition = new Vector3(0, 1.62f, 0); h.transform.localScale = Vector3.one * 0.25f;
        h.GetComponent<Renderer>().sharedMaterial = Mats.Lit(p.Team.Value == 1 ? new Color(0.1f, 0.1f, 0.1f) : new Color(0.2f, 0.24f, 0.2f));
        var hd = new GameObject("Hand").transform;
        hd.SetParent(root.transform, false); hd.localPosition = new Vector3(0.2f, 1.28f, 0.3f);
        hand = hd;
        foreach (var col in root.GetComponentsInChildren<Collider>()) Destroy(col);
        return root;
    }

    void ApplyVisibility()
    {
        bool hideForOwner = p.IsHumanOwner && alive;
        if (body) { body.shadowsOnly = hideForOwner; body.ApplyVisibility(); }
        if (model)
            foreach (var r in model.GetComponentsInChildren<Renderer>(true))
                r.shadowCastingMode = hideForOwner ? UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly : UnityEngine.Rendering.ShadowCastingMode.On;
    }

    public void SetAlive(bool a)
    {
        if (alive == a) { ApplyVisibility(); return; }
        alive = a;
        if (body) { if (a) body.Revive(); else { body.crouch = p.crouch; body.Die(); } }
        if (a) { fall = 0; transform.localRotation = Quaternion.identity; transform.localPosition = Vector3.zero; }
        ApplyVisibility();
    }

    public void SetWeapon(int id)
    {
        if (body) { weaponId = id; body.SetWeapon(id); return; }
        if (id == weaponId || model == null) { weaponId = id; return; }
        weaponId = id;
        if (weapon) Destroy(weapon);
        weapon = WeaponModels.Create(id, false);
        weapon.transform.SetParent(hand != null ? hand : model.transform, false);
        ApplyVisibility();
    }

    public void OnShot() { shotKick = 1f; if (body) body.Shot(); }
    public void OnReload(float duration) { if (body) body.Reload(duration); }

    public void Tick(float speed, float pitch, bool crouch)
    {
        if (body)
        {
            float y = transform.position.y, vy = (y - lastY) / Mathf.Max(Time.deltaTime, 1e-4f); lastY = y;
            airT = Mathf.Abs(vy) > 3f && Mathf.Abs(vy) < 30f ? 0f : airT + Time.deltaTime;
            body.speed = speed; body.pitch = pitch; body.crouch = crouch; body.airborne = alive && airT < 0.22f;
            return;
        }
        if (model == null) return;
        if (!alive)
        {
            fall = Mathf.MoveTowards(fall, 1f, Time.deltaTime * 2.8f);
            float e = 1f - (1f - fall) * (1f - fall);
            transform.localRotation = Quaternion.Euler(-88f * e, 0, 0);
            transform.localPosition = new Vector3(0, 0.18f * e, 0);
            return;
        }
        shotKick = Mathf.MoveTowards(shotKick, 0, Time.deltaTime * 8f);
        model.transform.localScale = new Vector3(1, crouch ? 0.68f : 1f, 1);
        if (weapon != null) weapon.transform.rotation = Quaternion.Euler(p.NetLook.Value.y - shotKick * 4f, p.NetLook.Value.x, 0);
    }
}

/// Simple effects: tracers, flashes, impacts, blood, explosions and recorded sounds.
public static class Fx
{
    static readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
    static Material tracerMat, flashMat, sparkMat, bloodMat, holeMat, smokeMat;

    static void Init()
    {
        if (tracerMat != null) return;
        tracerMat = Mats.Unlit(new Color(1f, 0.85f, 0.5f, 0.55f));
        flashMat = Mats.Unlit(new Color(1f, 0.75f, 0.35f, 0.9f));
        sparkMat = Mats.Unlit(new Color(0.85f, 0.78f, 0.62f, 0.7f));
        smokeMat = Mats.Unlit(new Color(0.35f, 0.33f, 0.3f, 0.5f));
        bloodMat = Mats.Lit(new Color(0.42f, 0.02f, 0.02f), 0.6f);
        holeMat = Mats.Lit(new Color(0.05f, 0.05f, 0.05f), 0f);
    }

    public static void Shot(Vector3 from, Vector3 to, int weaponId, bool flesh, bool firstPerson)
    {
        Init();
        var d = Weapons.Get(weaponId);
        if (d.slot == Slot.Knife) { Sound("knife", from, 0.6f); return; }
        var go = new GameObject("tracer");
        var lr = go.AddComponent<LineRenderer>();
        lr.sharedMaterial = tracerMat; lr.positionCount = 2;
        Vector3 start = firstPerson && Camera.main ? Camera.main.transform.TransformPoint(0.17f, -0.14f, 0.9f) : from;
        lr.SetPosition(0, start); lr.SetPosition(1, to);
        lr.startWidth = 0.012f; lr.endWidth = 0.004f;
        lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        Object.Destroy(go, 0.045f);

        var f = GameObject.CreatePrimitive(PrimitiveType.Quad);
        Object.Destroy(f.GetComponent<Collider>());
        f.transform.position = start;
        if (Camera.main) f.transform.rotation = Camera.main.transform.rotation * Quaternion.Euler(0, 0, Random.Range(0, 360));
        f.transform.localScale = Vector3.one * (firstPerson ? 0.16f : 0.28f);
        f.GetComponent<Renderer>().sharedMaterial = flashMat;
        var l = f.AddComponent<Light>(); l.color = new Color(1f, 0.75f, 0.4f); l.range = 7f; l.intensity = 2.5f;
        Object.Destroy(f, 0.04f);

        string clip = ShotSound(d);
        Sound(clip, from, 1f, 60f);
    }

    public static void Impact(Vector3 p, Vector3 n)
    {
        Init();
        var h = GameObject.CreatePrimitive(PrimitiveType.Quad);
        Object.Destroy(h.GetComponent<Collider>());
        h.transform.position = p + n * 0.005f; h.transform.rotation = Quaternion.LookRotation(-n);
        h.transform.localScale = Vector3.one * 0.05f;
        var r = h.GetComponent<Renderer>(); r.sharedMaterial = holeMat; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        Object.Destroy(h, 12f);
        Burst(p + n * 0.03f, n, sparkMat, 7, 2.2f, 0.035f, 0.35f);
        Sound("stone", p, 0.5f, 22f);
        if (Random.value < 0.3f) Sound("ricochet", p, 0.45f, 30f);
    }

    public static void Blood(Vector3 p, Vector3 n)
    {
        Init();
        Burst(p + n * 0.03f, n, bloodMat, 8, 2.0f, 0.03f, 0.45f);
        Sound("flesh", p, 0.5f, 20f);
    }

    public static void Explosion(Vector3 p)
    {
        Init();
        Burst(p + Vector3.up * 0.3f, Vector3.up, flashMat, 26, 9f, 0.35f, 0.4f);
        Burst(p + Vector3.up * 0.3f, Vector3.up, smokeMat, 22, 3.5f, 0.6f, 1.8f);
        var g = new GameObject("boomlight"); g.transform.position = p + Vector3.up;
        var l = g.AddComponent<Light>(); l.color = new Color(1f, 0.7f, 0.35f); l.range = 22f; l.intensity = 8f;
        Object.Destroy(g, 0.12f);
        Sound("explosion", p, 1f, 120f);
    }

    static void Burst(Vector3 p, Vector3 n, Material m, int count, float speed, float size, float life)
    {
        var go = new GameObject("burst"); go.transform.position = p; go.transform.rotation = Quaternion.LookRotation(n);
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main; main.loop = false; main.playOnAwake = false; main.duration = 0.2f;
        main.startLifetime = new ParticleSystem.MinMaxCurve(life * 0.5f, life);
        main.startSpeed = new ParticleSystem.MinMaxCurve(speed * 0.3f, speed);
        main.startSize = new ParticleSystem.MinMaxCurve(size * 0.5f, size); main.gravityModifier = m == smokeMat ? -0.05f : 1f;
        main.simulationSpace = ParticleSystemSimulationSpace.World;
        var em = ps.emission; em.enabled = false;
        var sh = ps.shape; sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 50f; sh.radius = 0.02f;
        var sol = ps.sizeOverLifetime; sol.enabled = true; sol.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0, 1, 1, m == smokeMat ? 2.5f : 0.2f));
        var r = go.GetComponent<ParticleSystemRenderer>(); r.sharedMaterial = m; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        ps.Emit(count);
        Object.Destroy(go, life + 0.3f);
    }

    public static void Sound(string name, Vector3 pos, float vol, float maxDist = 30f)
    {
        var clip = Clip(name);
        if (clip == null || AudioListener.pause) return;
        var go = new GameObject("snd"); go.transform.position = pos;
        var a = go.AddComponent<AudioSource>();
        a.clip = clip; a.volume = vol; a.spatialBlend = 1f; a.rolloffMode = AudioRolloffMode.Linear;
        a.minDistance = 2f; a.maxDistance = maxDist; a.pitch = Random.Range(0.94f, 1.06f); a.dopplerLevel = 0;
        a.Play();
        Object.Destroy(go, clip.length + 0.1f);
    }

    public static void Sound2D(string name, float vol)
    {
        var clip = Clip(name);
        if (clip == null || Camera.main == null) return;
        AudioSource.PlayClipAtPoint(clip, Camera.main.transform.position, vol);
    }

    static readonly Dictionary<string, AudioClip[]> variants = new Dictionary<string, AudioClip[]>();
    static readonly Dictionary<string, string> alias = new Dictionary<string, string>
    {
        { "flesh", "hit_flesh" }, { "knife", "knife_swing" }, { "rifle", "rifle_ak" }, { "stone", "hit_stone" },
    };

    /// Picks one of the recorded variants of a sound (name_1, name_2, ...) at random. Only real recordings from
    /// Resources/Sounds are used; a missing sound simply stays silent.
    static AudioClip Clip(string name)
    {
        if (alias.TryGetValue(name, out var real)) name = real;
        if (!variants.TryGetValue(name, out var arr))
        {
            var list = new List<AudioClip>();
            for (int i = 1; i <= 8; i++)
            {
                var v = Resources.Load<AudioClip>("Sounds/" + name + "_" + i);
                if (v == null) break;
                list.Add(v);
            }
            if (list.Count == 0) { var one = Resources.Load<AudioClip>("Sounds/" + name); if (one != null) list.Add(one); }
            arr = list.ToArray(); variants[name] = arr;
        }
        return arr.Length == 0 ? null : arr[Random.Range(0, arr.Length)];
    }

    /// Recorded gunshot family for a weapon.
    public static string ShotSound(WeaponDef d)
    {
        switch (d.key)
        {
            case "deagle": return "pistol_heavy";
            case "mac10": case "mp9": case "mp5": case "ump": case "p90": return "smg";
            case "m4": case "famas": case "aug": return "rifle_m4";
            case "m249": return "lmg";
            case "m3": case "xm1014": return "shotgun";
            case "scout": case "awp": case "g3": return "sniper";
        }
        return d.slot == Slot.Pistol ? "pistol" : "rifle_ak";
    }
}
