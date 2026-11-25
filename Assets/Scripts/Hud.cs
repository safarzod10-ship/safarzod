using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using static UiKit;

/// All screens of the game, built in code with UiKit: main menu (bots / Wi-Fi), settings (graphics, controls,
/// sound), loading screen, in-game HUD with touch controls, buy menu, pause menu, scoreboard and match end.
/// Also LAN discovery and the command-line switches used by automated checks.
public class Hud : MonoBehaviour
{
    public const ushort Port = 7777, DiscoveryPort = 47777;
    const float W = 1920f, H = 1080f;

    RectTransform root, menu, hud, buy, pause, settings, board, loading, matchEnd;
    // menu
    RectTransform pageBots, pageLan; readonly List<Image> navMarks = new List<Image>(), navIcons = new List<Image>(); readonly List<Text> navTexts = new List<Text>();
    InputField ipField, nickBots, nickLan; Text tHosts, tMyIp, tMenuStatus; Transform hostList;
    // loading
    Text tLoadState, tLoadTip; RectTransform loadStripe; float loadingSince; bool loadingActive;
    // hud
    RectTransform joyBase, joyKnob, useBar, scope, hintPanel, bannerPanel, deadPanel, bombBadge, touchRoot;
    Text tHealth, tArmor, tAmmo, tReserve, tWeapon, tMoney, tTimer, tPhase, tScoreT, tScoreCT, tAliveT, tAliveCT, tBanner, tHint, tDead, tInfo, tBuyMoney;
    Image healthBar, armorBar, dmg, hitMark, bannerBar, timerBg;
    readonly Image[] pipsT = new Image[5], pipsCT = new Image[5];
    readonly RectTransform[] feedRows = new RectTransform[5]; readonly Text[] feedTexts = new Text[5];
    GameObject cross;
    readonly List<Button> buyButtons = new List<Button>(); readonly List<int> buyPrices = new List<int>();
    // board / match end
    class Row { public RectTransform r; public Image bg, mark; public Text name, k, d, money; }
    readonly Row[] rowsA = new Row[6], rowsB = new Row[6];
    Text tBoardTitle, tBoardHeadA, tBoardHeadB, tEndTitle, tEndScore, tEndMvp, tEndNext; Image boardBarA, boardBarB, endGlow;
    bool boardHeld;
    // settings
    readonly List<System.Action> settingsRefresh = new List<System.Action>(); RectTransform[] settingsPages; Text tPresetInfo;
    readonly List<Image> tabImgs = new List<Image>(); readonly List<Text> tabTexts = new List<Text>();

    readonly Dictionary<string, RectTransform> btn = new Dictionary<string, RectTransform>();
    readonly Dictionary<int, string> fingers = new Dictionary<int, string>();
    readonly Dictionary<string, float> hosts = new Dictionary<string, float>();
    readonly Dictionary<string, string> hostNames = new Dictionary<string, string>();
    Vector2 joyStart; bool crouchToggle, mobile, connecting;
    UdpClient udpSend, udpRecv; float nextBroadcast, connectStart, menuAngle;

    static readonly string[] Tips =
    {
        "Бомбу закладывает только банда. Спецназу нужно 7 секунд, чтобы её обезвредить.",
        "Проигранные раунды подряд дают больше денег на следующую закупку.",
        "Стрельба на бегу неточная — остановитесь перед выстрелом.",
        "В голову урон в несколько раз выше, чем в тело.",
        "Бронежилет стоит 650 и сильно снижает урон от пуль.",
        "После 12 раундов команды меняются сторонами.",
        "Друзья в той же сети Wi-Fi видят вашу игру в списке автоматически.",
    };

    NetworkManager NM => NetworkManager.Singleton;
    bool InGame => NM != null && (NM.IsServer || NM.IsConnectedClient);

    void Start()
    {
        mobile = Application.isMobilePlatform;
        UiKit.Init();
        var canvas = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
        var sc = canvas.GetComponent<CanvasScaler>();
        sc.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; sc.referenceResolution = new Vector2(W, H);
        // wide phones keep the height, narrow (4:3) screens keep the width so nothing is cut off
        sc.matchWidthOrHeight = (float)Screen.width / Screen.height >= W / H ? 1f : 0f;
        root = canvas.GetComponent<RectTransform>();
        if (FindFirstObjectByType<EventSystem>() == null) new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
        BuildHud(); BuildBuy(); BuildBoard(); BuildMatchEnd(); BuildPause(); BuildMenu(); BuildSettings(); BuildLoading();
        try { udpRecv = new UdpClient(); udpRecv.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true); udpRecv.Client.Bind(new IPEndPoint(IPAddress.Any, DiscoveryPort)); } catch { udpRecv = null; }
        if (NM != null) NM.OnClientDisconnectCallback += id => { if (!NM.IsServer) { connecting = false; HideLoading(); } };
        // command line switches for automated checks: -autohost, -autojoin <ip>, -shots <dir>, -uishots <dir>
        var args = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "-autohost") Invoke(nameof(Host), 0.5f);
            if (args[i] == "-autojoin" && i + 1 < args.Length) { autoIp = args[i + 1]; Invoke(nameof(AutoJoin), 1f); }
            if (args[i] == "-shots" && i + 1 < args.Length) { shotDir = args[i + 1]; }
            if (args[i] == "-uishots" && i + 1 < args.Length) { shotDir = args[i + 1]; StartCoroutine(UiShots()); }
            if (args[i] == "-mapshots" && i + 1 < args.Length) { shotDir = args[i + 1]; StartCoroutine(MapShots()); }
            if (args[i] == "-walk" && i + 1 < args.Length) { shotDir = args[i + 1]; StartCoroutine(Walk()); }
            if (args[i] == "-autohost" || args[i] == "-autojoin") InvokeRepeating(nameof(Report), 5f, 5f);
        }
    }

    // ================================================================ automated checks
    /// Screenshots of every screen (menu pages, settings tabs, loading, HUD, buy, scoreboard, pause, match end).
    System.Collections.IEnumerator UiShots()
    {
        Time.captureFramerate = 0;
        System.Collections.IEnumerator Shot(string name)
        {
            yield return null; yield return new WaitForEndOfFrame();
            ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shotDir, name + ".png"));
            yield return new WaitForSeconds(0.4f);
        }
        yield return new WaitForSeconds(1.5f);
        ShowPage(0); yield return Shot("ui01_menu_bots");
        ShowPage(1); yield return Shot("ui02_menu_lan");
        for (int t = 0; t < 3; t++) { OpenSettings(); ShowTab(t); yield return Shot("ui0" + (3 + t) + "_settings_" + t); }
        CloseSettings();
        ShowPage(0);
        Host();                                    // the host starts two frames later: capture the loading screen before that
        yield return Shot("ui06_loading");
        while (Player.Local == null || Game.I == null || Game.I.Phase == Phase.Lobby) yield return null;
        yield return new WaitForSeconds(1.5f);
        yield return Shot("ui07_hud_freeze");
        buy.gameObject.SetActive(true); yield return Shot("ui08_buy"); buy.gameObject.SetActive(false);
        while (Game.I.Phase == Phase.Freeze) yield return null;
        yield return new WaitForSeconds(2f);
        yield return Shot("ui09_hud_live");
        boardHeld = true; yield return Shot("ui10_scoreboard"); boardHeld = false;
        pause.gameObject.SetActive(true); yield return Shot("ui11_pause"); pause.gameObject.SetActive(false);
        forceMatchEnd = true; yield return new WaitForSeconds(0.2f); yield return Shot("ui12_match_end"); forceMatchEnd = false;
        Debug.Log("UISHOTS_DONE");
        Application.Quit();
    }
    bool forceMatchEnd;

    /// Records a first-person walk through the map as numbered frames (24 per second of game time).
    System.Collections.IEnumerator Walk()
    {
        root.gameObject.SetActive(false);
        var cam = Camera.main.transform;
        float[,] w = {
            {0,-26},{0,-14.5f},{0,-2},{0,4.5f},{8,4.5f},{20,4.5f},{25,1.5f},{31,0},{34,6},{30,12},{29.7f,22},{20,24.5f},{6,25},
            {1.6f,21},{1.6f,15.5f},{0,10},{0,4.5f},{-8,4.5f},{-20,4.5f},{-26,1},{-31,3},{-33,8},
        };
        Time.captureFramerate = 24;
        yield return new WaitForSeconds(1f);
        Vector3 pos = new Vector3(w[0, 0], 0, w[0, 1]); float yaw = 0, bob = 0; int frame = 0;
        for (int i = 1; i < w.GetLength(0); i++)
        {
            Vector3 target = new Vector3(w[i, 0], 0, w[i, 1]);
            while ((target - pos).sqrMagnitude > 0.04f)
            {
                float dt = 1f / 24f;
                Vector3 dir = (target - pos).normalized;
                float wantYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
                float off = Mathf.Abs(Mathf.DeltaAngle(yaw, wantYaw));
                yaw = Mathf.MoveTowardsAngle(yaw, wantYaw, 110f * dt);
                float speed = off > 40f ? 1.2f : 3.6f;
                pos = Vector3.MoveTowards(pos, target, speed * dt);
                bob += speed * dt * 2.1f;
                float look = Mathf.Sin(frame * 0.035f) * 16f;
                cam.position = pos + Vector3.up * (1.66f + Mathf.Sin(bob * 2f) * 0.03f) + cam.right * Mathf.Cos(bob) * 0.02f;
                cam.rotation = Quaternion.Euler(1.5f + Mathf.Sin(frame * 0.02f) * 4f, yaw + look, Mathf.Cos(bob) * 0.4f);
                yield return new WaitForEndOfFrame();
                ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shotDir, $"f{frame++:00000}.png"));
                yield return null;
            }
        }
        Debug.Log("WALK_DONE frames=" + frame);
        yield return new WaitForSeconds(0.5f);
        Application.Quit();
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
        var tri = UnityEngine.AI.NavMesh.CalculateTriangulation();
        var sb = new StringBuilder("BOTS navVerts=" + tri.vertices.Length + " sites=" + g.sites.Count);
        int shown = 0;
        foreach (var p in Player.All)
        {
            if (!p.IsBot.Value || shown++ >= 4) continue;
            var ag = p.GetComponent<UnityEngine.AI.NavMeshAgent>();
            sb.Append($" | {p.Nick.Value} t{p.Team.Value} pos{p.transform.position} agent={(ag != null)} onNav={(ag != null && ag.isOnNavMesh)} path={(ag != null && ag.isOnNavMesh && ag.hasPath)} vel={(ag != null ? ag.velocity.magnitude : 0):0.0} w={p.cur} mag={p.mag[p.cur]}");
        }
        Debug.Log(sb.ToString());
        if (Camera.main != null)
        {
            var fpv = FindFirstObjectByType<FpView>(); if (fpv != null) Debug.Log("FPV " + fpv.Debug() + " reloading=" + (Player.Local != null && Player.Local.Reloading) + " cur=" + (Player.Local != null ? Player.Local.cur : -1));
        }
        if (!string.IsNullOrEmpty(shotDir)) ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shotDir, $"shot{shotN++:00}.png"));
    }

    void OnDestroy() { udpRecv?.Close(); udpSend?.Close(); }

    // ================================================================ main menu
    void BuildMenu()
    {
        menu = Stretch(root, "Menu");
        // darken the left side so the live map behind stays visible on the right
        var shade = Stretch(menu, "shade"); Img(shade, new Color(0.02f, 0.025f, 0.03f, 0.92f), GradH, true);
        shade.anchorMax = new Vector2(0.78f, 1);
        var bottom = Node(menu, "bottomShade", new Vector2(0.5f, 0), Vector2.zero, new Vector2(W * 2, 260), new Vector2(0.5f, 0));
        Img(bottom, new Color(0, 0, 0, 0.55f), GradV).rectTransform.localScale = new Vector3(1, -1, 1);

        var logo = Node(menu, "logo", new Vector2(0, 1), new Vector2(110, -70), new Vector2(900, 260), new Vector2(0, 1));
        Img(Node(logo, "bar", new Vector2(0, 1), new Vector2(0, -12), new Vector2(10, 128), new Vector2(0, 1)), Accent);
        Label(logo, "title", new Vector2(0, 1), new Vector2(36, 0), new Vector2(860, 150), 132, TextAnchor.UpperLeft, "БАЗАР", Title, Fg).rectTransform.pivot = new Vector2(0, 1);
        Label(logo, "sub", new Vector2(0, 1), new Vector2(40, -150), new Vector2(860, 40), 30, TextAnchor.UpperLeft, "СПЕЦНАЗ ПРОТИВ БАНДЫ  ·  СТАРЫЙ ГОРОД", Body, Accent).rectTransform.pivot = new Vector2(0, 1);

        string[] items = { "ИГРАТЬ С БОТАМИ", "ИГРА ПО WI-FI", "НАСТРОЙКИ", "ВЫХОД" };
        Sprite[] icons = { IconPlay, IconWifi, IconGear, IconExit };
        for (int i = 0; i < items.Length; i++)
        {
            int k = i;
            var r = Node(menu, "nav" + i, new Vector2(0, 1), new Vector2(110, -400 - i * 104), new Vector2(620, 88), new Vector2(0, 1));
            var bg = Img(r, new Color(1, 1, 1, 0.001f), Round, true);
            var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = bg;
            var cb = b.colors; cb.normalColor = new Color(1, 1, 1, 0.001f); cb.highlightedColor = new Color(1, 1, 1, 0.06f); cb.pressedColor = new Color(1, 1, 1, 0.12f); cb.selectedColor = cb.normalColor; b.colors = cb;
            var mark = Img(Node(r, "mark", new Vector2(0, 0.5f), new Vector2(0, 0), new Vector2(8, 56), new Vector2(0, 0.5f)), Accent, RoundSmall);
            navIcons.Add(Icon(r, icons[i], new Vector2(0, 0.5f), new Vector2(54, 0), 40, Muted));
            var t = Label(r, "t", new Vector2(0, 0.5f), new Vector2(100, 0), new Vector2(500, 88), 44, TextAnchor.MiddleLeft, items[i], Title, Muted);
            t.rectTransform.pivot = new Vector2(0, 0.5f);
            navMarks.Add(mark); navTexts.Add(t);
            b.onClick.AddListener(() =>
            {
                Fx.Sound2D("click", 0.5f);
                if (k == 0 || k == 1) ShowPage(k);
                else if (k == 2) OpenSettings();
                else Application.Quit();
            });
        }

        Label(menu, "ver", new Vector2(0, 0), new Vector2(110, 40), new Vector2(900, 36), 24, TextAnchor.LowerLeft,
            "Версия " + Application.version + "  ·  " + (mobile ? "Android" : SystemInfo.operatingSystemFamily.ToString()), BodyReg, Muted).rectTransform.pivot = new Vector2(0, 0);

        string nick = PlayerPrefs.GetString("nick", "Игрок" + Random.Range(10, 99));
        // --- page: bots
        pageBots = Card(menu, "pageBots", "ИГРА С БОТАМИ", "Матч 5 на 5 до 13 побед на карте «Старый город». Свободные места занимают боты.");
        float y = -190;
        var c = SetRow(pageBots, "Ваше имя", y, 780, out _); nickBots = Field(c, new Vector2(1, 0.5f), Vector2.zero, c.sizeDelta, "Имя", nick); nickBots.GetComponent<RectTransform>().pivot = new Vector2(1, 0.5f);
        y -= 96; c = SetRow(pageBots, "Сложность ботов", y, 780, out _);
        Segmented(c, new[] { "Лёгкие", "Средние", "Сложные" }, () => Game.BotSkill < 0.4f ? 0 : Game.BotSkill < 0.7f ? 1 : 2, i => Game.BotSkill = new[] { 0.2f, 0.5f, 0.85f }[i]);
        y -= 96; c = SetRow(pageBots, "Игроков в команде", y, 780, out _);
        Segmented(c, new[] { "2", "3", "4", "5" }, () => Mathf.Clamp(Game.TeamSize - 2, 0, 3), i => Game.TeamSize = i + 2);
        y -= 96; c = SetRow(pageBots, "Карта", y, 780, out _);
        Label(c, "map", new Vector2(1, 0.5f), Vector2.zero, c.sizeDelta, 32, TextAnchor.MiddleRight, "Старый город  ·  1 точка", Body, Fg).rectTransform.pivot = new Vector2(1, 0.5f);
        Btn(pageBots, "НАЧАТЬ МАТЧ", new Vector2(0.5f, 0), new Vector2(0, 40), new Vector2(780, 104), () => { nickLan.text = nickBots.text; Host(); }, Style.Primary, 40, IconPlay)
            .GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);

        // --- page: wi-fi
        pageLan = Card(menu, "pageLan", "ИГРА ПО WI-FI", "Создайте игру — друзья в той же сети увидят её в списке. Или войдите по IP-адресу.");
        y = -190;
        c = SetRow(pageLan, "Ваше имя", y, 780, out _); nickLan = Field(c, new Vector2(1, 0.5f), Vector2.zero, c.sizeDelta, "Имя", nick); nickLan.GetComponent<RectTransform>().pivot = new Vector2(1, 0.5f);
        y -= 96; c = SetRow(pageLan, "Ваш адрес в сети", y, 780, out _);
        tMyIp = Label(c, "ip", new Vector2(1, 0.5f), Vector2.zero, c.sizeDelta, 34, TextAnchor.MiddleRight, "", Title, Accent); tMyIp.rectTransform.pivot = new Vector2(1, 0.5f);
        y -= 96; c = SetRow(pageLan, "Войти по IP", y, 780, out _);
        ipField = Field(c, new Vector2(0, 0.5f), Vector2.zero, new Vector2(c.sizeDelta.x - 170, c.sizeDelta.y), "192.168.1.5", PlayerPrefs.GetString("ip", ""));
        ipField.GetComponent<RectTransform>().pivot = new Vector2(0, 0.5f);
        Btn(c, "ВОЙТИ", new Vector2(1, 0.5f), Vector2.zero, new Vector2(156, c.sizeDelta.y), () => { nickBots.text = nickLan.text; Join(ipField.text); }, Style.Secondary, 28)
            .GetComponent<RectTransform>().pivot = new Vector2(1, 0.5f);
        y -= 112;
        tHosts = Label(pageLan, "hosts", new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(780, 40), 28, TextAnchor.MiddleLeft, "Поиск игр в сети…", Body, Muted);
        hostList = Node(pageLan, "list", new Vector2(0.5f, 1), new Vector2(0, y - 40), new Vector2(780, 10), new Vector2(0.5f, 1));
        Btn(pageLan, "СОЗДАТЬ ИГРУ", new Vector2(0.5f, 0), new Vector2(0, 40), new Vector2(780, 104), () => { nickBots.text = nickLan.text; Host(); }, Style.Primary, 40, IconWifi)
            .GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);

        tMenuStatus = Label(menu, "status", new Vector2(1, 0), new Vector2(-110, 40), new Vector2(880, 40), 28, TextAnchor.LowerRight, "", Body, Danger);
        tMenuStatus.rectTransform.pivot = new Vector2(1, 0);
        ShowPage(0);
    }

    RectTransform Card(Transform parent, string name, string title, string sub)
    {
        var r = Node(parent, name, new Vector2(1, 0.5f), new Vector2(-110, -20), new Vector2(860, 800), new Vector2(1, 0.5f));
        PanelImg(r, new Color(0.04f, 0.045f, 0.055f, 0.86f));
        Img(Node(r, "top", new Vector2(0.5f, 1), Vector2.zero, new Vector2(860, 6), new Vector2(0.5f, 1)), Accent);
        Label(r, "title", new Vector2(0, 1), new Vector2(40, -34), new Vector2(780, 60), 50, TextAnchor.UpperLeft, title, Title).rectTransform.pivot = new Vector2(0, 1);
        var s = Label(r, "sub", new Vector2(0, 1), new Vector2(40, -102), new Vector2(780, 70), 28, TextAnchor.UpperLeft, sub, BodyReg, Muted, false);
        s.rectTransform.pivot = new Vector2(0, 1); s.horizontalOverflow = HorizontalWrapMode.Wrap;
        return r;
    }

    void ShowPage(int k)
    {
        pageBots.gameObject.SetActive(k == 0); pageLan.gameObject.SetActive(k == 1);
        for (int i = 0; i < navMarks.Count; i++)
        {
            bool on = i == k;
            navMarks[i].enabled = on;
            navTexts[i].color = on ? Fg : Muted;
            navIcons[i].color = on ? Accent : Muted;
        }
        if (k == 1) tMyIp.text = LocalIp();
    }

    // ================================================================ settings
    void BuildSettings()
    {
        settings = Stretch(root, "Settings");
        Img(settings, new Color(0, 0, 0, 0.86f), null, true);
        var card = Node(settings, "card", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1240, 900));
        PanelImg(card, new Color(0.04f, 0.045f, 0.055f, 1f));
        Img(Node(card, "top", new Vector2(0.5f, 1), Vector2.zero, new Vector2(1240, 6), new Vector2(0.5f, 1)), Accent);
        Label(card, "title", new Vector2(0, 1), new Vector2(50, -36), new Vector2(600, 60), 50, TextAnchor.UpperLeft, "НАСТРОЙКИ", Title).rectTransform.pivot = new Vector2(0, 1);

        string[] tabs = { "ГРАФИКА", "УПРАВЛЕНИЕ", "ЗВУК" };
        for (int i = 0; i < tabs.Length; i++)
        {
            int k = i;
            var r = Node(card, "tab" + i, new Vector2(0, 1), new Vector2(50 + i * 290, -120), new Vector2(276, 70), new Vector2(0, 1));
            var img = Img(r, PanelLight, Round, true);
            var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = img; b.transition = Selectable.Transition.None;
            var t = Label(r, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(260, 70), 30, TextAnchor.MiddleCenter, tabs[i], Title, Muted, false);
            b.onClick.AddListener(() => { ShowTab(k); Fx.Sound2D("click", 0.5f); });
            tabImgs.Add(img); tabTexts.Add(t);
        }
        settingsPages = new RectTransform[3];
        for (int i = 0; i < 3; i++)
        {
            settingsPages[i] = Node(card, "page" + i, new Vector2(0.5f, 1), new Vector2(0, -220), new Vector2(1140, 560), new Vector2(0.5f, 1));
        }
        const float RW = 1140;
        // graphics
        var p = settingsPages[0]; float y = 0; RectTransform c;
        c = SetRow(p, "Качество графики", y, RW, out _);
        settingsRefresh.Add(Segmented(c, GameSettings.PresetNames, () => (int)GameSettings.Graphics, i => { GameSettings.Graphics = (GameSettings.Preset)i; SaveApply(); }));
        y -= 92;
        tPresetInfo = Label(p, "presetInfo", new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(RW - 16, 90), 26, TextAnchor.UpperLeft, "", BodyReg, Muted, false);
        tPresetInfo.horizontalOverflow = HorizontalWrapMode.Wrap; tPresetInfo.rectTransform.pivot = new Vector2(0.5f, 1);
        y -= 96; c = SetRow(p, "Постобработка (цвет, свечение, сглаживание)", y, RW, out _);
        settingsRefresh.Add(SwitchCtl(c, () => GameSettings.PostFx, v => { GameSettings.PostFx = v; SaveApply(); }));
        y -= 92; c = SetRow(p, "Показывать FPS и время кадра", y, RW, out _);
        settingsRefresh.Add(SwitchCtl(c, () => GameSettings.ShowFps, v => { GameSettings.ShowFps = v; SaveApply(); }));
        // controls
        p = settingsPages[1]; y = 0;
        c = SetRow(p, "Чувствительность обзора", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 0.3f, 3f, () => GameSettings.Sensitivity, v => { GameSettings.Sensitivity = v; GameSettings.Save(); }, v => v.ToString("0.00")));
        y -= 92; c = SetRow(p, "Поле зрения", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 60f, 90f, () => GameSettings.Fov, v => { GameSettings.Fov = Mathf.Round(v); GameSettings.Save(); }, v => Mathf.RoundToInt(v) + "°"));
        y -= 92; c = SetRow(p, "Инверсия по вертикали", y, RW, out _);
        settingsRefresh.Add(SwitchCtl(c, () => GameSettings.InvertY, v => { GameSettings.InvertY = v; GameSettings.Save(); }));
        y -= 92; c = SetRow(p, "Размер сенсорных кнопок", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 0.7f, 1.4f, () => GameSettings.ButtonScale, v => { GameSettings.ButtonScale = v; GameSettings.Save(); ApplyButtonScale(); }, v => Mathf.RoundToInt(v * 100) + "%"));
        y -= 110;
        var help = Label(p, "keys", new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(RW - 16, 160), 26, TextAnchor.UpperLeft,
            "Клавиатура: WASD — движение, мышь — обзор и огонь, ПКМ — прицел, R — перезарядка, 1–4 / Q — оружие, Ctrl — присесть, Shift — шаг, E — бомба, B — магазин, Tab — счёт, Esc — меню.",
            BodyReg, Muted, false);
        help.horizontalOverflow = HorizontalWrapMode.Wrap; help.rectTransform.pivot = new Vector2(0.5f, 1);
        // sound
        p = settingsPages[2]; y = 0;
        c = SetRow(p, "Общая громкость", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 0f, 1f, () => GameSettings.MasterVolume, v => { GameSettings.MasterVolume = v; GameSettings.Save(); AudioListener.volume = v; }, v => Mathf.RoundToInt(v * 100) + "%"));
        y -= 92; c = SetRow(p, "Выстрелы и эффекты", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 0f, 1f, () => GameSettings.SfxVolume, v => { GameSettings.SfxVolume = v; GameSettings.Save(); }, v => Mathf.RoundToInt(v * 100) + "%"));
        y -= 92; c = SetRow(p, "Голоса (крики, ранения)", y, RW, out _);
        settingsRefresh.Add(SliderCtl(c, 0f, 1f, () => GameSettings.VoiceVolume, v => { GameSettings.VoiceVolume = v; GameSettings.Save(); }, v => Mathf.RoundToInt(v * 100) + "%"));
        y -= 110;
        var snd = Label(p, "sndInfo", new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(RW - 16, 120), 26, TextAnchor.UpperLeft,
            "Все звуки игры — настоящие записи (выстрелы, шаги, попадания), без синтеза. Авторы указаны в списке лицензий.", BodyReg, Muted, false);
        snd.horizontalOverflow = HorizontalWrapMode.Wrap; snd.rectTransform.pivot = new Vector2(0.5f, 1);

        Btn(card, "ГОТОВО", new Vector2(0.5f, 0), new Vector2(0, 40), new Vector2(420, 96), CloseSettings, Style.Primary, 36)
            .GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);
        settings.gameObject.SetActive(false);
        ShowTab(0);
    }

    void SaveApply() { GameSettings.Save(); GameSettings.Apply(); UpdatePresetInfo(); }

    void UpdatePresetInfo()
    {
        if (tPresetInfo == null) return;
        tPresetInfo.text = new[]
        {
            "Низкое: 70% разрешения, тени до 25 м, без сглаживания и затенения углов, текстуры вполовину. Для слабых телефонов.",
            "Среднее: 85% разрешения, тени до 45 м, сглаживание 2×, затенение углов (SSAO). Рекомендуется для большинства телефонов.",
            "Высокое: полное разрешение, тени до 70 м, сглаживание 4×, затенение углов, HDR. Для мощных телефонов.",
        }[(int)GameSettings.Graphics];
    }

    void ShowTab(int k)
    {
        for (int i = 0; i < settingsPages.Length; i++) settingsPages[i].gameObject.SetActive(i == k);
        for (int i = 0; i < tabImgs.Count; i++) { tabImgs[i].color = i == k ? Accent : PanelLight; tabTexts[i].color = i == k ? AccentDark : Muted; }
    }

    void OpenSettings()
    {
        GameSettings.Load();
        foreach (var r in settingsRefresh) r();
        UpdatePresetInfo();
        settings.gameObject.SetActive(true); settings.SetAsLastSibling();
    }

    void CloseSettings() { GameSettings.Save(); settings.gameObject.SetActive(false); }

    // ================================================================ loading
    void BuildLoading()
    {
        loading = Stretch(root, "Loading");
        Img(loading, new Color(0.03f, 0.035f, 0.04f, 1f), null, true);
        var glow = Stretch(loading, "glow"); Img(glow, new Color(Accent.r, Accent.g, Accent.b, 0.10f), GradV);
        Label(loading, "map", new Vector2(0, 0.5f), new Vector2(140, 120), new Vector2(1400, 140), 120, TextAnchor.MiddleLeft, "СТАРЫЙ ГОРОД", Title).rectTransform.pivot = new Vector2(0, 0.5f);
        Label(loading, "mode", new Vector2(0, 0.5f), new Vector2(146, 20), new Vector2(1400, 50), 34, TextAnchor.MiddleLeft, "ЗАКЛАДКА БОМБЫ  ·  СПЕЦНАЗ ПРОТИВ БАНДЫ  ·  ДО 13 ПОБЕД", Body, Accent).rectTransform.pivot = new Vector2(0, 0.5f);
        var tip = Node(loading, "tip", new Vector2(0, 0), new Vector2(140, 170), new Vector2(1100, 110), new Vector2(0, 0));
        PanelImg(tip, PanelLight);
        Label(tip, "h", new Vector2(0, 1), new Vector2(30, -14), new Vector2(300, 34), 26, TextAnchor.UpperLeft, "СОВЕТ", Title, Accent).rectTransform.pivot = new Vector2(0, 1);
        tLoadTip = Label(tip, "t", new Vector2(0, 1), new Vector2(30, -50), new Vector2(1040, 60), 30, TextAnchor.UpperLeft, "", BodyReg, Fg, false);
        tLoadTip.rectTransform.pivot = new Vector2(0, 1); tLoadTip.horizontalOverflow = HorizontalWrapMode.Wrap;
        tLoadState = Label(loading, "state", new Vector2(1, 0), new Vector2(-140, 120), new Vector2(700, 40), 30, TextAnchor.LowerRight, "Загрузка карты…", Body, Muted);
        tLoadState.rectTransform.pivot = new Vector2(1, 0);
        var track = Node(loading, "track", new Vector2(0.5f, 0), new Vector2(0, 80), new Vector2(W - 280, 8), new Vector2(0.5f, 0));
        Img(track, new Color(1, 1, 1, 0.1f), RoundSmall);
        var mask = track.gameObject.AddComponent<RectMask2D>(); mask.enabled = true;
        loadStripe = Node(track, "stripe", new Vector2(0, 0.5f), Vector2.zero, new Vector2(360, 8), new Vector2(0, 0.5f));
        Img(loadStripe, Accent, RoundSmall);
        loading.gameObject.SetActive(false);
    }

    void ShowLoading(string state)
    {
        loadingActive = true; loadingSince = Time.unscaledTime;
        tLoadState.text = state; tLoadTip.text = Tips[Random.Range(0, Tips.Length)];
        loading.gameObject.SetActive(true); loading.SetAsLastSibling();
    }

    void HideLoading() { loadingActive = false; if (loading != null) loading.gameObject.SetActive(false); }

    // ================================================================ in-game HUD
    void BuildHud()
    {
        hud = Stretch(root, "Hud");
        dmg = Img(Stretch(hud, "Damage"), new Color(0.75f, 0.02f, 0.02f, 0), Vignette);
        scope = Stretch(hud, "Scope");
        var sm = Node(scope, "mask", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(H, H)); Img(sm, Color.black, ScopeMask);
        Img(Node(scope, "L", new Vector2(0.5f, 0.5f), new Vector2(-H / 2f + 2, 0), new Vector2(2400, H * 1.2f), new Vector2(1, 0.5f)), Color.black);
        Img(Node(scope, "R", new Vector2(0.5f, 0.5f), new Vector2(H / 2f - 2, 0), new Vector2(2400, H * 1.2f), new Vector2(0, 0.5f)), Color.black);
        Img(Node(scope, "H", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(H, 2)), Color.black);
        Img(Node(scope, "V", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(2, H)), Color.black);

        cross = Node(hud, "Cross", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(60, 60)).gameObject;
        foreach (var v in new[] { new Vector4(-13, 0, 14, 3), new Vector4(13, 0, 14, 3), new Vector4(0, 13, 3, 14), new Vector4(0, -13, 3, 14) })
        {
            Img(Node(cross.transform, "o", new Vector2(0.5f, 0.5f), new Vector2(v.x, v.y), new Vector2(v.z + 2, v.w + 2)), new Color(0, 0, 0, 0.55f));
            Img(Node(cross.transform, "c", new Vector2(0.5f, 0.5f), new Vector2(v.x, v.y), new Vector2(v.z, v.w)), new Color(0.45f, 1f, 0.55f, 0.95f));
        }
        hitMark = Img(Node(hud, "Hit", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(30, 30)), new Color(1, 1, 1, 0), IconDead);

        // --- top centre: score and timer
        var top = Node(hud, "Top", new Vector2(0.5f, 1), new Vector2(0, -18), new Vector2(560, 120), new Vector2(0.5f, 1));
        var pT = Node(top, "T", new Vector2(0.5f, 1), new Vector2(-170, 0), new Vector2(124, 74), new Vector2(0.5f, 1)); PanelImg(pT);
        Img(Node(pT, "bar", new Vector2(0.5f, 0), Vector2.zero, new Vector2(124, 5), new Vector2(0.5f, 0)), Band);
        tScoreT = Label(pT, "s", new Vector2(0.5f, 0.5f), new Vector2(0, 2), new Vector2(124, 74), 48, TextAnchor.MiddleCenter, "0", Title, Band);
        var pC = Node(top, "CT", new Vector2(0.5f, 1), new Vector2(170, 0), new Vector2(124, 74), new Vector2(0.5f, 1)); PanelImg(pC);
        Img(Node(pC, "bar", new Vector2(0.5f, 0), Vector2.zero, new Vector2(124, 5), new Vector2(0.5f, 0)), Ct);
        tScoreCT = Label(pC, "s", new Vector2(0.5f, 0.5f), new Vector2(0, 2), new Vector2(124, 74), 48, TextAnchor.MiddleCenter, "0", Title, Ct);
        var pm = Node(top, "Timer", new Vector2(0.5f, 1), Vector2.zero, new Vector2(200, 74), new Vector2(0.5f, 1)); timerBg = PanelImg(pm);
        tTimer = Label(pm, "t", new Vector2(0.5f, 0.5f), new Vector2(0, 2), new Vector2(200, 74), 46, TextAnchor.MiddleCenter, "1:55", Title);
        tPhase = Label(top, "phase", new Vector2(0.5f, 1), new Vector2(0, -80), new Vector2(400, 34), 26, TextAnchor.UpperCenter, "", Body, Muted);
        tAliveT = Label(top, "aliveT", new Vector2(0.5f, 1), new Vector2(-170, -80), new Vector2(160, 30), 22, TextAnchor.UpperCenter, "", Body, Muted, false);
        tAliveCT = Label(top, "aliveCT", new Vector2(0.5f, 1), new Vector2(170, -80), new Vector2(160, 30), 22, TextAnchor.UpperCenter, "", Body, Muted, false);
        for (int i = 0; i < 5; i++)
        {
            pipsT[i] = Img(Node(top, "pt" + i, new Vector2(0.5f, 1), new Vector2(-232 - i * 26 - 40, -20), new Vector2(18, 34), new Vector2(0.5f, 1)), Band, RoundSmall);
            pipsCT[i] = Img(Node(top, "pc" + i, new Vector2(0.5f, 1), new Vector2(232 + i * 26 + 40, -20), new Vector2(18, 34), new Vector2(0.5f, 1)), Ct, RoundSmall);
        }
        bombBadge = Node(top, "bomb", new Vector2(0.5f, 1), new Vector2(0, -118), new Vector2(64, 64), new Vector2(0.5f, 1));
        Img(bombBadge, Danger, IconBomb);

        // --- bottom left: health and armour
        var hp = Node(hud, "Health", new Vector2(0, 0), new Vector2(36, 28), new Vector2(430, 96), new Vector2(0, 0)); PanelImg(hp);
        Icon(hp, IconHealth, new Vector2(0, 0.5f), new Vector2(42, 6), 38, Fg);
        tHealth = Label(hp, "hp", new Vector2(0, 0.5f), new Vector2(72, 6), new Vector2(140, 80), 58, TextAnchor.MiddleLeft, "100", Title);
        tHealth.rectTransform.pivot = new Vector2(0, 0.5f);
        Icon(hp, IconArmor, new Vector2(0, 0.5f), new Vector2(252, 6), 36, Muted);
        tArmor = Label(hp, "ar", new Vector2(0, 0.5f), new Vector2(280, 6), new Vector2(140, 80), 46, TextAnchor.MiddleLeft, "0", Title, Muted);
        tArmor.rectTransform.pivot = new Vector2(0, 0.5f);
        var hb = Node(hp, "hbBg", new Vector2(0, 0), new Vector2(24, 14), new Vector2(190, 6), new Vector2(0, 0)); Img(hb, new Color(1, 1, 1, 0.12f), RoundSmall);
        healthBar = Img(Node(hb, "f", new Vector2(0, 0.5f), Vector2.zero, new Vector2(190, 6), new Vector2(0, 0.5f)), Fg, RoundSmall);
        var ab = Node(hp, "abBg", new Vector2(0, 0), new Vector2(234, 14), new Vector2(170, 6), new Vector2(0, 0)); Img(ab, new Color(1, 1, 1, 0.12f), RoundSmall);
        armorBar = Img(Node(ab, "f", new Vector2(0, 0.5f), Vector2.zero, new Vector2(170, 6), new Vector2(0, 0.5f)), Ct, RoundSmall);

        // --- bottom right: ammo and weapon
        var am = Node(hud, "Ammo", new Vector2(1, 0), new Vector2(-36, 28), new Vector2(380, 96), new Vector2(1, 0)); PanelImg(am);
        tAmmo = Label(am, "mag", new Vector2(1, 0.5f), new Vector2(-150, 6), new Vector2(200, 80), 60, TextAnchor.MiddleRight, "30", Title);
        tAmmo.rectTransform.pivot = new Vector2(1, 0.5f);
        tReserve = Label(am, "res", new Vector2(1, 0.5f), new Vector2(-26, 0), new Vector2(120, 80), 36, TextAnchor.MiddleRight, "/ 90", Title, Muted);
        tReserve.rectTransform.pivot = new Vector2(1, 0.5f);
        tWeapon = Label(hud, "Weapon", new Vector2(1, 0), new Vector2(-46, 134), new Vector2(600, 40), 30, TextAnchor.LowerRight, "", Body, Fg);
        tWeapon.rectTransform.pivot = new Vector2(1, 0);

        // --- top left: money; top right: kill feed
        var mo = Node(hud, "Money", new Vector2(0, 1), new Vector2(150, -24), new Vector2(250, 64), new Vector2(0, 1)); PanelImg(mo);
        tMoney = Label(mo, "m", new Vector2(0.5f, 0.5f), new Vector2(0, 2), new Vector2(240, 64), 36, TextAnchor.MiddleCenter, "", Title, Money);
        for (int i = 0; i < feedRows.Length; i++)
        {
            feedRows[i] = Node(hud, "feed" + i, new Vector2(1, 1), new Vector2(-30, -70 - i * 52), new Vector2(640, 46), new Vector2(1, 1));
            PanelImg(feedRows[i], new Color(0.03f, 0.035f, 0.045f, 0.72f));
            feedTexts[i] = Label(feedRows[i], "t", new Vector2(1, 0.5f), new Vector2(-18, 1), new Vector2(620, 46), 27, TextAnchor.MiddleRight, "", Body, Fg, false);
            feedTexts[i].rectTransform.pivot = new Vector2(1, 0.5f);
        }

        // --- centre: banner, hint, plant/defuse bar, death panel
        bannerPanel = Node(hud, "Banner", new Vector2(0.5f, 1), new Vector2(0, -200), new Vector2(1100, 140), new Vector2(0.5f, 1));
        PanelImg(bannerPanel, new Color(0.03f, 0.035f, 0.045f, 0.86f));
        bannerBar = Img(Node(bannerPanel, "bar", new Vector2(0.5f, 1), Vector2.zero, new Vector2(1100, 6), new Vector2(0.5f, 1)), Accent);
        tBanner = Label(bannerPanel, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1060, 130), 44, TextAnchor.MiddleCenter, "", Title);
        tBanner.horizontalOverflow = HorizontalWrapMode.Wrap; tBanner.lineSpacing = 1.05f;
        hintPanel = Node(hud, "Hint", new Vector2(0.5f, 0), new Vector2(0, 250), new Vector2(820, 56), new Vector2(0.5f, 0));
        PanelImg(hintPanel, new Color(0.03f, 0.035f, 0.045f, 0.7f));
        tHint = Label(hintPanel, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(800, 56), 30, TextAnchor.MiddleCenter, "", Body);
        var bar = Node(hud, "UseBar", new Vector2(0.5f, 0), new Vector2(0, 216), new Vector2(520, 14), new Vector2(0.5f, 0)); Img(bar, new Color(0, 0, 0, 0.6f), RoundSmall);
        useBar = Node(bar, "fill", new Vector2(0, 0.5f), Vector2.zero, new Vector2(0, 14), new Vector2(0, 0.5f)); Img(useBar, Accent, RoundSmall);
        deadPanel = Node(hud, "Dead", new Vector2(0.5f, 0), new Vector2(0, 150), new Vector2(760, 110), new Vector2(0.5f, 0));
        PanelImg(deadPanel, new Color(0.03f, 0.035f, 0.045f, 0.82f));
        Icon(deadPanel, IconDead, new Vector2(0, 0.5f), new Vector2(60, 0), 44, Danger);
        Label(deadPanel, "h", new Vector2(0, 0.5f), new Vector2(110, 16), new Vector2(620, 50), 40, TextAnchor.MiddleLeft, "ВЫ УБИТЫ", Title, Danger).rectTransform.pivot = new Vector2(0, 0.5f);
        tDead = Label(deadPanel, "t", new Vector2(0, 0.5f), new Vector2(112, -26), new Vector2(620, 40), 28, TextAnchor.MiddleLeft, "", Body, Muted, false);
        tDead.rectTransform.pivot = new Vector2(0, 0.5f);

        // --- touch controls
        touchRoot = Stretch(hud, "Touch");
        joyBase = Node(touchRoot, "JoyBase", new Vector2(0, 0), new Vector2(260, 270), new Vector2(280, 280)); joyBase.pivot = new Vector2(0.5f, 0.5f);
        Img(joyBase, new Color(1, 1, 1, 0.08f), Circle); Img(Node(joyBase, "ring", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(280, 280)), new Color(1, 1, 1, 0.25f), Ring);
        joyKnob = Node(joyBase, "Knob", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(116, 116)); Img(joyKnob, new Color(1, 1, 1, 0.35f), Circle);

        TouchBtn("fire", "ОГОНЬ", new Vector2(1, 0), new Vector2(-200, 230), 220, true);
        TouchBtn("fire2", "ОГОНЬ", new Vector2(0, 0), new Vector2(110, 600), 150, true);
        TouchBtn("jump", "ПРЫЖОК", new Vector2(1, 0), new Vector2(-70, 470), 140);
        TouchBtn("crouch", "СЕСТЬ", new Vector2(1, 0), new Vector2(-460, 140), 140);
        TouchBtn("reload", "ПЕРЕЗ.", new Vector2(1, 0), new Vector2(-450, 320), 130);
        TouchBtn("next", "ОРУЖИЕ", new Vector2(1, 0), new Vector2(-260, 480), 130);
        TouchBtn("zoom", "ПРИЦЕЛ", new Vector2(1, 0), new Vector2(-70, 650), 130);
        TouchBtn("use", "БОМБА", new Vector2(0.5f, 0), new Vector2(0, 330), 150, true);
        TouchBtn("buy", "МАГАЗИН", new Vector2(0, 1), new Vector2(230, -200), 140);
        TouchBtn("score", "СЧЁТ", new Vector2(1, 1), new Vector2(-1000, -70), 96);
        TouchBtn("menu", "МЕНЮ", new Vector2(0, 1), new Vector2(76, -66), 96);
        ApplyButtonScale();
    }

    RectTransform TouchBtn(string id, string label, Vector2 anchor, Vector2 pos, float size, bool accent = false)
    {
        var r = Node(touchRoot, id, anchor, pos, new Vector2(size, size), new Vector2(0.5f, 0.5f));
        Img(r, new Color(0.03f, 0.035f, 0.045f, 0.35f), Circle);
        Img(Node(r, "ring", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(size, size)), accent ? new Color(Accent.r, Accent.g, Accent.b, 0.85f) : new Color(1, 1, 1, 0.45f), Ring);
        Label(r, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(size, size), Mathf.RoundToInt(size * 0.17f), TextAnchor.MiddleCenter, label, Title, new Color(1, 1, 1, 0.9f));
        btn[id] = r;
        return r;
    }

    void ApplyButtonScale()
    {
        float s = Mathf.Clamp(GameSettings.ButtonScale, 0.5f, 2f);
        foreach (var kv in btn) kv.Value.localScale = Vector3.one * s;
        if (joyBase != null) joyBase.localScale = Vector3.one * s;
    }

    // ================================================================ buy menu
    void BuildBuy()
    {
        buy = Stretch(root, "Buy");
        Img(buy, new Color(0, 0, 0, 0.86f), null, true);
        var card = Node(buy, "card", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1820, 1000)); PanelImg(card, new Color(0.04f, 0.045f, 0.055f, 1f));
        Img(Node(card, "top", new Vector2(0.5f, 1), Vector2.zero, new Vector2(1820, 6), new Vector2(0.5f, 1)), Accent);
        Label(card, "title", new Vector2(0, 1), new Vector2(50, -30), new Vector2(600, 60), 50, TextAnchor.UpperLeft, "МАГАЗИН", Title).rectTransform.pivot = new Vector2(0, 1);
        tBuyMoney = Label(card, "money", new Vector2(1, 1), new Vector2(-50, -34), new Vector2(700, 60), 44, TextAnchor.UpperRight, "", Title, Money);
        tBuyMoney.rectTransform.pivot = new Vector2(1, 1);
        string[] groups = { "ПИСТОЛЕТЫ", "ДРОБОВИКИ И ПП", "АВТОМАТЫ", "СНАЙПЕРСКИЕ И СНАРЯЖЕНИЕ" };
        int[][] ids = { new[] { 1, 2, 3, 4, 5, 6 }, new[] { 7, 8, 9, 10, 11, 12, 13 }, new[] { 14, 15, 16, 17, 18, 19 }, new[] { 20, 21, 22, 23, 24, 100 } };
        for (int g = 0; g < 4; g++)
        {
            float x = 50 + g * 436;
            Label(card, "g" + g, new Vector2(0, 1), new Vector2(x + 6, -120), new Vector2(420, 40), 28, TextAnchor.UpperLeft, groups[g], Title, Accent).rectTransform.pivot = new Vector2(0, 1);
            for (int i = 0; i < ids[g].Length; i++)
            {
                int id = ids[g][i];
                string name = id == 100 ? "Бронежилет" : Weapons.Get(id).title;
                int price = id == 100 ? 650 : Weapons.Get(id).price;
                var b = Btn(card, "", new Vector2(0, 1), new Vector2(x, -170 - i * 96), new Vector2(420, 86), () => { InputState.I.buy = id; }, Style.Secondary, 30);
                b.GetComponent<RectTransform>().pivot = new Vector2(0, 1);
                var t = b.GetComponentInChildren<Text>(); t.alignment = TextAnchor.MiddleLeft; t.font = Body; t.fontSize = 32; t.text = name;
                t.rectTransform.sizeDelta = new Vector2(380, 86);
                var pr = Label(b.transform, "price", new Vector2(1, 0.5f), new Vector2(-22, 0), new Vector2(160, 86), 30, TextAnchor.MiddleRight, price.ToString(), Title, Money, false);
                pr.rectTransform.pivot = new Vector2(1, 0.5f);
                buyButtons.Add(b); buyPrices.Add(price);
            }
        }
        Btn(card, "ЗАКРЫТЬ", new Vector2(0.5f, 0), new Vector2(0, 34), new Vector2(420, 90), () => buy.gameObject.SetActive(false), Style.Primary, 34)
            .GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);
        buy.gameObject.SetActive(false);
    }

    // ================================================================ pause
    void BuildPause()
    {
        pause = Stretch(root, "Pause");
        Img(pause, new Color(0, 0, 0, 0.86f), null, true);
        var card = Node(pause, "card", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(760, 720)); PanelImg(card, new Color(0.04f, 0.045f, 0.055f, 1f));
        Img(Node(card, "top", new Vector2(0.5f, 1), Vector2.zero, new Vector2(760, 6), new Vector2(0.5f, 1)), Accent);
        Label(card, "title", new Vector2(0.5f, 1), new Vector2(0, -40), new Vector2(700, 60), 52, TextAnchor.UpperCenter, "МЕНЮ", Title);
        tInfo = Label(card, "info", new Vector2(0.5f, 1), new Vector2(0, -120), new Vector2(680, 90), 28, TextAnchor.UpperCenter, "", BodyReg, Muted, false);
        tInfo.horizontalOverflow = HorizontalWrapMode.Wrap;
        Btn(card, "ПРОДОЛЖИТЬ", new Vector2(0.5f, 1), new Vector2(0, -230), new Vector2(600, 96), () => pause.gameObject.SetActive(false), Style.Primary, 36, IconPlay);
        Btn(card, "СЧЁТ МАТЧА", new Vector2(0.5f, 1), new Vector2(0, -340), new Vector2(600, 96), () => { pause.gameObject.SetActive(false); boardToggle = true; }, Style.Secondary, 34);
        Btn(card, "НАСТРОЙКИ", new Vector2(0.5f, 1), new Vector2(0, -450), new Vector2(600, 96), OpenSettings, Style.Secondary, 34, IconGear);
        Btn(card, "ВЫЙТИ В МЕНЮ", new Vector2(0.5f, 1), new Vector2(0, -560), new Vector2(600, 96), Leave, Style.Secondary, 34, IconExit);
        pause.gameObject.SetActive(false);
    }
    bool boardToggle;

    // ================================================================ scoreboard
    void BuildBoard()
    {
        board = Node(root, "Board", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1240, 800));
        PanelImg(board, new Color(0.035f, 0.04f, 0.05f, 0.93f));
        tBoardTitle = Label(board, "title", new Vector2(0, 1), new Vector2(40, -26), new Vector2(1160, 50), 36, TextAnchor.UpperLeft, "", Title);
        tBoardTitle.rectTransform.pivot = new Vector2(0, 1);
        var hdr = Node(board, "cols", new Vector2(0.5f, 1), new Vector2(0, -80), new Vector2(1160, 30), new Vector2(0.5f, 1));
        ColTexts(hdr, "ИГРОК", "УБ.", "СМ.", "ДЕНЬГИ", Muted, 24);
        BuildTeamBlock(-116, out tBoardHeadA, out boardBarA, rowsA);
        BuildTeamBlock(-458, out tBoardHeadB, out boardBarB, rowsB);
        board.gameObject.SetActive(false);
    }

    void BuildTeamBlock(float y, out Text head, out Image bar, Row[] rows)
    {
        var h = Node(board, "head", new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(1160, 52), new Vector2(0.5f, 1));
        Img(h, new Color(1, 1, 1, 0.05f), RoundSmall);
        bar = Img(Node(h, "bar", new Vector2(0, 0.5f), Vector2.zero, new Vector2(8, 52), new Vector2(0, 0.5f)), Band);
        head = Label(h, "t", new Vector2(0, 0.5f), new Vector2(24, 0), new Vector2(1100, 52), 32, TextAnchor.MiddleLeft, "", Title);
        head.rectTransform.pivot = new Vector2(0, 0.5f);
        for (int i = 0; i < rows.Length; i++)
        {
            var r = Node(board, "row", new Vector2(0.5f, 1), new Vector2(0, y - 58 - i * 46), new Vector2(1160, 42), new Vector2(0.5f, 1));
            var row = new Row { r = r, bg = Img(r, new Color(1, 1, 1, 0.03f), RoundSmall) };
            row.mark = Img(Node(r, "mark", new Vector2(0, 0.5f), new Vector2(30, 0), new Vector2(26, 26)), Danger, IconDead);
            var texts = ColTexts(r, "", "", "", "", Fg, 30);
            row.name = texts[0]; row.k = texts[1]; row.d = texts[2]; row.money = texts[3];
            rows[i] = row;
        }
    }

    static Text[] ColTexts(RectTransform parent, string a, string b, string c, string d, Color col, int size)
    {
        float h = parent.sizeDelta.y;
        var t0 = Label(parent, "name", new Vector2(0, 0.5f), new Vector2(64, 0), new Vector2(620, h), size, TextAnchor.MiddleLeft, a, Body, col, false); t0.rectTransform.pivot = new Vector2(0, 0.5f);
        var t1 = Label(parent, "k", new Vector2(0, 0.5f), new Vector2(760, 0), new Vector2(100, h), size, TextAnchor.MiddleCenter, b, Body, col, false);
        var t2 = Label(parent, "d", new Vector2(0, 0.5f), new Vector2(880, 0), new Vector2(100, h), size, TextAnchor.MiddleCenter, c, Body, col, false);
        var t3 = Label(parent, "m", new Vector2(1, 0.5f), new Vector2(-24, 0), new Vector2(200, h), size, TextAnchor.MiddleRight, d, Body, col, false); t3.rectTransform.pivot = new Vector2(1, 0.5f);
        return new[] { t0, t1, t2, t3 };
    }

    readonly List<Player> sortBuf = new List<Player>();
    void DrawBoard(Game g)
    {
        var me = Player.Local;
        int myTeam = me != null ? me.Team.Value : 2;
        int round = g.ScoreT.Value + g.ScoreCT.Value + (g.Phase == Phase.End ? 0 : 1);
        tBoardTitle.text = $"СТАРЫЙ ГОРОД  <color=#{Hex(Muted)}>·  раунд {Mathf.Max(1, round)}  ·  до {Game.WinRounds} побед</color>";
        // own team first
        FillTeam(myTeam, tBoardHeadA, boardBarA, rowsA, g, me);
        FillTeam(3 - myTeam, tBoardHeadB, boardBarB, rowsB, g, me);
    }

    void FillTeam(int team, Text head, Image bar, Row[] rows, Game g, Player me)
    {
        int score = team == 1 ? g.ScoreT.Value : g.ScoreCT.Value, alive = 0;
        sortBuf.Clear();
        foreach (var p in Player.All) if (p.Team.Value == team) { sortBuf.Add(p); if (p.Alive) alive++; }
        sortBuf.Sort((a, b) => b.Kills.Value != a.Kills.Value ? b.Kills.Value.CompareTo(a.Kills.Value) : a.Deaths.Value.CompareTo(b.Deaths.Value));
        Color tc = TeamColor(team);
        head.text = $"<color=#{Hex(tc)}>{TeamName(team).ToUpper()}</color>   {score}   <size=24><color=#{Hex(Muted)}>в живых {alive} из {sortBuf.Count}</color></size>";
        bar.color = tc;
        bool showMoney = me != null && me.Team.Value == team;
        for (int i = 0; i < rows.Length; i++)
        {
            var row = rows[i];
            bool used = i < sortBuf.Count;
            row.r.gameObject.SetActive(used);
            if (!used) continue;
            var p = sortBuf[i];
            bool isMe = p == me;
            row.bg.color = isMe ? new Color(tc.r, tc.g, tc.b, 0.18f) : new Color(1, 1, 1, i % 2 == 0 ? 0.035f : 0.015f);
            Color col = p.Alive ? Fg : Muted;
            row.mark.enabled = !p.Alive;
            row.name.text = p.Nick.Value + (p.IsBot.Value ? $"  <size=22><color=#{Hex(Muted)}>бот</color></size>" : "") + (showMoney && p.HasBomb.Value ? $"  <color=#{Hex(Danger)}>● бомба</color>" : "");
            row.name.color = col; row.k.color = col; row.d.color = col;
            row.k.text = p.Kills.Value.ToString(); row.d.text = p.Deaths.Value.ToString();
            row.money.text = showMoney ? p.Money.Value.ToString() : "";
            row.money.color = Money;
        }
    }

    // ================================================================ match end
    void BuildMatchEnd()
    {
        matchEnd = Stretch(root, "MatchEnd");
        Img(matchEnd, new Color(0.02f, 0.025f, 0.03f, 0.94f), null, true);
        endGlow = Img(Stretch(matchEnd, "glow"), new Color(Accent.r, Accent.g, Accent.b, 0.16f), GradV);
        endGlow.rectTransform.localScale = new Vector3(1, -1, 1);
        tEndTitle = Label(matchEnd, "title", new Vector2(0.5f, 1), new Vector2(0, -40), new Vector2(1600, 120), 104, TextAnchor.UpperCenter, "", Title);
        tEndScore = Label(matchEnd, "score", new Vector2(0.5f, 1), new Vector2(0, -160), new Vector2(1600, 70), 56, TextAnchor.UpperCenter, "", Title);
        tEndMvp = Label(matchEnd, "mvp", new Vector2(0.5f, 1), new Vector2(0, -236), new Vector2(1600, 40), 32, TextAnchor.UpperCenter, "", Body, Accent);
        tEndNext = Label(matchEnd, "next", new Vector2(0.5f, 0), new Vector2(0, 22), new Vector2(1200, 36), 28, TextAnchor.LowerCenter, "", Body, Muted);
        Btn(matchEnd, "ВЫЙТИ В МЕНЮ", new Vector2(0.5f, 0), new Vector2(0, 66), new Vector2(420, 84), Leave, Style.Secondary, 32, IconExit)
            .GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);
        matchEnd.gameObject.SetActive(false);
    }

    bool MatchOver(Game g) => forceMatchEnd || (g.Phase == Phase.End && (g.ScoreT.Value >= Game.WinRounds || g.ScoreCT.Value >= Game.WinRounds));

    void DrawMatchEnd(Game g)
    {
        var me = Player.Local;
        int myTeam = me != null ? me.Team.Value : 2;
        int mine = myTeam == 1 ? g.ScoreT.Value : g.ScoreCT.Value, theirs = myTeam == 1 ? g.ScoreCT.Value : g.ScoreT.Value;
        bool win = mine > theirs, draw = mine == theirs;
        tEndTitle.text = draw ? "НИЧЬЯ" : win ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
        tEndTitle.color = draw ? Fg : win ? Accent : Danger;
        endGlow.color = draw ? new Color(1, 1, 1, 0.06f) : win ? new Color(Accent.r, Accent.g, Accent.b, 0.18f) : new Color(Danger.r, Danger.g, Danger.b, 0.14f);
        tEndScore.text = $"<color=#{Hex(TeamColor(myTeam))}>{TeamName(myTeam)} {mine}</color>  :  <color=#{Hex(TeamColor(3 - myTeam))}>{theirs} {TeamName(3 - myTeam)}</color>";
        Player best = null;
        foreach (var p in Player.All) if (best == null || p.Kills.Value > best.Kills.Value || (p.Kills.Value == best.Kills.Value && p.Deaths.Value < best.Deaths.Value)) best = p;
        tEndMvp.text = best != null ? $"ЛУЧШИЙ ИГРОК МАТЧА: {best.Nick.Value}  ·  {best.Kills.Value} убийств, {best.Deaths.Value} смертей" : "";
        tEndNext.text = forceMatchEnd ? "Новый матч начнётся автоматически" : $"Новый матч через {Mathf.CeilToInt(g.TimeLeft)} с";
    }

    // ================================================================ network
    string Nick()
    {
        string n = nickBots != null && pageBots.gameObject.activeSelf ? nickBots.text : nickLan != null ? nickLan.text : "";
        return string.IsNullOrWhiteSpace(n) ? "Игрок" : n.Trim();
    }
    void SaveNick() { PlayerPrefs.SetString("nick", Nick()); }

    public void Host()
    {
        if (InGame || loadingActive) return;
        SaveNick();
        ShowLoading("Загрузка карты и ботов…");
        StartCoroutine(HostNextFrame());
    }

    System.Collections.IEnumerator HostNextFrame()
    {
        // let the loading screen render before the (blocking) navigation mesh build on the first network frame
        yield return null; yield return null;
        NM.GetComponent<UnityTransport>().SetConnectionData("127.0.0.1", Port, "0.0.0.0");
        if (!NM.StartHost()) { HideLoading(); tMenuStatus.text = "Не удалось создать игру (порт занят?)"; yield break; }
        try { udpSend = new UdpClient { EnableBroadcast = true }; } catch { udpSend = null; }
    }

    public void Join(string ip)
    {
        if (InGame || connecting) return;
        ip = (ip ?? "").Trim();
        if (!IPAddress.TryParse(ip, out _)) { tMenuStatus.text = "Введите IP-адрес хоста, например 192.168.1.5"; ShowPage(1); return; }
        SaveNick(); PlayerPrefs.SetString("ip", ip);
        NM.GetComponent<UnityTransport>().SetConnectionData(ip, Port);
        connecting = NM.StartClient(); connectStart = Time.time;
        if (connecting) ShowLoading("Подключение к " + ip + "…"); else tMenuStatus.text = "Не удалось начать подключение";
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
            if (n >= 3) break;
            string ip = kv.Key;
            var b = Btn(hostList, $"{hostNames[ip]}  ·  {ip}", new Vector2(0.5f, 1), new Vector2(0, -n * 84), new Vector2(780, 74), () => Join(ip), Style.Secondary, 28, IconWifi);
            b.GetComponent<RectTransform>().pivot = new Vector2(0.5f, 1);
            n++;
        }
        tHosts.text = n == 0 ? "Поиск игр в сети…" : "Найденные игры — нажмите, чтобы войти:";
    }

    // ================================================================ frame
    void Update()
    {
        if (NM == null) return;
        Discovery();
        if (connecting && NM.IsConnectedClient) connecting = false;
        if (connecting && Time.time - connectStart > 8f) { connecting = false; NM.Shutdown(); HideLoading(); tMenuStatus.text = "Не удалось подключиться: проверьте IP и что вы в одной сети Wi-Fi"; }
        bool inGame = InGame;
        var g = Game.I; var p = Player.Local;

        if (loadingActive)
        {
            float t = (Time.unscaledTime - loadingSince) * 0.9f % 1f;
            loadStripe.anchoredPosition = new Vector2(Mathf.Lerp(-360, W - 280, t), 0);
            bool ready = inGame && p != null && g != null && g.Phase != Phase.Lobby && Time.unscaledTime - loadingSince > 0.8f;
            if (ready) HideLoading();
        }

        if (menu.gameObject.activeSelf == inGame) menu.gameObject.SetActive(!inGame);
        bool showHud = inGame && !loadingActive && !(g != null && MatchOver(g));   // the match-end screen replaces the HUD
        if (hud.gameObject.activeSelf != showHud) hud.gameObject.SetActive(showHud);
        if (!inGame)
        {
            if (buy.gameObject.activeSelf) buy.gameObject.SetActive(false);
            board.gameObject.SetActive(false); matchEnd.gameObject.SetActive(false); pause.gameObject.SetActive(false);
            MenuCamera(g);
            return;
        }
        if (g == null) return;
        bool escUsed = false;
        if (!mobile && Input.GetKeyDown(KeyCode.Escape))
        {
            if (settings.gameObject.activeSelf) { CloseSettings(); escUsed = true; }
            else if (pause.gameObject.activeSelf) { pause.gameObject.SetActive(false); escUsed = true; }
            else if (buy.gameObject.activeSelf) { buy.gameObject.SetActive(false); escUsed = true; }
        }
        bool over = MatchOver(g);
        bool overlay = buy.gameObject.activeSelf || pause.gameObject.activeSelf || settings.gameObject.activeSelf || over;
        if (overlay) { var i = InputState.I; i.move = Vector2.zero; i.fire = false; i.use = false; if (!mobile) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; } }
        else if (mobile) TouchInput(); else if (!escUsed) DesktopInput();
        if (buy.gameObject.activeSelf)
        {
            if (!g.CanBuy) buy.gameObject.SetActive(false);
            else if (p != null)
            {
                tBuyMoney.text = p.Money.Value + " сомони";
                for (int i = 0; i < buyButtons.Count; i++)
                {
                    bool can = p.Money.Value >= buyPrices[i];
                    if (buyButtons[i].interactable == can) continue;
                    buyButtons[i].interactable = can;
                    foreach (var t in buyButtons[i].GetComponentsInChildren<Text>()) { var c = t.color; c.a = can ? 1f : 0.32f; t.color = c; }
                }
            }
        }
        if (pause.gameObject.activeSelf)
            tInfo.text = NM.IsServer ? "Вы создали игру. Друзья в той же сети Wi-Fi входят по адресу " + LocalIp() : "Вы подключены к игре друга";

        matchEnd.gameObject.SetActive(over);
        bool showBoard = over || boardHeld || boardToggle || (!mobile && Input.GetKey(KeyCode.Tab));
        board.gameObject.SetActive(showBoard);
        if (over)
        {
            board.anchoredPosition = new Vector2(0, -60); board.localScale = Vector3.one * 0.75f;
            DrawMatchEnd(g); matchEnd.SetAsLastSibling(); board.SetAsLastSibling();
        }
        else { board.anchoredPosition = Vector2.zero; board.localScale = Vector3.one; }
        if (showBoard) DrawBoard(g);
        if (settings.gameObject.activeSelf) settings.SetAsLastSibling();
        DrawHud(p, g);
    }

    /// While in the menu the main camera slowly circles the bomb site so the live level is the background.
    void MenuCamera(Game g)
    {
        var cam = Camera.main; if (cam == null) return;
        Vector3 c = g != null && g.sites.Count > 0 ? g.sites[0].center : Vector3.zero; c.y = 0;
        menuAngle += Time.unscaledDeltaTime * 3f;
        float a = menuAngle * Mathf.Deg2Rad;
        // orbit at a fixed distance; when something hides the site, rise (smoothly) until the view is clear
        Vector3 look = c + Vector3.up * 2.5f;
        float want = 30f;
        for (float h = 11f; h <= 30f; h += 2.5f)
        {
            Vector3 at = c + new Vector3(Mathf.Sin(a) * 20f, h, Mathf.Cos(a) * 20f);
            if (!Physics.Linecast(at, look, ~0, QueryTriggerInteraction.Ignore)) { want = h; break; }
        }
        menuDist = menuDist <= 0f ? want : Mathf.Lerp(menuDist, want, 1f - Mathf.Exp(-Time.unscaledDeltaTime * 1.2f));
        cam.transform.position = c + new Vector3(Mathf.Sin(a) * 20f, menuDist, Mathf.Cos(a) * 20f);
        cam.transform.LookAt(look);
    }
    float menuDist;   // current camera height

    void DrawHud(Player p, Game g)
    {
        int tl = Mathf.CeilToInt(g.TimeLeft);
        tScoreT.text = g.ScoreT.Value.ToString(); tScoreCT.text = g.ScoreCT.Value.ToString();
        bool planted = g.Phase == Phase.Planted;
        tTimer.text = $"{tl / 60}:{tl % 60:00}";
        float pulse = planted ? 0.5f + 0.5f * Mathf.Sin(Time.time * 8f) : 0f;
        tTimer.color = planted ? Color.Lerp(Danger, Fg, pulse * 0.4f) : tl <= 10 && g.Phase == Phase.Live ? Danger : Fg;
        timerBg.color = planted ? new Color(0.35f, 0.04f, 0.03f, 0.88f) : Panel;
        tPhase.text = g.Phase == Phase.Freeze ? "ЗАКУПКА" : planted ? "БОМБА ЗАЛОЖЕНА" : g.Phase == Phase.End ? "КОНЕЦ РАУНДА" : "";
        tPhase.color = planted ? Danger : Muted;
        bombBadge.gameObject.SetActive(planted);
        int aT = 0, aC = 0, nT = 0, nC = 0;
        foreach (var o in Player.All) { if (o.Team.Value == 1) { nT++; if (o.Alive) aT++; } else if (o.Team.Value == 2) { nC++; if (o.Alive) aC++; } }
        for (int i = 0; i < 5; i++)
        {
            pipsT[i].gameObject.SetActive(i < nT); pipsT[i].color = i < aT ? Band : new Color(1, 1, 1, 0.15f);
            pipsCT[i].gameObject.SetActive(i < nC); pipsCT[i].color = i < aC ? Ct : new Color(1, 1, 1, 0.15f);
        }
        tAliveT.text = ""; tAliveCT.text = "";

        bool bannerOn = Time.time < g.bannerUntil && !string.IsNullOrEmpty(g.banner) && !MatchOver(g);
        bannerPanel.gameObject.SetActive(bannerOn);
        if (bannerOn)
        {
            tBanner.text = g.banner;
            bool bandWin = g.banner.StartsWith("Победа банды"), ctWin = g.banner.StartsWith("Победа спецназа");
            bannerBar.color = bandWin ? Band : ctWin ? Ct : Accent;
            tBanner.color = bandWin ? Band : ctWin ? Ct : Fg;
            bannerPanel.sizeDelta = new Vector2(1100, g.banner.Contains("\n") ? 200 : 120);
        }
        bool feedOn = Time.time < g.feedUntil;
        for (int i = 0; i < feedRows.Length; i++)
        {
            int idx = g.feed.Count - 1 - i;
            bool on = feedOn && idx >= 0;
            feedRows[i].gameObject.SetActive(on);
            if (on) feedTexts[i].text = FeedLine(g.feed[idx]);
        }

        bool alive = p != null && p.Alive;
        foreach (var kv in btn) kv.Value.gameObject.SetActive(mobile && (alive || kv.Key == "menu" || kv.Key == "score"));
        joyBase.gameObject.SetActive(mobile && alive);
        if (p == null) { tHealth.text = ""; tAmmo.text = ""; tReserve.text = ""; tMoney.text = ""; SetHint("Подключение…"); deadPanel.gameObject.SetActive(false); return; }
        tMoney.text = p.Money.Value + " с.";
        deadPanel.gameObject.SetActive(!alive && !MatchOver(g));
        if (!alive)
        {
            tHealth.text = "0"; tArmor.text = "0"; healthBar.rectTransform.sizeDelta = new Vector2(0, 6); armorBar.rectTransform.sizeDelta = new Vector2(0, 6);
            tAmmo.text = ""; tReserve.text = ""; tWeapon.text = ""; cross.SetActive(false); scope.gameObject.SetActive(false);
            int left = 0; foreach (var o in Player.All) if (o.Team.Value == p.Team.Value && o.Alive) left++;
            tDead.text = left > 0 ? $"Наблюдение за командой · в живых {left}" : "Ожидание следующего раунда";
            SetHint(""); useBar.sizeDelta = new Vector2(0, 14); dmg.color = new Color(0.75f, 0.02f, 0.02f, 0);
            return;
        }
        var d = p.Def;
        int hpv = p.Health.Value, arv = p.Armor.Value;
        tHealth.text = hpv.ToString(); tHealth.color = hpv <= 25 ? Danger : Fg;
        healthBar.rectTransform.sizeDelta = new Vector2(190 * Mathf.Clamp01(hpv / 100f), 6); healthBar.color = hpv <= 25 ? Danger : Fg;
        tArmor.text = arv.ToString(); tArmor.color = arv > 0 ? Fg : Muted;
        armorBar.rectTransform.sizeDelta = new Vector2(170 * Mathf.Clamp01(arv / 100f), 6);
        if (d.slot == Slot.Knife) { tAmmo.text = "—"; tReserve.text = ""; }
        else if (d.slot == Slot.Grenade) { tAmmo.text = p.mag[p.cur].ToString(); tReserve.text = ""; }
        else
        {
            int mag = p.mag[p.cur];
            tAmmo.text = mag.ToString(); tReserve.text = "/ " + p.res[p.cur];
            tAmmo.color = mag <= Mathf.Max(1, d.mag / 5) ? Danger : Fg;
        }
        tWeapon.text = d.title + (p.Reloading ? $"  <color=#{Hex(Accent)}>перезарядка</color>" : "") + (p.HasBomb.Value ? $"   <color=#{Hex(Danger)}>● БОМБА</color>" : "");
        bool scoped = p.zoomed && d.zoomFov > 0 && d.zoomFov < 30;
        scope.gameObject.SetActive(scoped); cross.SetActive(!scoped && !(d.zoomFov > 0 && d.zoomFov < 30));
        hitMark.color = new Color(1, 1, 1, p.hitMarker > 0 ? 0.95f : 0);
        dmg.color = new Color(0.75f, 0.02f, 0.02f, Mathf.Clamp01(p.damageFlash) * 0.65f + (hpv <= 25 ? 0.18f + 0.08f * Mathf.Sin(Time.time * 4f) : 0f));
        useBar.sizeDelta = new Vector2(520 * p.useProgress, 14);
        useBar.parent.gameObject.SetActive(p.useProgress > 0);
        bool plant = g.CanPlant(p), defuse = g.CanDefuse(p);
        string key = mobile ? "«БОМБА»" : "E";
        SetHint(plant ? $"Удерживайте {key}, чтобы заложить бомбу" : defuse ? $"Удерживайте {key}, чтобы обезвредить бомбу"
            : g.Phase == Phase.Freeze ? (mobile ? "Закупка: откройте МАГАЗИН" : "Закупка: нажмите B — магазин")
            : p.HasBomb.Value && g.Phase == Phase.Live ? (g.sites.Count > 1 ? "Несите бомбу на точку A или B" : "Несите бомбу на точку закладки") : "");
        if (mobile)
        {
            btn["use"].gameObject.SetActive(plant || defuse);
            btn["buy"].gameObject.SetActive(g.CanBuy);
            btn["zoom"].gameObject.SetActive(d.zoomFov > 0);
        }
    }

    void SetHint(string s) { tHint.text = s; hintPanel.gameObject.SetActive(!string.IsNullOrEmpty(s)); }

    /// "killer  [weapon]  victim" -> names in team colours, weapon in grey.
    static string FeedLine(string line)
    {
        int a = line.IndexOf("  ["), b = line.IndexOf("]  ");
        if (a < 0 || b < a) return line;
        string killer = line.Substring(0, a), weapon = line.Substring(a + 3, b - a - 3), victim = line.Substring(b + 3);
        return $"<color=#{Hex(NickColor(killer))}>{killer}</color>   <color=#{Hex(Muted)}>{weapon}</color>   <color=#{Hex(NickColor(victim))}>{victim}</color>";
    }

    static Color NickColor(string nick)
    {
        foreach (var p in Player.All) if (p.Nick.Value.ToString() == nick) return TeamColor(p.Team.Value);
        return Fg;
    }

    bool Hit(RectTransform r, Vector2 screen) => r.gameObject.activeInHierarchy && RectTransformUtility.RectangleContainsScreenPoint(r, screen, null);

    void TouchInput()
    {
        var inp = InputState.I;
        bool fire = false, use = false; Vector2 move = Vector2.zero;
        float k = 1080f / Screen.height, inv = GameSettings.InvertY ? -1f : 1f;
        boardHeld = false;
        for (int i = 0; i < Input.touchCount; i++)
        {
            var t = Input.GetTouch(i);
            if (t.phase == TouchPhase.Began)
            {
                boardToggle = false;
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
                    case "menu": pause.gameObject.SetActive(true); boardToggle = false; break;
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
                if (r != "fire2") { var dl = t.deltaPosition * k * 0.11f; dl.y *= inv; inp.look += dl; }
            }
            else if (r == "use") use = true;
            else if (r == "score") boardHeld = true;
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
        if (boardToggle && (Input.GetKeyDown(KeyCode.Tab) || Input.GetMouseButtonDown(0))) boardToggle = false;
        if (Input.GetKeyDown(KeyCode.Escape)) { pause.gameObject.SetActive(true); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; return; }
        if (Input.GetKeyDown(KeyCode.B) && Game.I.CanBuy) { buy.gameObject.SetActive(true); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; return; }
        if (Cursor.lockState != CursorLockMode.Locked) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
        inp.move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
        inp.look += new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y") * (GameSettings.InvertY ? -1f : 1f)) * 2.2f;
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
