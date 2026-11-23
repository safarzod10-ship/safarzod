using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// Menu, in-game HUD, touch controls and the buy menu. Everything is built in code.
public class Hud : MonoBehaviour
{
    public const ushort Port = 7777, DiscoveryPort = 47777;
    static Font font;
    RectTransform root, menu, hud, buy, pause, joyBase, joyKnob, useBar, scope;
    Text tHealth, tAmmo, tMoney, tTimer, tFeed, tBanner, tHint, tWeapon, tHosts, tInfo;
    Image dmg, hitMark; GameObject cross;
    InputField ipField, nickField;
    readonly Dictionary<string, RectTransform> btn = new Dictionary<string, RectTransform>();
    readonly Dictionary<int, string> fingers = new Dictionary<int, string>();
    readonly Dictionary<string, float> hosts = new Dictionary<string, float>();
    readonly Dictionary<string, string> hostNames = new Dictionary<string, string>();
    Vector2 joyStart; bool crouchToggle, mobile, connecting;
    UdpClient udpSend, udpRecv; float nextBroadcast, connectStart;
    Transform hostList;

    NetworkManager NM => NetworkManager.Singleton;
    bool InGame => NM != null && (NM.IsServer || NM.IsConnectedClient);

    void Start()
    {
        mobile = Application.isMobilePlatform;
        Application.targetFrameRate = 60;
        font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var canvas = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
        var sc = canvas.GetComponent<CanvasScaler>();
        sc.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; sc.referenceResolution = new Vector2(1920, 1080); sc.matchWidthOrHeight = 1f;
        root = canvas.GetComponent<RectTransform>();
        if (FindFirstObjectByType<EventSystem>() == null) new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
        BuildHud(); BuildBuy(); BuildPause(); BuildMenu();
        try { udpRecv = new UdpClient(); udpRecv.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true); udpRecv.Client.Bind(new IPEndPoint(IPAddress.Any, DiscoveryPort)); } catch { udpRecv = null; }
        if (NM != null) NM.OnClientDisconnectCallback += id => { if (!NM.IsServer) connecting = false; };
        // command line switches for automated checks: -autohost, -autojoin <ip>, -shots <dir>
        var args = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "-autohost") Invoke(nameof(Host), 0.5f);
            if (args[i] == "-autojoin" && i + 1 < args.Length) { autoIp = args[i + 1]; Invoke(nameof(AutoJoin), 1f); }
            if (args[i] == "-shots" && i + 1 < args.Length) { shotDir = args[i + 1]; }
            if (args[i] == "-mapshots" && i + 1 < args.Length) { shotDir = args[i + 1]; StartCoroutine(MapShots()); }
            if (args[i] == "-autohost" || args[i] == "-autojoin") InvokeRepeating(nameof(Report), 5f, 5f);
        }
    }

    System.Collections.IEnumerator MapShots()
    {
        root.gameObject.SetActive(false);
        var cam = Camera.main.transform;
        // x, y, z, pitch, yaw
        float[,] v = {
            {0, 62, -6, 86, 0}, {0, 30, -52, 34, 0}, {0, 1.7f, -13.5f, 2, 0}, {0, 1.7f, 12f, 2, 180},
            {20.5f, 1.7f, 4.5f, 3, 80}, {38f, 6f, -4f, 22, 285}, {-19.5f, 1.7f, 4.5f, 3, 275}, {-38f, 6f, -4f, 22, 75},
            {0, 1.7f, -27f, 0, 0}, {0, 1.7f, 27f, 0, 180}, {-30f, 1.7f, -24f, 2, 0}, {30f, 1.7f, -20f, 2, 0}, {-10f, 1.7f, 4.4f, 3, 270},
        };
        yield return new WaitForSeconds(1.5f);
        for (int i = 0; i < v.GetLength(0); i++)
        {
            cam.position = new Vector3(v[i, 0], v[i, 1], v[i, 2]); cam.rotation = Quaternion.Euler(v[i, 3], v[i, 4], 0);
            yield return null; yield return new WaitForEndOfFrame();
            ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shotDir, $"map{i:00}.png"));
            yield return new WaitForSeconds(0.6f);
        }
        Debug.Log("MAPSHOTS_DONE");
        Application.Quit();
    }

    string autoIp, shotDir; int shotN;
    void AutoJoin() { Join(autoIp); }
    void Report()
    {
        var g = Game.I; if (g == null) return;
        int a1 = 0, a2 = 0; foreach (var p in Player.All) { if (p.Alive && p.Team.Value == 1) a1++; if (p.Alive && p.Team.Value == 2) a2++; }
        var l = Player.Local;
        Debug.Log($"REPORT t={Time.time:0} phase={g.Phase} left={g.TimeLeft:0} score={g.ScoreT.Value}:{g.ScoreCT.Value} players={Player.All.Count} aliveT={a1} aliveCT={a2} bomb={g.BombDown.Value} local={(l ? l.Nick.Value + " hp" + l.Health.Value + " team" + l.Team.Value + " pos" + l.transform.position : "none")}");
        if (!string.IsNullOrEmpty(shotDir)) ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shotDir, $"shot{shotN++:00}.png"));
    }

    void OnDestroy() { udpRecv?.Close(); udpSend?.Close(); }

    // ---------------------------------------------------------------- ui helpers
    static RectTransform Rect(Transform parent, string name, Vector2 anchor, Vector2 pos, Vector2 size)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var r = go.GetComponent<RectTransform>();
        r.SetParent(parent, false);
        r.anchorMin = r.anchorMax = anchor; r.pivot = anchor; r.anchoredPosition = pos; r.sizeDelta = size;
        return r;
    }

    static RectTransform Fill(Transform parent, string name)
    {
        var r = Rect(parent, name, Vector2.zero, Vector2.zero, Vector2.zero);
        r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.pivot = new Vector2(0.5f, 0.5f); r.offsetMin = r.offsetMax = Vector2.zero;
        return r;
    }

    static Image Img(RectTransform r, Color c) { var i = r.gameObject.AddComponent<Image>(); i.color = c; i.raycastTarget = false; return i; }

    static Text Txt(Transform parent, string name, Vector2 anchor, Vector2 pos, Vector2 size, int fontSize, TextAnchor align, string text = "")
    {
        var r = Rect(parent, name, anchor, pos, size);
        var t = r.gameObject.AddComponent<Text>();
        t.font = font; t.fontSize = fontSize; t.alignment = align; t.color = Color.white; t.text = text; t.raycastTarget = false;
        t.horizontalOverflow = HorizontalWrapMode.Overflow; t.verticalOverflow = VerticalWrapMode.Overflow;
        var o = r.gameObject.AddComponent<Outline>(); o.effectColor = new Color(0, 0, 0, 0.8f); o.effectDistance = new Vector2(2, -2);
        return t;
    }

    static Button Btn(Transform parent, string label, Vector2 anchor, Vector2 pos, Vector2 size, UnityEngine.Events.UnityAction onClick, int fontSize = 34)
    {
        var r = Rect(parent, label, anchor, pos, size);
        var img = r.gameObject.AddComponent<Image>(); img.color = new Color(0.12f, 0.14f, 0.17f, 0.92f);
        var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = img;
        var cb = b.colors; cb.highlightedColor = new Color(1.4f, 1.3f, 1f); cb.pressedColor = new Color(0.9f, 0.6f, 0.2f); b.colors = cb;
        b.onClick.AddListener(onClick);
        var t = Txt(r, "t", new Vector2(0.5f, 0.5f), Vector2.zero, size, fontSize, TextAnchor.MiddleCenter, label);
        t.horizontalOverflow = HorizontalWrapMode.Wrap;
        return b;
    }

    static InputField Field(Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, string placeholder, string value)
    {
        var r = Rect(parent, "field", anchor, pos, size);
        var img = r.gameObject.AddComponent<Image>(); img.color = new Color(1, 1, 1, 0.95f);
        var f = r.gameObject.AddComponent<InputField>();
        var t = Txt(r, "text", new Vector2(0.5f, 0.5f), Vector2.zero, size - new Vector2(24, 8), 32, TextAnchor.MiddleLeft);
        t.color = Color.black; Destroy(t.GetComponent<Outline>());
        var ph = Txt(r, "ph", new Vector2(0.5f, 0.5f), Vector2.zero, size - new Vector2(24, 8), 30, TextAnchor.MiddleLeft, placeholder);
        ph.color = new Color(0, 0, 0, 0.4f); Destroy(ph.GetComponent<Outline>());
        f.textComponent = t; f.placeholder = ph; f.text = value;
        return f;
    }

    RectTransform TouchBtn(string id, string label, Vector2 anchor, Vector2 pos, float size)
    {
        var r = Rect(hud, id, anchor, pos, new Vector2(size, size));
        Img(r, new Color(1, 1, 1, 0.16f));
        var t = Txt(r, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(size, size), Mathf.RoundToInt(size * 0.2f), TextAnchor.MiddleCenter, label);
        t.color = new Color(1, 1, 1, 0.85f);
        btn[id] = r;
        return r;
    }

    // ---------------------------------------------------------------- build
    void BuildHud()
    {
        hud = Fill(root, "Hud");
        dmg = Img(Fill(hud, "Damage"), new Color(0.7f, 0, 0, 0));
        scope = Fill(hud, "Scope");
        var l = Rect(scope, "L", new Vector2(0, 0.5f), Vector2.zero, new Vector2(420, 1080)); Img(l, Color.black);
        var rr = Rect(scope, "R", new Vector2(1, 0.5f), Vector2.zero, new Vector2(420, 1080)); Img(rr, Color.black);
        Img(Rect(scope, "H", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1080, 3)), Color.black);
        Img(Rect(scope, "V", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(3, 1080)), Color.black);
        cross = Rect(hud, "Cross", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(40, 40)).gameObject;
        foreach (var v in new[] { new Vector4(-14, 0, 12, 3), new Vector4(14, 0, 12, 3), new Vector4(0, 14, 3, 12), new Vector4(0, -14, 3, 12) })
            Img(Rect(cross.transform, "c", new Vector2(0.5f, 0.5f), new Vector2(v.x, v.y), new Vector2(v.z, v.w)), new Color(0.3f, 1f, 0.3f, 0.9f));
        hitMark = Img(Rect(hud, "Hit", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(26, 26)), new Color(1, 1, 1, 0));
        hitMark.rectTransform.localRotation = Quaternion.Euler(0, 0, 45);

        tHealth = Txt(hud, "Health", new Vector2(0, 0), new Vector2(40, 30), new Vector2(520, 70), 54, TextAnchor.LowerLeft);
        tAmmo = Txt(hud, "Ammo", new Vector2(1, 0), new Vector2(-40, 30), new Vector2(420, 70), 54, TextAnchor.LowerRight);
        tWeapon = Txt(hud, "Weapon", new Vector2(1, 0), new Vector2(-40, 100), new Vector2(420, 40), 30, TextAnchor.LowerRight);
        tMoney = Txt(hud, "Money", new Vector2(0, 1), new Vector2(40, -110), new Vector2(360, 50), 40, TextAnchor.UpperLeft);
        tMoney.color = new Color(0.55f, 1f, 0.5f);
        tTimer = Txt(hud, "Timer", new Vector2(0.5f, 1), new Vector2(0, -16), new Vector2(700, 60), 44, TextAnchor.UpperCenter);
        tFeed = Txt(hud, "Feed", new Vector2(1, 1), new Vector2(-30, -110), new Vector2(800, 220), 28, TextAnchor.UpperRight);
        tBanner = Txt(hud, "Banner", new Vector2(0.5f, 1), new Vector2(0, -150), new Vector2(1400, 160), 56, TextAnchor.UpperCenter);
        tBanner.color = new Color(1f, 0.85f, 0.35f);
        tHint = Txt(hud, "Hint", new Vector2(0.5f, 0), new Vector2(0, 250), new Vector2(1200, 50), 34, TextAnchor.LowerCenter);
        var bar = Rect(hud, "UseBar", new Vector2(0.5f, 0), new Vector2(0, 210), new Vector2(500, 18)); Img(bar, new Color(0, 0, 0, 0.6f));
        useBar = Rect(bar, "fill", new Vector2(0, 0.5f), Vector2.zero, new Vector2(0, 18)); Img(useBar, new Color(1f, 0.8f, 0.2f));

        joyBase = Rect(hud, "JoyBase", new Vector2(0, 0), new Vector2(240, 240), new Vector2(260, 260)); joyBase.pivot = new Vector2(0.5f, 0.5f);
        Img(joyBase, new Color(1, 1, 1, 0.1f));
        joyKnob = Rect(joyBase, "Knob", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(110, 110)); Img(joyKnob, new Color(1, 1, 1, 0.3f));

        TouchBtn("fire", "ОГОНЬ", new Vector2(1, 0), new Vector2(-190, 210), 210);
        TouchBtn("fire2", "ОГОНЬ", new Vector2(0, 0), new Vector2(60, 520), 150);
        TouchBtn("jump", "ПРЫЖОК", new Vector2(1, 0), new Vector2(-40, 440), 140);
        TouchBtn("crouch", "СЕСТЬ", new Vector2(1, 0), new Vector2(-430, 130), 140);
        TouchBtn("reload", "ПЕРЕЗ.", new Vector2(1, 0), new Vector2(-430, 300), 130);
        TouchBtn("next", "ОРУЖИЕ", new Vector2(1, 0), new Vector2(-230, 450), 130);
        TouchBtn("zoom", "ПРИЦЕЛ", new Vector2(1, 0), new Vector2(-40, 620), 130);
        TouchBtn("use", "БОМБА", new Vector2(0.5f, 0), new Vector2(65, 300), 150);
        TouchBtn("buy", "МАГАЗИН", new Vector2(0, 1), new Vector2(40, -180), 150);
        TouchBtn("menu", "МЕНЮ", new Vector2(0, 1), new Vector2(40, -16), 90);
    }

    void BuildBuy()
    {
        buy = Fill(root, "Buy");
        Img(buy, new Color(0, 0, 0, 0.82f)).raycastTarget = true;
        Txt(buy, "title", new Vector2(0.5f, 1), new Vector2(0, -14), new Vector2(900, 60), 44, TextAnchor.UpperCenter, "МАГАЗИН");
        string[] groups = { "Пистолеты", "Дробовики и ПП", "Автоматы", "Снайперские и тяжёлое" };
        int[][] ids = { new[] { 1, 2, 3, 4, 5, 6 }, new[] { 7, 8, 9, 10, 11, 12, 13 }, new[] { 14, 15, 16, 17, 18, 19 }, new[] { 20, 21, 22, 23, 24, 100 } };
        for (int g = 0; g < 4; g++)
        {
            float x = -690 + g * 460;
            Txt(buy, "g", new Vector2(0.5f, 1), new Vector2(x, -90), new Vector2(440, 44), 30, TextAnchor.UpperCenter, groups[g]).color = new Color(1f, 0.8f, 0.4f);
            for (int i = 0; i < ids[g].Length; i++)
            {
                int id = ids[g][i];
                string label = id == 100 ? "Бронежилет — 650" : Weapons.Get(id).title + " — " + Weapons.Get(id).price;
                Btn(buy, label, new Vector2(0.5f, 1), new Vector2(x, -150 - i * 118), new Vector2(430, 104), () => { InputState.I.buy = id; Fx.Sound2D("click", 0.6f); }, 30);
            }
        }
        Btn(buy, "ЗАКРЫТЬ", new Vector2(0.5f, 0), new Vector2(0, 14), new Vector2(380, 84), () => buy.gameObject.SetActive(false));
        buy.gameObject.SetActive(false);
    }

    void BuildPause()
    {
        pause = Fill(root, "Pause");
        Img(pause, new Color(0, 0, 0, 0.8f)).raycastTarget = true;
        tInfo = Txt(pause, "info", new Vector2(0.5f, 1), new Vector2(0, -120), new Vector2(1400, 200), 36, TextAnchor.UpperCenter);
        Btn(pause, "ПРОДОЛЖИТЬ", new Vector2(0.5f, 0.5f), new Vector2(0, 110), new Vector2(560, 100), () => pause.gameObject.SetActive(false));
        Btn(pause, "Чувствительность −", new Vector2(0.5f, 0.5f), new Vector2(-290, -10), new Vector2(560, 100), () => Sens(-0.1f));
        Btn(pause, "Чувствительность +", new Vector2(0.5f, 0.5f), new Vector2(290, -10), new Vector2(560, 100), () => Sens(0.1f));
        Btn(pause, "ВЫЙТИ В МЕНЮ", new Vector2(0.5f, 0.5f), new Vector2(0, -130), new Vector2(560, 100), Leave);
        pause.gameObject.SetActive(false);
    }

    void Sens(float d) { PlayerPrefs.SetFloat("sens", Mathf.Clamp(PlayerPrefs.GetFloat("sens", 1f) + d, 0.3f, 3f)); }

    void BuildMenu()
    {
        menu = Fill(root, "Menu");
        Img(menu, new Color(0.05f, 0.05f, 0.06f, 0.78f)).raycastTarget = true;
        Txt(menu, "title", new Vector2(0.5f, 1), new Vector2(0, -50), new Vector2(1400, 130), 110, TextAnchor.UpperCenter, "БАЗАР").color = new Color(1f, 0.8f, 0.35f);
        Txt(menu, "sub", new Vector2(0.5f, 1), new Vector2(0, -180), new Vector2(1400, 50), 34, TextAnchor.UpperCenter, "спецназ против банды · по Wi-Fi или с ботами");
        Txt(menu, "nl", new Vector2(0.5f, 0.5f), new Vector2(-610, 250), new Vector2(300, 50), 30, TextAnchor.MiddleLeft, "Ваше имя");
        nickField = Field(menu, new Vector2(0.5f, 0.5f), new Vector2(-510, 190), new Vector2(500, 76), "Имя", PlayerPrefs.GetString("nick", "Игрок" + Random.Range(10, 99)));
        Btn(menu, "ИГРАТЬ С БОТАМИ", new Vector2(0.5f, 0.5f), new Vector2(-510, 70), new Vector2(500, 110), () => Host());
        Btn(menu, "СОЗДАТЬ ИГРУ ПО WI-FI", new Vector2(0.5f, 0.5f), new Vector2(-510, -60), new Vector2(500, 110), () => Host());
        var diff = Btn(menu, DiffLabel(), new Vector2(0.5f, 0.5f), new Vector2(-510, -190), new Vector2(500, 90), null, 30);
        diff.onClick.AddListener(() => { Game.BotSkill = Game.BotSkill < 0.4f ? 0.5f : Game.BotSkill < 0.7f ? 0.85f : 0.2f; diff.GetComponentInChildren<Text>().text = DiffLabel(); });
        var size = Btn(menu, "Команды: 5 на 5", new Vector2(0.5f, 0.5f), new Vector2(-510, -300), new Vector2(500, 90), null, 30);
        size.onClick.AddListener(() => { Game.TeamSize = Game.TeamSize >= 5 ? 2 : Game.TeamSize + 1; size.GetComponentInChildren<Text>().text = $"Команды: {Game.TeamSize} на {Game.TeamSize}"; });

        Txt(menu, "jl", new Vector2(0.5f, 0.5f), new Vector2(160, 250), new Vector2(800, 50), 30, TextAnchor.MiddleLeft, "Войти в игру друга (тот же Wi-Fi)");
        ipField = Field(menu, new Vector2(0.5f, 0.5f), new Vector2(300, 190), new Vector2(520, 76), "IP-адрес, например 192.168.1.5", PlayerPrefs.GetString("ip", ""));
        Btn(menu, "ВОЙТИ", new Vector2(0.5f, 0.5f), new Vector2(720, 190), new Vector2(260, 76), () => Join(ipField.text));
        tHosts = Txt(menu, "hosts", new Vector2(0.5f, 0.5f), new Vector2(400, 110), new Vector2(760, 50), 28, TextAnchor.MiddleLeft, "Поиск игр в сети…");
        hostList = Rect(menu, "list", new Vector2(0.5f, 0.5f), new Vector2(400, 60), new Vector2(760, 10));
    }

    static string DiffLabel() => "Боты: " + (Game.BotSkill < 0.4f ? "лёгкие" : Game.BotSkill < 0.7f ? "средние" : "сложные");

    // ---------------------------------------------------------------- network
    void SaveNick() { PlayerPrefs.SetString("nick", string.IsNullOrWhiteSpace(nickField.text) ? "Игрок" : nickField.text.Trim()); }

    public void Host()
    {
        if (InGame) return;
        SaveNick();
        NM.GetComponent<UnityTransport>().SetConnectionData("127.0.0.1", Port, "0.0.0.0");
        if (!NM.StartHost()) { tHosts.text = "Не удалось создать игру (порт занят?)"; return; }
        try { udpSend = new UdpClient { EnableBroadcast = true }; } catch { udpSend = null; }
    }

    public void Join(string ip)
    {
        if (InGame || connecting) return;
        ip = (ip ?? "").Trim();
        if (!IPAddress.TryParse(ip, out _)) { tHosts.text = "Введите IP-адрес хоста"; return; }
        SaveNick(); PlayerPrefs.SetString("ip", ip);
        NM.GetComponent<UnityTransport>().SetConnectionData(ip, Port);
        connecting = NM.StartClient(); connectStart = Time.time;
        tHosts.text = "Подключение к " + ip + "…";
    }

    void Leave()
    {
        udpSend?.Close(); udpSend = null;
        if (NM != null) NM.Shutdown();
        Cursor.lockState = CursorLockMode.None; Cursor.visible = true;
        UnityEngine.SceneManagement.SceneManager.LoadScene(0);
    }

    public static string LocalIp()
    {
        try
        {
            using (var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))
            { s.Connect("10.255.255.255", 1); return ((IPEndPoint)s.LocalEndPoint).Address.ToString(); }
        }
        catch { }
        try { foreach (var a in Dns.GetHostAddresses(Dns.GetHostName())) if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) return a.ToString(); } catch { }
        return "нет сети";
    }

    void Discovery()
    {
        if (udpSend != null && NM.IsServer && Time.unscaledTime > nextBroadcast)
        {
            nextBroadcast = Time.unscaledTime + 1f;
            var data = Encoding.UTF8.GetBytes("BAZAR|" + PlayerPrefs.GetString("nick", "Игрок"));
            try { udpSend.Send(data, data.Length, new IPEndPoint(IPAddress.Broadcast, DiscoveryPort)); } catch { }
        }
        if (udpRecv == null || InGame) return;
        try
        {
            while (udpRecv.Available > 0)
            {
                IPEndPoint ep = null;
                var s = Encoding.UTF8.GetString(udpRecv.Receive(ref ep));
                if (!s.StartsWith("BAZAR|")) continue;
                string ip = ep.Address.ToString();
                bool isNew = !hosts.ContainsKey(ip);
                hosts[ip] = Time.unscaledTime; hostNames[ip] = s.Substring(6);
                if (isNew) RefreshHosts();
            }
        }
        catch { }
    }

    void RefreshHosts()
    {
        for (int i = hostList.childCount - 1; i >= 0; i--) Destroy(hostList.GetChild(i).gameObject);
        int n = 0;
        foreach (var kv in hosts)
        {
            string ip = kv.Key;
            Btn(hostList, $"Игра «{hostNames[ip]}»  ·  {ip}", new Vector2(0.5f, 1), new Vector2(0, -n * 96), new Vector2(760, 86), () => Join(ip), 30);
            n++;
        }
        tHosts.text = n == 0 ? "Поиск игр в сети…" : "Найденные игры:";
    }

    // ---------------------------------------------------------------- frame
    void Update()
    {
        if (NM == null) return;
        Discovery();
        if (connecting && NM.IsConnectedClient) connecting = false;
        if (connecting && Time.time - connectStart > 8f) { connecting = false; NM.Shutdown(); tHosts.text = "Не удалось подключиться"; }
        bool inGame = InGame;
        if (menu.gameObject.activeSelf == inGame) menu.gameObject.SetActive(!inGame);
        if (hud.gameObject.activeSelf != inGame) hud.gameObject.SetActive(inGame);
        if (!inGame) { if (buy.gameObject.activeSelf) buy.gameObject.SetActive(false); return; }
        var p = Player.Local; var g = Game.I;
        if (g == null) return;
        bool overlay = buy.gameObject.activeSelf || pause.gameObject.activeSelf;
        if (overlay) { var i = InputState.I; i.move = Vector2.zero; i.fire = false; i.use = false; }
        else if (mobile) TouchInput(); else DesktopInput();
        if (buy.gameObject.activeSelf && !g.CanBuy) buy.gameObject.SetActive(false);
        if (pause.gameObject.activeSelf)
            tInfo.text = (NM.IsServer ? "Вы создали игру. Друзья входят по адресу: " + LocalIp() : "Вы подключены к игре") + $"\nЧувствительность: {PlayerPrefs.GetFloat("sens", 1f):0.0}";
        DrawHud(p, g);
    }

    void DrawHud(Player p, Game g)
    {
        int tl = Mathf.CeilToInt(g.TimeLeft);
        string phase = g.Phase == Phase.Freeze ? "Закупка " : g.Phase == Phase.Planted ? "БОМБА " : "";
        tTimer.text = $"<color=#e0a060>Банда {g.ScoreT.Value}</color>   {phase}{tl / 60}:{tl % 60:00}   <color=#70a8ff>{g.ScoreCT.Value} Спецназ</color>";
        tTimer.color = g.Phase == Phase.Planted ? new Color(1f, 0.4f, 0.3f) : Color.white;
        tBanner.text = Time.time < g.bannerUntil ? g.banner : "";
        tFeed.text = Time.time < g.feedUntil ? string.Join("\n", g.feed) : "";
        bool alive = p != null && p.Alive;
        foreach (var kv in btn) kv.Value.gameObject.SetActive(mobile && (alive || kv.Key == "menu"));
        joyBase.gameObject.SetActive(mobile && alive);
        if (p == null) { tHealth.text = ""; tAmmo.text = ""; tMoney.text = ""; tHint.text = "Подключение…"; return; }
        tMoney.text = p.Money.Value + " сомони";
        if (!alive)
        {
            tHealth.text = ""; tAmmo.text = ""; tWeapon.text = ""; cross.SetActive(false); scope.gameObject.SetActive(false);
            tHint.text = "Вы убиты — наблюдение за командой"; useBar.sizeDelta = new Vector2(0, 18); dmg.color = new Color(0.7f, 0, 0, 0);
            return;
        }
        var d = p.Def;
        tHealth.text = $"<color=#ff6a5a>✚ {p.Health.Value}</color>   <color=#9ec7ff>⛨ {p.Armor.Value}</color>";
        tAmmo.text = d.slot == Slot.Knife ? "" : d.slot == Slot.Grenade ? p.mag[p.cur].ToString() : $"{p.mag[p.cur]} / {p.res[p.cur]}";
        tWeapon.text = d.title + (p.Reloading ? "  (перезарядка)" : "") + (p.HasBomb.Value ? "   ● БОМБА У ВАС" : "");
        bool scoped = p.zoomed && d.zoomFov < 30;
        scope.gameObject.SetActive(scoped); cross.SetActive(!scoped && !(d.zoomFov > 0 && d.zoomFov < 30));
        hitMark.color = new Color(1, 1, 1, p.hitMarker > 0 ? 0.9f : 0);
        dmg.color = new Color(0.7f, 0, 0, Mathf.Clamp01(p.damageFlash) * 0.4f);
        useBar.sizeDelta = new Vector2(500 * p.useProgress, 18);
        bool plant = g.CanPlant(p), defuse = g.CanDefuse(p);
        tHint.text = plant ? "Удерживайте «БОМБА», чтобы заложить" : defuse ? "Удерживайте «БОМБА», чтобы обезвредить"
            : g.Phase == Phase.Freeze ? "Закупка: откройте МАГАЗИН" : p.HasBomb.Value ? "Несите бомбу на точку A или B" : "";
        if (mobile)
        {
            btn["use"].gameObject.SetActive(plant || defuse);
            btn["buy"].gameObject.SetActive(g.CanBuy);
            btn["zoom"].gameObject.SetActive(d.zoomFov > 0);
        }
    }

    bool Hit(RectTransform r, Vector2 screen) => r.gameObject.activeInHierarchy && RectTransformUtility.RectangleContainsScreenPoint(r, screen, null);

    void TouchInput()
    {
        var inp = InputState.I;
        bool fire = false, use = false; Vector2 move = Vector2.zero;
        float k = 1080f / Screen.height;
        for (int i = 0; i < Input.touchCount; i++)
        {
            var t = Input.GetTouch(i);
            if (t.phase == TouchPhase.Began)
            {
                string role = null;
                foreach (var kv in btn) if (Hit(kv.Value, t.position)) { role = kv.Key; break; }
                if (role == null) role = t.position.x < Screen.width * 0.4f ? "joy" : "look";
                fingers[t.fingerId] = role;
                switch (role)
                {
                    case "joy": joyStart = t.position; joyBase.position = t.position; break;
                    case "jump": inp.jump = true; break;
                    case "crouch": crouchToggle = !crouchToggle; break;
                    case "reload": inp.reload = true; break;
                    case "next": inp.next = true; break;
                    case "zoom": inp.zoom = true; break;
                    case "buy": buy.gameObject.SetActive(true); break;
                    case "menu": pause.gameObject.SetActive(true); break;
                }
            }
            if (!fingers.TryGetValue(t.fingerId, out var r)) continue;
            if (r == "joy")
            {
                Vector2 dlt = (t.position - joyStart) * k / 110f;
                move = Vector2.ClampMagnitude(dlt, 1f);
                joyKnob.anchoredPosition = move * 90f;
            }
            else if (r == "look" || r == "fire" || r == "fire2")
            {
                if (r != "look") fire = true;
                if (r != "fire2") inp.look += t.deltaPosition * k * 0.11f;
            }
            else if (r == "use") use = true;
            if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled)
            {
                if (r == "joy") joyKnob.anchoredPosition = Vector2.zero;
                fingers.Remove(t.fingerId);
            }
        }
        inp.move = move; inp.fire = fire; inp.use = use; inp.crouch = crouchToggle;
    }

    void DesktopInput()
    {
        var inp = InputState.I;
        if (Input.GetKeyDown(KeyCode.Escape)) { pause.gameObject.SetActive(true); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; return; }
        if (Input.GetKeyDown(KeyCode.B) && Game.I.CanBuy) { buy.gameObject.SetActive(true); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; return; }
        if (Cursor.lockState != CursorLockMode.Locked) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
        inp.move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
        inp.look += new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y")) * 2.2f;
        inp.fire = Input.GetMouseButton(0);
        if (Input.GetMouseButtonDown(1)) inp.zoom = true;
        if (Input.GetKeyDown(KeyCode.Space)) inp.jump = true;
        if (Input.GetKeyDown(KeyCode.R)) inp.reload = true;
        if (Input.GetKeyDown(KeyCode.Q) || Input.GetAxis("Mouse ScrollWheel") != 0) inp.next = true;
        for (int i = 0; i < 4; i++) if (Input.GetKeyDown(KeyCode.Alpha1 + i)) inp.slot = i == 0 ? 2 : i == 1 ? 1 : i == 2 ? 0 : 3;
        inp.crouch = Input.GetKey(KeyCode.LeftControl); inp.walk = Input.GetKey(KeyCode.LeftShift);
        inp.use = Input.GetKey(KeyCode.E);
    }
}
