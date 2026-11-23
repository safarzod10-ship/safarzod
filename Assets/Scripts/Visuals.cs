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
        GameObject go;
        if (prefab != null) go = Object.Instantiate(prefab);
        else go = Placeholder(d);
        foreach (var c in go.GetComponentsInChildren<Collider>()) Object.Destroy(c);
        foreach (var r in go.GetComponentsInChildren<Renderer>())
            r.shadowCastingMode = firstPerson ? UnityEngine.Rendering.ShadowCastingMode.Off : UnityEngine.Rendering.ShadowCastingMode.On;
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

/// Third-person body of a fighter: character model, weapon in hands, death pose.
public class CharView : MonoBehaviour
{
    Player p;
    GameObject model, weapon;
    Animator anim;
    Transform hand, spine;
    bool alive = true, built;
    float fall, shotKick;
    int weaponId = -1;

    public void Init(Player player) { p = player; Rebuild(); }

    public void Rebuild()
    {
        if (model) Destroy(model);
        built = false;
        if (p.Team.Value == 0) return;
        string key = (p.Team.Value == 1 ? "t" : "ct") + (1 + Mathf.Abs(p.Skin.Value) % 2);
        var prefab = Resources.Load<GameObject>("Chars/" + key);
        if (prefab != null)
        {
            model = Instantiate(prefab, transform);
            anim = model.GetComponentInChildren<Animator>();
            if (anim != null && anim.isHuman)
            {
                hand = anim.GetBoneTransform(HumanBodyBones.RightHand);
                spine = anim.GetBoneTransform(HumanBodyBones.Chest) ?? anim.GetBoneTransform(HumanBodyBones.Spine);
            }
        }
        else model = Placeholder(p.Team.Value == 1 ? new Color(0.45f, 0.33f, 0.2f) : new Color(0.16f, 0.22f, 0.32f));
        foreach (var c in model.GetComponentsInChildren<Collider>()) Destroy(c);
        built = true;
        int w = weaponId; weaponId = -1; SetWeapon(w < 0 ? 0 : w);
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
        return root;
    }

    void ApplyVisibility()
    {
        if (!built) return;
        bool hideForOwner = p.IsHumanOwner && alive;
        foreach (var r in model.GetComponentsInChildren<Renderer>(true))
            r.shadowCastingMode = hideForOwner ? UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly : UnityEngine.Rendering.ShadowCastingMode.On;
    }

    public void SetAlive(bool a)
    {
        alive = a;
        if (a) { fall = 0; transform.localRotation = Quaternion.identity; transform.localPosition = Vector3.zero; }
        if (anim) anim.enabled = a;
        ApplyVisibility();
    }

    public void SetWeapon(int id)
    {
        if (id == weaponId || !built) { weaponId = id; return; }
        weaponId = id;
        if (weapon) Destroy(weapon);
        weapon = WeaponModels.Create(id, false);
        if (anim != null && anim.isHuman && hand != null)
        {
            weapon.transform.SetParent(hand, false);
            weapon.transform.localScale = Vector3.one / Mathf.Max(0.0001f, hand.lossyScale.x);
        }
        else
        {
            weapon.transform.SetParent(hand != null ? hand : model.transform, false);
        }
        ApplyVisibility();
    }

    public void OnShot() { shotKick = 1f; }

    public void Tick(float speed, float pitch, bool crouch)
    {
        if (!built) return;
        if (!alive)
        {
            fall = Mathf.MoveTowards(fall, 1f, Time.deltaTime * 2.8f);
            float e = 1f - (1f - fall) * (1f - fall);
            transform.localRotation = Quaternion.Euler(-88f * e, 0, 0);
            transform.localPosition = new Vector3(0, 0.18f * e, 0);
            return;
        }
        shotKick = Mathf.MoveTowards(shotKick, 0, Time.deltaTime * 8f);
        if (anim != null && anim.runtimeAnimatorController != null)
        {
            anim.SetFloat("Speed", speed, 0.1f, Time.deltaTime);
            anim.SetBool("Crouch", crouch);
        }
        else
        {
            model.transform.localScale = new Vector3(1, crouch ? 0.68f : 1f, 1);
        }
    }

    void LateUpdate()
    {
        if (!built || !alive || p == null) return;
        if (anim != null && anim.isHuman)
        {
            if (spine != null) spine.rotation = Quaternion.AngleAxis(p.NetLook.Value.y * 0.6f, transform.right) * spine.rotation;
            if (weapon != null && hand != null)
            {
                // keep the gun pointing where the fighter looks, gripped in the right hand
                weapon.transform.rotation = Quaternion.Euler(p.NetLook.Value.y - shotKick * 4f, p.NetLook.Value.x, 0);
                weapon.transform.position = hand.position + weapon.transform.forward * 0.05f;
            }
        }
        else if (weapon != null)
        {
            weapon.transform.rotation = Quaternion.Euler(p.NetLook.Value.y - shotKick * 4f, p.NetLook.Value.x, 0);
        }
    }
}

/// Pooled-free simple effects: tracers, flashes, impacts, blood, explosions and synthesized sounds.
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

        string clip = d.zoomFov > 0 && d.zoomFov < 30 ? "sniper" : d.slot == Slot.Pistol ? "pistol" : d.pellets > 1 ? "shotgun" : "rifle";
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
        if (Random.value < 0.35f) Sound("ricochet", p, 0.35f, 25f);
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

    static AudioClip Clip(string name)
    {
        if (clips.TryGetValue(name, out var c)) return c;
        c = Resources.Load<AudioClip>("Sounds/" + name);
        if (c == null) c = Synth(name);
        clips[name] = c; return c;
    }

    // Fallback sounds generated in code, used until recorded sounds are placed in Resources/Sounds.
    static AudioClip Synth(string name)
    {
        const int sr = 22050;
        float len = 0.3f, decay = 18f, tone = 0, noise = 1f, lowpass = 0.5f;
        switch (name)
        {
            case "pistol": len = 0.28f; decay = 22f; lowpass = 0.55f; break;
            case "rifle": len = 0.34f; decay = 17f; lowpass = 0.42f; break;
            case "shotgun": len = 0.5f; decay = 11f; lowpass = 0.3f; break;
            case "sniper": len = 0.75f; decay = 7f; lowpass = 0.25f; break;
            case "explosion": len = 1.4f; decay = 3.5f; lowpass = 0.08f; break;
            case "step": len = 0.09f; decay = 50f; lowpass = 0.12f; break;
            case "flesh": len = 0.08f; decay = 45f; lowpass = 0.2f; break;
            case "knife": len = 0.14f; decay = 25f; lowpass = 0.8f; break;
            case "ricochet": len = 0.2f; decay = 14f; tone = 2600f; noise = 0.15f; break;
            case "reload": len = 0.12f; decay = 40f; tone = 900f; noise = 0.6f; lowpass = 0.7f; break;
            case "click": len = 0.04f; decay = 90f; tone = 1800f; noise = 0.5f; lowpass = 0.9f; break;
            case "beep": len = 0.09f; decay = 6f; tone = 2100f; noise = 0f; break;
            case "plant": len = 0.3f; decay = 5f; tone = 1200f; noise = 0f; break;
            default: return null;
        }
        int n = (int)(sr * len);
        var data = new float[n];
        float lp = 0; var rng = new System.Random(name.GetHashCode());
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)sr;
            float env = Mathf.Exp(-decay * t);
            float w = (float)(rng.NextDouble() * 2 - 1) * noise;
            lp += (w - lp) * lowpass;
            float s = lp * (noise > 0 ? 1.6f : 0f);
            if (tone > 0) s += Mathf.Sin(2 * Mathf.PI * tone * t * (name == "ricochet" ? 1f - t * 1.5f : 1f)) * 0.6f;
            data[i] = Mathf.Clamp(s * env, -1f, 1f);
        }
        var clip = AudioClip.Create(name, n, 1, sr, false);
        clip.SetData(data, 0);
        return clip;
    }
}
