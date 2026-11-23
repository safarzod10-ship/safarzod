using System.Collections.Generic;
using UnityEngine;

/// Builds the "Bazaar" map in code from a fixed seed, so every device gets the same level.
[DefaultExecutionOrder(-200)]
public class MapBuilder : MonoBehaviour
{
    const float C = 0.6f;                 // grid cell, metres (10 px of the plan)
    const int GW = 150, GH = 110, Pad = 8;
    bool[,] walk;
    System.Random rng;
    Transform root;
    readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();

    // plan rectangles in plan pixels: x, y, w, h
    static readonly int[,] Walk =
    {
        {560,900,380,120},{560,80,380,110},{650,300,200,480},{100,330,330,300},{1070,330,330,300},
        {430,430,220,90},{850,430,220,90},{200,630,110,250},{200,880,360,90},{1190,630,110,250},
        {940,880,360,90},{200,130,110,200},{200,100,360,80},{1190,130,110,200},{940,100,360,80},
        {700,190,100,110},{700,780,100,120},
    };

    static Vector3 P(float px, float py, float y = 0) => new Vector3((px - 750f) * 0.06f, y, (550f - py) * 0.06f);

    void Awake()
    {
        rng = new System.Random(20261123);
        root = new GameObject("Map").transform;
        Lighting();
        Grid();
        Ground();
        Buildings();
        Bazaar();
        SiteA();
        SiteB();
        Streets();
        Gameplay();
    }

    float R(float a, float b) => a + (float)rng.NextDouble() * (b - a);

    // ---------------------------------------------------------------- materials
    Material Mat(string key, Color baseCol, float contrast, float scale, float smooth = 0.08f, int style = 0)
    {
        if (mats.TryGetValue(key, out var m)) return m;
        m = new Material(Tpl.Lit); m.SetColor("_BaseColor", Color.white);
        var tex = Resources.Load<Texture2D>("Textures/" + key);
        if (tex == null) tex = MakeTex(baseCol, contrast, style, key.GetHashCode());
        else m.color = Color.white;
        m.mainTexture = tex; m.SetTexture("_BaseMap", tex);
        var nrm = Resources.Load<Texture2D>("Textures/" + key + "_n");
        if (nrm != null) { m.SetTexture("_BumpMap", nrm); m.EnableKeyword("_NORMALMAP"); }
        m.SetFloat("_Smoothness", smooth);
        m.mainTextureScale = Vector2.one / scale; m.SetTextureScale("_BaseMap", Vector2.one / scale);
        m.enableInstancing = true;
        mats[key] = m; return m;
    }

    static Texture2D MakeTex(Color c, float contrast, int style, int seed)
    {
        const int N = 256;
        var t = new Texture2D(N, N, TextureFormat.RGB24, true) { wrapMode = TextureWrapMode.Repeat, anisoLevel = 4 };
        var px = new Color[N * N];
        float ox = (seed & 255) * 1.37f, oy = ((seed >> 8) & 255) * 2.11f;
        for (int y = 0; y < N; y++)
            for (int x = 0; x < N; x++)
            {
                float u = x / (float)N, v = y / (float)N;
                float n = 0, amp = 0.5f, f = 4f;
                for (int o = 0; o < 4; o++)
                {   // tileable value noise
                    float a = Mathf.PerlinNoise(ox + u * f, oy + v * f), b = Mathf.PerlinNoise(ox + (u - 1) * f, oy + v * f);
                    float cc = Mathf.PerlinNoise(ox + u * f, oy + (v - 1) * f), dd = Mathf.PerlinNoise(ox + (u - 1) * f, oy + (v - 1) * f);
                    n += amp * Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(cc, dd, u), v);
                    amp *= 0.5f; f *= 2f;
                }
                float k = 1f + (n - 0.47f) * contrast * 2f;
                if (style == 1)
                {   // bricks
                    float row = v * 12f; float col = u * 6f + (Mathf.FloorToInt(row) % 2) * 0.5f;
                    float my = Mathf.Abs(row - Mathf.Floor(row) - 0.5f), mx = Mathf.Abs(col - Mathf.Floor(col) - 0.5f);
                    if (my > 0.42f || mx > 0.46f) k *= 0.62f; else k *= 0.9f + 0.2f * Mathf.PerlinNoise(Mathf.Floor(col) * 3.1f, Mathf.Floor(row) * 1.7f);
                }
                else if (style == 2)
                {   // planks
                    float col = u * 8f; float mx = Mathf.Abs(col - Mathf.Floor(col) - 0.5f);
                    k *= 0.85f + 0.3f * Mathf.PerlinNoise(Mathf.Floor(col) * 5.3f, v * 30f);
                    if (mx > 0.46f) k *= 0.5f;
                }
                else if (style == 3)
                {   // paving tiles
                    float mx = Mathf.Abs(u * 4f - Mathf.Floor(u * 4f) - 0.5f), my = Mathf.Abs(v * 4f - Mathf.Floor(v * 4f) - 0.5f);
                    if (mx > 0.47f || my > 0.47f) k *= 0.6f;
                }
                else if (style == 4)
                {   // carpet ornament
                    float cx = Mathf.Abs(u - 0.5f), cy = Mathf.Abs(v - 0.5f);
                    float d = Mathf.Max(cx, cy);
                    float band = Mathf.Sin(d * 60f) * 0.5f + 0.5f, dia = Mathf.Sin((cx + cy) * 50f) * 0.5f + 0.5f;
                    Color o2 = d > 0.44f ? new Color(0.1f, 0.08f, 0.2f) : band > 0.7f ? new Color(0.9f, 0.8f, 0.55f) : dia > 0.75f ? new Color(0.1f, 0.15f, 0.35f) : c;
                    px[y * N + x] = o2 * (0.85f + n * 0.3f); continue;
                }
                else if (style == 5)
                {   // striped cloth
                    k *= (Mathf.FloorToInt(u * 8f) % 2 == 0) ? 1f : 1.9f;
                }
                px[y * N + x] = new Color(Mathf.Clamp01(c.r * k), Mathf.Clamp01(c.g * k), Mathf.Clamp01(c.b * k));
            }
        t.SetPixels(px); t.Apply(true);
        return t;
    }

    Material Mud => Mat("mud", new Color(0.66f, 0.53f, 0.38f), 0.35f, 3f);
    Material Mud2 => Mat("mud2", new Color(0.58f, 0.44f, 0.3f), 0.4f, 3f);
    Material White => Mat("whitewash", new Color(0.86f, 0.83f, 0.76f), 0.2f, 3f);
    Material Brick => Mat("brick", new Color(0.62f, 0.36f, 0.24f), 0.25f, 2.4f, 0.05f, 1);
    Material Wood => Mat("wood", new Color(0.38f, 0.24f, 0.13f), 0.3f, 1.6f, 0.15f, 2);
    Material BlueWood => Mat("bluewood", new Color(0.1f, 0.42f, 0.5f), 0.3f, 1.6f, 0.2f, 2);
    Material Dirt => Mat("dirt", new Color(0.5f, 0.42f, 0.32f), 0.35f, 4f);
    Material Paving => Mat("paving", new Color(0.55f, 0.52f, 0.48f), 0.25f, 3f, 0.1f, 3);
    Material Concrete => Mat("concrete", new Color(0.5f, 0.5f, 0.5f), 0.25f, 4f);
    Material Glass => Mat("glass", new Color(0.08f, 0.12f, 0.16f), 0.1f, 1f, 0.9f);
    Material Clay => Mat("clay", new Color(0.63f, 0.38f, 0.24f), 0.3f, 1f);
    Material Iron => Mat("iron", new Color(0.1f, 0.1f, 0.1f), 0.2f, 1f, 0.4f);
    Material Melon => Mat("melon", new Color(0.16f, 0.36f, 0.12f), 0.6f, 0.3f, 0.5f, 5);
    Material YellowMelon => Mat("dynya", new Color(0.82f, 0.7f, 0.25f), 0.3f, 0.3f, 0.3f);
    Material Sack => Mat("sack", new Color(0.62f, 0.55f, 0.4f), 0.35f, 0.5f);
    Material Cloth(int i)
    {
        Color[] cs = { new Color(0.6f, 0.12f, 0.1f), new Color(0.1f, 0.3f, 0.55f), new Color(0.15f, 0.42f, 0.2f), new Color(0.75f, 0.5f, 0.1f) };
        return Mat("cloth" + i % 4, cs[i % 4], 0.15f, 2f, 0.05f, 5);
    }
    Material Carpet(int i)
    {
        Color[] cs = { new Color(0.55f, 0.08f, 0.08f), new Color(0.45f, 0.1f, 0.2f), new Color(0.15f, 0.2f, 0.45f) };
        return Mat("carpet" + i % 3, cs[i % 3], 0.2f, 1f, 0.05f, 4);
    }

    // ---------------------------------------------------------------- primitives
    static Mesh BoxMesh(Vector3 s)
    {
        var m = new Mesh();
        Vector3 h = s * 0.5f;
        var v = new List<Vector3>(); var uv = new List<Vector2>(); var n = new List<Vector3>(); var tr = new List<int>();
        void Face(Vector3 o, Vector3 a, Vector3 b, float w, float hh)
        {
            int i = v.Count; Vector3 nn = Vector3.Cross(a, b).normalized;
            v.Add(o); v.Add(o + a); v.Add(o + a + b); v.Add(o + b);
            uv.Add(new Vector2(0, 0)); uv.Add(new Vector2(w, 0)); uv.Add(new Vector2(w, hh)); uv.Add(new Vector2(0, hh));
            for (int k = 0; k < 4; k++) n.Add(-nn);
            tr.AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 });
        }
        Face(new Vector3(-h.x, -h.y, -h.z), new Vector3(s.x, 0, 0), new Vector3(0, s.y, 0), s.x, s.y);
        Face(new Vector3(h.x, -h.y, h.z), new Vector3(-s.x, 0, 0), new Vector3(0, s.y, 0), s.x, s.y);
        Face(new Vector3(-h.x, -h.y, h.z), new Vector3(0, 0, -s.z), new Vector3(0, s.y, 0), s.z, s.y);
        Face(new Vector3(h.x, -h.y, -h.z), new Vector3(0, 0, s.z), new Vector3(0, s.y, 0), s.z, s.y);
        Face(new Vector3(-h.x, h.y, -h.z), new Vector3(s.x, 0, 0), new Vector3(0, 0, s.z), s.x, s.z);
        Face(new Vector3(-h.x, -h.y, h.z), new Vector3(s.x, 0, 0), new Vector3(0, 0, -s.z), s.x, s.z);
        m.SetVertices(v); m.SetUVs(0, uv); m.SetNormals(n); m.SetTriangles(tr, 0); m.RecalculateBounds(); m.RecalculateTangents();
        return m;
    }

    GameObject Box(Vector3 center, Vector3 size, Material mat, bool collide = true, float yaw = 0, Transform parent = null)
    {
        var go = new GameObject("b");
        go.transform.SetParent(parent != null ? parent : root, false);
        go.transform.localPosition = center; go.transform.localRotation = Quaternion.Euler(0, yaw, 0);
        go.AddComponent<MeshFilter>().sharedMesh = BoxMesh(size);
        go.AddComponent<MeshRenderer>().sharedMaterial = mat;
        if (collide) go.AddComponent<BoxCollider>().size = size;
        go.isStatic = true;
        return go;
    }

    GameObject Prim(PrimitiveType type, Vector3 pos, Vector3 scale, Material mat, bool collide = true, Transform parent = null)
    {
        var go = GameObject.CreatePrimitive(type);
        go.transform.SetParent(parent != null ? parent : root, false);
        go.transform.localPosition = pos; go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
        if (!collide) Destroy(go.GetComponent<Collider>());
        return go;
    }

    /// Places a downloaded model from Resources/Props (scaled so its longest side is `size` metres); returns false if absent.
    bool Prop(string key, Vector3 pos, float yaw, float size, bool collide = true)
    {
        var prefab = Resources.Load<GameObject>("Props/" + key);
        if (prefab == null) return false;
        var holder = new GameObject(key); holder.transform.SetParent(root, false);
        var go = Instantiate(prefab, holder.transform);
        var rs = go.GetComponentsInChildren<Renderer>();
        if (rs.Length == 0) { Destroy(holder); return false; }
        Bounds b = rs[0].bounds; foreach (var r in rs) b.Encapsulate(r.bounds);
        float k = size / Mathf.Max(b.size.x, b.size.y, b.size.z, 0.001f);
        go.transform.localScale *= k;
        b = rs[0].bounds; foreach (var r in rs) b.Encapsulate(r.bounds);
        go.transform.position -= new Vector3(b.center.x, b.min.y, b.center.z);
        holder.transform.position = pos; holder.transform.rotation = Quaternion.Euler(0, yaw, 0);
        if (collide)
        {
            var bc = holder.AddComponent<BoxCollider>();
            bc.center = new Vector3(0, b.size.y * 0.5f, 0); bc.size = b.size;
        }
        return true;
    }

    // ---------------------------------------------------------------- level
    void Lighting()
    {
        var sun = new GameObject("Sun").AddComponent<Light>();
        sun.type = LightType.Directional; sun.color = new Color(1f, 0.93f, 0.8f); sun.intensity = 1.5f;
        sun.shadows = LightShadows.Soft; sun.shadowStrength = 0.85f;
        sun.transform.rotation = Quaternion.Euler(48f, 215f, 0);
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.55f, 0.63f, 0.75f);
        RenderSettings.ambientEquatorColor = new Color(0.5f, 0.46f, 0.4f);
        RenderSettings.ambientGroundColor = new Color(0.3f, 0.25f, 0.2f);
        RenderSettings.fog = true; RenderSettings.fogMode = FogMode.Linear; RenderSettings.fogColor = new Color(0.72f, 0.76f, 0.8f);
        RenderSettings.fogStartDistance = 60f; RenderSettings.fogEndDistance = 260f;
        var sky = new Material(Tpl.Sky);
        sky.SetFloat("_SunSize", 0.035f); sky.SetFloat("_AtmosphereThickness", 0.9f); sky.SetFloat("_Exposure", 1.15f);
        sky.SetColor("_GroundColor", new Color(0.55f, 0.5f, 0.42f));
        RenderSettings.skybox = sky; RenderSettings.sun = sun;
        // distant mountains
        var rock = Mat("rock", new Color(0.42f, 0.44f, 0.5f), 0.3f, 30f);
        var snow = Mat("snow", new Color(0.9f, 0.92f, 0.95f), 0.1f, 30f);
        for (int i = 0; i < 14; i++)
        {
            float a = i / 14f * Mathf.PI * 2f + R(-0.1f, 0.1f); float d = R(170f, 230f), h = R(45f, 95f);
            var pos = new Vector3(Mathf.Cos(a) * d, -5f, Mathf.Sin(a) * d);
            var m = Prim(PrimitiveType.Sphere, pos, new Vector3(R(90f, 150f), h * 2f, R(90f, 150f)), rock, false);
            m.transform.rotation = Quaternion.Euler(0, R(0, 180), 0);
            if (h > 65f) Prim(PrimitiveType.Sphere, pos + Vector3.up * h * 0.62f, new Vector3(h * 0.55f, h * 0.8f, h * 0.55f), snow, false);
        }
    }

    void Grid()
    {
        walk = new bool[GW + Pad * 2, GH + Pad * 2];
        for (int r = 0; r < Walk.GetLength(0); r++)
            for (int x = Walk[r, 0] / 10; x < (Walk[r, 0] + Walk[r, 2]) / 10; x++)
                for (int y = Walk[r, 1] / 10; y < (Walk[r, 1] + Walk[r, 3]) / 10; y++)
                    walk[x + Pad, y + Pad] = true;
    }

    bool W(int x, int y) => x >= 0 && y >= 0 && x < walk.GetLength(0) && y < walk.GetLength(1) && walk[x, y];
    Vector3 CellPos(float gx, float gy, float y = 0) => P((gx - Pad) * 10f, (gy - Pad) * 10f, y);

    void Ground()
    {
        Box(new Vector3(0, -0.5f, 0), new Vector3(130, 1, 110), Dirt);
        Flat(650, 300, 200, 480, Paving);            // bazaar lane
        Flat(1070, 330, 330, 300, Mat("yard", new Color(0.6f, 0.5f, 0.4f), 0.25f, 2.5f, 0.08f, 1));
        Flat(100, 330, 330, 300, Concrete);
        Flat(560, 80, 380, 110, Mat("asphalt", new Color(0.2f, 0.2f, 0.21f), 0.25f, 4f));
        Flat(200, 100, 360, 80, Mat("asphalt", Color.gray, 0, 4f)); Flat(940, 100, 360, 80, Mat("asphalt", Color.gray, 0, 4f));
    }

    void Flat(float px, float py, float w, float h, Material m)
    {
        Box(P(px + w / 2, py + h / 2, 0.01f), new Vector3(w * 0.06f, 0.02f, h * 0.06f), m, false);
    }

    void Buildings()
    {
        int w = walk.GetLength(0), h = walk.GetLength(1);
        var used = new bool[w, h];
        Material[] wallMats = { Mud, Mud, Mud2, White, White, Brick };
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                if (walk[x, y] || used[x, y]) continue;
                int maxW = rng.Next(8, 18), maxH = rng.Next(8, 18);
                int bw = 0; while (x + bw < w && bw < maxW && !walk[x + bw, y] && !used[x + bw, y]) bw++;
                int bh = 1; bool ok = true;
                while (ok && y + bh < h && bh < maxH)
                {
                    for (int i = 0; i < bw; i++) if (walk[x + i, y + bh] || used[x + i, y + bh]) { ok = false; break; }
                    if (ok) bh++;
                }
                for (int i = 0; i < bw; i++) for (int j = 0; j < bh; j++) used[x + i, y + j] = true;
                // skip blocks that touch no walkable cell and are far outside (keeps the count low)
                bool near = false;
                for (int i = -3; i <= bw + 2 && !near; i++) for (int j = -3; j <= bh + 2; j++) if (W(x + i, y + j)) { near = true; break; }
                if (!near) continue;
                float height = R(3.6f, 7.2f);
                var mat = wallMats[rng.Next(wallMats.Length)];
                Vector3 c = CellPos(x + bw / 2f, y + bh / 2f, height / 2f);
                Vector3 size = new Vector3(bw * C, height, bh * C);
                Box(c, size, mat);
                // flat roof parapet
                Box(c + Vector3.up * (height / 2f + 0.12f), new Vector3(size.x + 0.16f, 0.24f, size.z + 0.16f), mat == White ? Mud : mat, false);
                Decorate(x, y, bw, bh, height);
            }
    }

    void Decorate(int x, int y, int bw, int bh, float height)
    {
        // sides: 0 = -gy (north in world +z), 1 = +gy, 2 = -gx, 3 = +gx
        for (int side = 0; side < 4; side++)
        {
            bool alongX = side < 2; int len = alongX ? bw : bh;
            bool door = false;
            for (int i = 1; i < len - 1; i += 4)
            {
                int cx = alongX ? x + i : (side == 2 ? x - 1 : x + bw);
                int cy = alongX ? (side == 0 ? y - 1 : y + bh) : y + i;
                if (!W(cx, cy) || !W(alongX ? cx + 1 : cx, alongX ? cy : cy + 1)) continue;
                float gx = alongX ? x + i + 1f : (side == 2 ? x : x + bw);
                float gy = alongX ? (side == 0 ? y : y + bh) : y + i + 1f;
                Vector3 n = alongX ? new Vector3(0, 0, side == 0 ? 1 : -1) : new Vector3(side == 2 ? -1 : 1, 0, 0);
                Vector3 p = CellPos(gx, gy) + n * 0.03f;
                float yaw = alongX ? 0 : 90;
                double roll = rng.NextDouble();
                if (!door && roll < 0.3)
                {
                    door = true;
                    Box(p + Vector3.up * 1.05f, new Vector3(1.15f, 2.1f, 0.1f), roll < 0.2 ? BlueWood : Wood, false, yaw);
                    Box(p + Vector3.up * 2.2f, new Vector3(1.45f, 0.16f, 0.16f), Wood, false, yaw);
                }
                else if (roll < 0.72 && height > 3.2f)
                {
                    Box(p + Vector3.up * 2.25f, new Vector3(1.0f, 1.15f, 0.06f), Glass, false, yaw);
                    Box(p + Vector3.up * 2.25f + n * 0.02f, new Vector3(1.16f, 0.09f, 0.1f), BlueWood, false, yaw);
                    Box(p + Vector3.up * 1.63f + n * 0.02f, new Vector3(1.2f, 0.09f, 0.14f), BlueWood, false, yaw);
                    Box(p + Vector3.up * 2.87f + n * 0.02f, new Vector3(1.2f, 0.09f, 0.12f), BlueWood, false, yaw);
                    Box(p + Vector3.up * 2.25f + n * 0.02f, new Vector3(0.09f, 1.2f, 0.1f), BlueWood, false, yaw);
                }
                else if (roll > 0.93)
                {
                    var c = Box(p + Vector3.up * 1.7f + n * 0.03f, new Vector3(1.5f, 2.2f, 0.03f), Carpet(rng.Next(3)), false, yaw);
                    c.GetComponent<MeshRenderer>().sharedMaterial.mainTextureScale = new Vector2(1f / 1.5f, 1f / 2.2f);
                }
            }
        }
    }

    void Stall(Vector3 c, float w, float d, int style)
    {
        Box(c + Vector3.up * 0.5f, new Vector3(w, 1.0f, d), Wood);
        Box(c + Vector3.up * 1.03f, new Vector3(w + 0.1f, 0.06f, d + 0.1f), Wood, false);
        float hx = w / 2 - 0.08f, hz = d / 2 - 0.08f;
        foreach (var o in new[] { new Vector3(hx, 0, hz), new Vector3(-hx, 0, hz), new Vector3(hx, 0, -hz), new Vector3(-hx, 0, -hz) })
            Box(c + o + Vector3.up * 1.45f, new Vector3(0.09f, 2.9f, 0.09f), Wood, false);
        var roof = Box(c + Vector3.up * 2.95f, new Vector3(w + 1.1f, 0.05f, d + 0.5f), Cloth(style), false);
        roof.transform.localRotation = Quaternion.Euler(0, 0, style % 2 == 0 ? 7f : -7f);
        for (int i = 0; i < 9; i++)
        {
            Vector3 q = c + new Vector3(R(-w / 2 + 0.25f, w / 2 - 0.25f), 1.06f, R(-d / 2 + 0.3f, d / 2 - 0.3f));
            int kind = (style + i) % 3;
            if (kind == 0) Prim(PrimitiveType.Sphere, q + Vector3.up * 0.16f, Vector3.one * R(0.28f, 0.36f), Melon, false);
            else if (kind == 1) Prim(PrimitiveType.Sphere, q + Vector3.up * 0.11f, new Vector3(0.22f, 0.22f, 0.34f), YellowMelon, false);
            else Box(q + Vector3.up * 0.1f, new Vector3(0.4f, 0.2f, 0.3f), Sack, false, R(0, 90));
        }
    }

    void Bazaar()
    {
        int[,] st = { { 680, 350, 50, 90 }, { 770, 350, 50, 90 }, { 680, 520, 50, 90 }, { 770, 520, 50, 90 }, { 680, 660, 50, 80 }, { 770, 660, 50, 80 } };
        for (int i = 0; i < 6; i++) Stall(P(st[i, 0] + st[i, 2] / 2f, st[i, 1] + st[i, 3] / 2f), 2.2f, st[i, 3] * 0.06f - 0.6f, i);
        // hanging carpets and a gate beam at both ends of the lane
        foreach (float py in new[] { 300f, 780f })
        {
            Box(P(662, py, 2f), new Vector3(0.3f, 4f, 0.3f), Wood); Box(P(838, py, 2f), new Vector3(0.3f, 4f, 0.3f), Wood);
            Box(P(750, py, 4.1f), new Vector3(11.2f, 0.3f, 0.35f), Wood, false);
        }
        // arch to site A, carpet shop to site B
        Box(P(960, 437, 1.9f), new Vector3(1.2f, 3.8f, 0.5f), White); Box(P(960, 513, 1.9f), new Vector3(1.2f, 3.8f, 0.5f), White);
        Box(P(960, 475, 4.2f), new Vector3(1.4f, 0.9f, 5.4f), White, false);
        for (int i = 0; i < 4; i++)
        {
            var c = Box(P(460 + i * 50, 431.5f, 1.7f), new Vector3(2.2f, 2.6f, 0.04f), Carpet(i), false);
            c.transform.localRotation = Quaternion.Euler(4f, 0, 0);
        }
        Box(P(520, 505, 0.35f), new Vector3(3.2f, 0.7f, 0.9f), Wood);       // carpet rolls counter
        for (int i = 0; i < 5; i++) { var roll = Prim(PrimitiveType.Cylinder, P(495 + i * 12, 505, 0.85f), new Vector3(0.28f, 0.42f, 0.28f), Carpet(i), false); roll.transform.rotation = Quaternion.Euler(90, 0, 0); }
    }

    void Tapchan(Vector3 c, float yaw)
    {
        var t = new GameObject("tapchan").transform; t.SetParent(root, false); t.position = c; t.rotation = Quaternion.Euler(0, yaw, 0);
        Box(new Vector3(0, 0.3f, 0), new Vector3(2.6f, 0.6f, 2.6f), Wood, true, 0, t);
        var cp = Box(new Vector3(0, 0.615f, 0), new Vector3(2.4f, 0.03f, 2.4f), Carpet(rng.Next(3)), false, 0, t);
        cp.GetComponent<MeshRenderer>().sharedMaterial.mainTextureScale = new Vector2(1f / 2.4f, 1f / 2.4f);
        Box(new Vector3(0, 0.85f, 1.26f), new Vector3(2.6f, 0.5f, 0.08f), BlueWood, true, 0, t);
        Box(new Vector3(1.26f, 0.85f, 0), new Vector3(0.08f, 0.5f, 2.6f), BlueWood, true, 0, t);
        Box(new Vector3(-1.26f, 0.85f, 0), new Vector3(0.08f, 0.5f, 2.6f), BlueWood, true, 0, t);
        Box(new Vector3(0, 0.75f, 0), new Vector3(0.8f, 0.25f, 0.8f), Wood, false, 0, t);
    }

    void Crates(Vector3 c, int n, float spread)
    {
        for (int i = 0; i < n; i++)
        {
            float s = R(0.8f, 1.15f); Vector3 q = c + new Vector3(R(-spread, spread), 0, R(-spread, spread));
            Box(q + Vector3.up * s / 2, Vector3.one * s, Wood, true, R(0, 30));
            if (rng.NextDouble() < 0.5) Box(q + Vector3.up * (s + s * 0.4f), Vector3.one * s * 0.8f, Wood, true, R(0, 45));
        }
    }

    void SiteA()
    {
        Tapchan(P(1130, 400), 0); Tapchan(P(1320, 380), 90); Tapchan(P(1325, 560), 180);
        // tandoor and kazan
        Vector3 t = P(1110, 580);
        Prim(PrimitiveType.Cylinder, t + Vector3.up * 0.6f, new Vector3(1.3f, 0.6f, 1.3f), Clay);
        Prim(PrimitiveType.Cylinder, t + Vector3.up * 1.22f, new Vector3(0.7f, 0.03f, 0.7f), Iron, false);
        Vector3 k = P(1200, 600);
        Box(k + Vector3.up * 0.3f, new Vector3(1f, 0.6f, 1f), Brick);
        if (!Prop("kazan", k + Vector3.up * 0.6f, 0, 0.9f, false))
            Prim(PrimitiveType.Sphere, k + Vector3.up * 0.75f, new Vector3(0.9f, 0.55f, 0.9f), Iron, false);
        // low wall and well for cover in the middle
        Box(P(1230, 470, 0.55f), new Vector3(3.6f, 1.1f, 0.45f), Mud);
        Prim(PrimitiveType.Cylinder, P(1180, 500, 0.45f), new Vector3(1.5f, 0.45f, 1.5f), Brick);
        // shade tree
        Vector3 tr = P(1290, 470);
        Prim(PrimitiveType.Cylinder, tr + Vector3.up * 1.8f, new Vector3(0.4f, 1.8f, 0.4f), Wood);
        var leaf = Mat("leaves", new Color(0.2f, 0.36f, 0.14f), 0.6f, 1f);
        Prim(PrimitiveType.Sphere, tr + Vector3.up * 4.6f, new Vector3(4.6f, 3.2f, 4.6f), leaf, false);
        Prim(PrimitiveType.Sphere, tr + new Vector3(1.2f, 4f, 0.8f), new Vector3(3f, 2.4f, 3f), leaf, false);
        for (int i = 0; i < 4; i++) if (!Prop("pots", P(1090 + i * 9, 350), R(0, 360), 0.9f, false)) Prim(PrimitiveType.Sphere, P(1090 + i * 9, 350, 0.25f), Vector3.one * 0.5f, Clay, false);
    }

    void SiteB()
    {
        Crates(P(175, 405), 4, 0.9f); Crates(P(360, 570), 3, 0.7f); Crates(P(300, 380), 2, 0.5f);
        // melon pile
        Vector3 m = P(180, 560);
        for (int i = 0; i < 26; i++)
        {
            float a = R(0, 6.28f), d = R(0, 1.4f); float h = Mathf.Max(0, 0.75f - d * 0.5f) * (float)rng.NextDouble();
            Prim(PrimitiveType.Sphere, m + new Vector3(Mathf.Cos(a) * d, 0.17f + h, Mathf.Sin(a) * d), Vector3.one * R(0.3f, 0.38f), Melon, false);
        }
        Box(m + Vector3.up * 0.25f, new Vector3(2.4f, 0.5f, 2.4f), Wood);
        // sacks
        for (int i = 0; i < 10; i++) Box(P(250 + (i % 5) * 9, 600 - (i / 5) * 9, 0.22f + (i / 5) * 0.4f), new Vector3(0.75f, 0.42f, 0.5f), Sack, true, R(-10, 10));
        // truck-sized container
        Box(P(260, 470, 1.25f), new Vector3(2.4f, 2.5f, 5.2f), Mat("container", new Color(0.16f, 0.3f, 0.42f), 0.3f, 2f, 0.3f, 2));
    }

    void Car(string key, Vector3 pos, float yaw, Color c)
    {
        if (Prop(key, pos, yaw, 4.3f)) return;
        var t = new GameObject("car").transform; t.SetParent(root, false); t.position = pos; t.rotation = Quaternion.Euler(0, yaw, 0);
        var paint = Mat("car" + c, c, 0.05f, 1f, 0.7f);
        Box(new Vector3(0, 0.62f, 0), new Vector3(1.7f, 0.6f, 4.1f), paint, true, 0, t);
        Box(new Vector3(0, 1.17f, -0.2f), new Vector3(1.55f, 0.52f, 2.1f), Glass, true, 0, t);
        Box(new Vector3(0, 1.44f, -0.2f), new Vector3(1.5f, 0.05f, 2f), paint, false, 0, t);
        foreach (var w in new[] { new Vector3(0.85f, 0.32f, 1.3f), new Vector3(-0.85f, 0.32f, 1.3f), new Vector3(0.85f, 0.32f, -1.3f), new Vector3(-0.85f, 0.32f, -1.3f) })
        { var wh = Prim(PrimitiveType.Cylinder, w, new Vector3(0.64f, 0.1f, 0.64f), Iron, false, t); wh.transform.localRotation = Quaternion.Euler(0, 0, 90); }
    }

    void Streets()
    {
        Car("vaz", P(1080, 925), 82, new Color(0.2f, 0.25f, 0.5f));
        Car("nexia", P(1230, 915), 100, new Color(0.45f, 0.45f, 0.47f));
        Car("uaz", P(640, 110), 95, new Color(0.25f, 0.3f, 0.22f));
        Car("vaz", P(1100, 125), 270, new Color(0.7f, 0.68f, 0.6f));
        Crates(P(255, 760), 2, 0.4f); Crates(P(1245, 700), 2, 0.4f); Crates(P(330, 915), 2, 0.5f);
        Box(P(430, 140, 0.5f), new Vector3(0.5f, 1f, 3f), Concrete);            // road block
        Box(P(255, 250, 0.6f), new Vector3(2.6f, 1.2f, 0.4f), Mud);
        Box(P(1245, 240, 0.6f), new Vector3(2.6f, 1.2f, 0.4f), Mud);
        Box(P(750, 250, 2.2f), new Vector3(0.25f, 4.4f, 0.25f), Wood);          // gate post in the middle
        // power line poles
        foreach (var q in new[] { P(600, 95), P(900, 95), P(215, 700), P(1285, 700) })
        { Box(q + Vector3.up * 3.5f, new Vector3(0.18f, 7f, 0.18f), Wood); Box(q + Vector3.up * 6.6f, new Vector3(1.6f, 0.1f, 0.1f), Wood, false); }
    }

    void Gameplay()
    {
        Trigger("SiteA", P(1235, 480), new Vector3(330 * 0.06f - 1f, 4f, 300 * 0.06f - 1f));
        Trigger("SiteB", P(265, 480), new Vector3(330 * 0.06f - 1f, 4f, 300 * 0.06f - 1f));
        var st = new GameObject("SpawnsT").transform; var sct = new GameObject("SpawnsCT").transform;
        for (int i = 0; i < 6; i++)
        {
            Spawn(st, P(620 + i * 52, 960 + (i % 2) * 30), 0);
            Spawn(sct, P(620 + i * 52, 120 + (i % 2) * 30), 180);
        }
    }

    void Trigger(string name, Vector3 c, Vector3 size)
    {
        var g = new GameObject(name); g.transform.SetParent(root, false); g.transform.position = c + Vector3.up * 2f;
        var b = g.AddComponent<BoxCollider>(); b.size = size; b.isTrigger = true;
    }

    static void Spawn(Transform parent, Vector3 pos, float yaw)
    {
        var s = new GameObject("spawn").transform; s.SetParent(parent, false); s.position = pos + Vector3.up * 0.1f; s.rotation = Quaternion.Euler(0, yaw, 0);
    }
}
