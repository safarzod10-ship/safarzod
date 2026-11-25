using System;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

/// Shared look of all game screens: fonts, colours, procedurally drawn sprites (rounded panels, circles,
/// icons) and small widget builders (panels, labels, buttons, segmented choices, sliders, switches).
/// Everything is created in code so screens stay consistent and no image files are needed.
public static class UiKit
{
    public static Font Title, Body, BodyReg;
    public static Sprite Round, RoundSmall, Circle, Ring, GradH, GradV, Vignette, ScopeMask;
    public static Sprite IconHealth, IconArmor, IconBomb, IconDead, IconGear, IconPlay, IconWifi, IconExit, IconBack, IconTrophy;

    public static readonly Color Panel = new Color(0.047f, 0.055f, 0.07f, 0.84f);
    public static readonly Color PanelLight = new Color(0.11f, 0.125f, 0.15f, 0.92f);
    public static readonly Color Line = new Color(1f, 1f, 1f, 0.08f);
    public static readonly Color Accent = new Color(0.96f, 0.66f, 0.22f);
    public static readonly Color AccentDark = new Color(0.16f, 0.1f, 0.02f);
    public static readonly Color Band = new Color(0.95f, 0.64f, 0.3f);
    public static readonly Color Ct = new Color(0.47f, 0.7f, 1f);
    public static readonly Color Fg = new Color(0.95f, 0.95f, 0.96f);
    public static readonly Color Muted = new Color(0.62f, 0.66f, 0.72f);
    public static readonly Color Danger = new Color(1f, 0.36f, 0.3f);
    public static readonly Color Money = new Color(0.56f, 0.9f, 0.48f);

    public static string Hex(Color c) => ColorUtility.ToHtmlStringRGB(c);
    public static Color TeamColor(int team) => team == 1 ? Band : Ct;
    public static string TeamName(int team) => team == 1 ? "Банда" : "Спецназ";

    static bool ready;

    public static void Init()
    {
        if (ready) return;
        ready = true;
        var builtin = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        Title = Resources.Load<Font>("Fonts/RussoOne") ?? builtin;
        Body = Resources.Load<Font>("Fonts/PTSansNarrowBold") ?? builtin;
        BodyReg = Resources.Load<Font>("Fonts/PTSansNarrow") ?? builtin;

        Round = Shape(64, 64, (x, y) => RoundBox(x, y, 32, 32, 32, 32, 14), new Vector4(20, 20, 20, 20));
        RoundSmall = Shape(32, 32, (x, y) => RoundBox(x, y, 16, 16, 16, 16, 6), new Vector4(10, 10, 10, 10));
        Circle = Shape(128, 128, (x, y) => 63.5f - Len(x - 64, y - 64), Vector4.zero);
        Ring = Shape(128, 128, (x, y) => 4f - Mathf.Abs(Len(x - 64, y - 64) - 58f), Vector4.zero);
        GradH = Tex(256, 4, (x, y) => new Color(1, 1, 1, Smooth(1f - x / 255f)), Vector4.zero);
        GradV = Tex(4, 256, (x, y) => new Color(1, 1, 1, Smooth(y / 255f)), Vector4.zero);
        Vignette = Tex(128, 128, (x, y) =>
        {
            float d = Len((x - 64) / 64f, (y - 64) / 64f);
            return new Color(1, 1, 1, Mathf.Clamp01((d - 0.55f) / 0.6f));
        }, Vector4.zero);
        ScopeMask = Shape(512, 512, (x, y) => Len(x - 256, y - 256) - 250f, Vector4.zero);

        IconHealth = Shape(64, 64, (x, y) => Mathf.Max(Box(x, y, 32, 32, 9, 24), Box(x, y, 32, 32, 24, 9)), Vector4.zero);
        IconArmor = Shape(64, 64, Shield, Vector4.zero);
        IconBomb = Shape(64, 64, (x, y) =>
        {
            float body = RoundBox(x, y, 32, 28, 26, 16, 3);
            float cut = Mathf.Max(-Box(x, y, 23, 28, 1.2f, 16), -Box(x, y, 41, 28, 1.2f, 16));
            float timer = RoundBox(x, y, 32, 50, 12, 6, 2);
            return Mathf.Max(Mathf.Min(body, cut), timer);
        }, Vector4.zero);
        IconDead = Shape(64, 64, (x, y) =>
        {
            float a = Seg(x, y, 14, 14, 50, 50) , b = Seg(x, y, 14, 50, 50, 14);
            return 6f - Mathf.Min(a, b);
        }, Vector4.zero);
        IconGear = Shape(64, 64, (x, y) =>
        {
            float r = Len(x - 32, y - 32), ang = Mathf.Atan2(y - 32, x - 32);
            float teeth = 22f + 6f * Mathf.Clamp(Mathf.Cos(ang * 8f) * 3f, -1f, 1f);
            return Mathf.Min(teeth - r, r - 9f);
        }, Vector4.zero);
        IconPlay = Shape(64, 64, (x, y) => Tri(x, y, 20, 12, 20, 52, 54, 32), Vector4.zero);
        IconWifi = Shape(64, 64, (x, y) =>
        {
            float r = Len(x - 32, y - 12), ang = Mathf.Atan2(y - 12, x - 32) * Mathf.Rad2Deg;
            if (r < 6f) return 6f - r;
            if (ang < 40f || ang > 140f) return -1f;
            float d = 99f; foreach (float k in new[] { 20f, 33f, 46f }) d = Mathf.Min(d, Mathf.Abs(r - k));
            return 4f - d;
        }, Vector4.zero);
        IconExit = Shape(64, 64, (x, y) => Mathf.Max(4f - Seg(x, y, 14, 32, 46, 32), Mathf.Max(4f - Seg(x, y, 46, 32, 32, 46), 4f - Seg(x, y, 46, 32, 32, 18))), Vector4.zero);
        IconBack = Shape(64, 64, (x, y) => Mathf.Max(4f - Seg(x, y, 18, 32, 50, 32), Mathf.Max(4f - Seg(x, y, 18, 32, 32, 46), 4f - Seg(x, y, 18, 32, 32, 18))), Vector4.zero);
        IconTrophy = Shape(64, 64, (x, y) =>
        {
            // bowl: lower half of a circle, closed by a rim at the top
            float bowl = Mathf.Min(18f - Len(x - 32, y - 50), 50f - y + 0f);
            float cup = Mathf.Max(Mathf.Min(bowl, y - 30f), Box(x, y, 32, 52, 18, 4));
            float stem = Box(x, y, 32, 22, 4, 10), foot = RoundBox(x, y, 32, 10, 13, 4, 2);
            return Mathf.Max(cup, Mathf.Max(stem, foot));
        }, Vector4.zero);
    }

    // ------------------------------------------------------------------ signed-distance helpers (positive = inside)
    static float Len(float x, float y) => Mathf.Sqrt(x * x + y * y);
    static float Smooth(float t) => t * t * (3f - 2f * t);
    static float Box(float x, float y, float cx, float cy, float hx, float hy) => Mathf.Min(hx - Mathf.Abs(x - cx), hy - Mathf.Abs(y - cy));
    static float RoundBox(float x, float y, float cx, float cy, float hx, float hy, float r)
    {
        float qx = Mathf.Abs(x - cx) - (hx - r), qy = Mathf.Abs(y - cy) - (hy - r);
        float outside = Len(Mathf.Max(qx, 0), Mathf.Max(qy, 0)) + Mathf.Min(Mathf.Max(qx, qy), 0);
        return r - outside;
    }
    static float Seg(float x, float y, float ax, float ay, float bx, float by)
    {
        float px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
        float h = Mathf.Clamp01((px * dx + py * dy) / (dx * dx + dy * dy));
        return Len(px - dx * h, py - dy * h);
    }
    static float Tri(float x, float y, float ax, float ay, float bx, float by, float cx, float cy)
    {
        float e(float x0, float y0, float x1, float y1) { float dx = x1 - x0, dy = y1 - y0, l = Len(dx, dy); return ((x - x0) * dy - (y - y0) * dx) / l; }
        float e1 = e(ax, ay, bx, by), e2 = e(bx, by, cx, cy), e3 = e(cx, cy, ax, ay);
        if (e1 + e2 + e3 < 0) { e1 = -e1; e2 = -e2; e3 = -e3; }
        return Mathf.Min(e1, Mathf.Min(e2, e3));
    }
    static float Shield(float x, float y)
    {
        // flat top with rounded shoulders, sides that curve to a point at the bottom
        float t = Mathf.InverseLerp(6f, 56f, y);                 // 0 bottom .. 1 top
        float half = t > 0.55f ? 22f : 22f * Mathf.Sqrt(Mathf.Clamp01(t / 0.55f));
        float side = half - Mathf.Abs(x - 32f);
        float top = 56f - y, bottom = y - 6f;
        return Mathf.Min(side, Mathf.Min(top, bottom));
    }

    static Sprite Shape(int w, int h, Func<float, float, float> sdf, Vector4 border)
        => Tex(w, h, (x, y) => new Color(1, 1, 1, Mathf.Clamp01(sdf(x + 0.5f, y + 0.5f) + 0.5f)), border);

    static Sprite Tex(int w, int h, Func<float, float, Color> f, Vector4 border)
    {
        var t = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
        var px = new Color[w * h];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) px[y * w + x] = f(x, y);
        t.SetPixels(px); t.Apply(false, true);
        return Sprite.Create(t, new Rect(0, 0, w, h), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, border);
    }

    // ------------------------------------------------------------------ layout helpers
    public static RectTransform Node(Transform parent, string name, Vector2 anchor, Vector2 pos, Vector2 size, Vector2? pivot = null)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var r = go.GetComponent<RectTransform>();
        r.SetParent(parent, false);
        r.anchorMin = r.anchorMax = anchor; r.pivot = pivot ?? anchor; r.anchoredPosition = pos; r.sizeDelta = size;
        return r;
    }

    public static RectTransform Stretch(Transform parent, string name)
    {
        var r = Node(parent, name, Vector2.zero, Vector2.zero, Vector2.zero);
        r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.pivot = new Vector2(0.5f, 0.5f); r.offsetMin = r.offsetMax = Vector2.zero;
        return r;
    }

    public static Image Img(RectTransform r, Color c, Sprite s = null, bool raycast = false)
    {
        var i = r.gameObject.AddComponent<Image>();
        i.sprite = s; i.color = c; i.raycastTarget = raycast;
        if (s != null && s.border != Vector4.zero) { i.type = Image.Type.Sliced; i.pixelsPerUnitMultiplier = 2f; }
        return i;
    }

    public static Image PanelImg(RectTransform r, Color? c = null) => Img(r, c ?? Panel, Round);

    public static Text Label(Transform parent, string name, Vector2 anchor, Vector2 pos, Vector2 size, int fontSize, TextAnchor align, string text = "", Font font = null, Color? color = null, bool shadow = true)
    {
        var r = Node(parent, name, anchor, pos, size);
        var t = r.gameObject.AddComponent<Text>();
        t.font = font ?? Body; t.fontSize = fontSize; t.alignment = align; t.color = color ?? Fg; t.text = text; t.raycastTarget = false;
        t.supportRichText = true;
        t.horizontalOverflow = HorizontalWrapMode.Overflow; t.verticalOverflow = VerticalWrapMode.Overflow;
        if (shadow) { var s = r.gameObject.AddComponent<Shadow>(); s.effectColor = new Color(0, 0, 0, 0.55f); s.effectDistance = new Vector2(1.5f, -2f); }
        return t;
    }

    public static Image Icon(Transform parent, Sprite s, Vector2 anchor, Vector2 pos, float size, Color c)
    {
        var r = Node(parent, s != null ? s.name + "_icon" : "icon", anchor, pos, new Vector2(size, size));
        return Img(r, c, s);
    }

    public enum Style { Primary, Secondary, Ghost }

    /// A button with a rounded background. Primary = accent filled, Secondary = dark panel, Ghost = text only.
    public static Button Btn(Transform parent, string label, Vector2 anchor, Vector2 pos, Vector2 size, UnityAction onClick, Style style = Style.Secondary, int fontSize = 32, Sprite icon = null)
    {
        var r = Node(parent, label, anchor, pos, size);
        Color bg = style == Style.Primary ? Accent : style == Style.Secondary ? PanelLight : new Color(1, 1, 1, 0f);
        var img = Img(r, bg, Round, true);
        var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = img;
        var cb = b.colors;
        cb.normalColor = Color.white;
        cb.highlightedColor = style == Style.Primary ? new Color(1.08f, 1.08f, 1.08f) : new Color(1.6f, 1.6f, 1.6f, 1f);
        cb.pressedColor = style == Style.Primary ? new Color(0.85f, 0.85f, 0.85f) : new Color(2.2f, 2.0f, 1.6f, 1f);
        cb.selectedColor = Color.white; cb.disabledColor = new Color(0.55f, 0.55f, 0.55f, 0.6f); cb.fadeDuration = 0.08f; b.colors = cb;
        if (style == Style.Ghost) { img.color = new Color(1, 1, 1, 0.001f); }
        if (onClick != null) b.onClick.AddListener(onClick);
        b.onClick.AddListener(() => Fx.Sound2D("click", 0.5f));
        Color fg = style == Style.Primary ? AccentDark : Fg;
        float pad = icon != null ? size.y * 0.9f : 0f;
        var t = Label(r, "t", new Vector2(0.5f, 0.5f), new Vector2(pad * 0.5f, 0), size - new Vector2(28 + pad, 0), fontSize, TextAnchor.MiddleCenter, label, Title, fg, style != Style.Primary);
        t.horizontalOverflow = HorizontalWrapMode.Wrap;
        if (icon != null)
        {
            float s = size.y * 0.46f;
            var ic = Icon(r, icon, new Vector2(0, 0.5f), new Vector2(size.y * 0.32f, 0), s, fg);
            ic.rectTransform.pivot = new Vector2(0, 0.5f);
        }
        return b;
    }

    public static void SetLabel(Button b, string text) { var t = b.GetComponentInChildren<Text>(); if (t != null) t.text = text; }

    /// Row with a label on the left and a control area on the right (returns the control area).
    public static RectTransform SetRow(Transform parent, string label, float y, float width, out Text labelText, float height = 84)
    {
        var row = Node(parent, "row_" + label, new Vector2(0.5f, 1), new Vector2(0, y), new Vector2(width, height), new Vector2(0.5f, 1));
        Img(Node(row, "line", new Vector2(0.5f, 0), Vector2.zero, new Vector2(width, 2)), Line);
        labelText = Label(row, "label", new Vector2(0, 0.5f), new Vector2(8, 0), new Vector2(width * 0.42f, height), 32, TextAnchor.MiddleLeft, label);
        labelText.rectTransform.pivot = new Vector2(0, 0.5f);
        var ctl = Node(row, "ctl", new Vector2(1, 0.5f), new Vector2(-8, 0), new Vector2(width * 0.55f, height - 16), new Vector2(1, 0.5f));
        return ctl;
    }

    /// Segmented choice (like radio buttons); calls set(index) and redraws.
    public static Action Segmented(RectTransform area, string[] options, Func<int> get, Action<int> set)
    {
        float w = area.sizeDelta.x, h = area.sizeDelta.y, gap = 6f, bw = (w - gap * (options.Length - 1)) / options.Length;
        var imgs = new Image[options.Length]; var texts = new Text[options.Length];
        for (int i = 0; i < options.Length; i++)
        {
            int k = i;
            var r = Node(area, "opt" + i, new Vector2(0, 0.5f), new Vector2(i * (bw + gap), 0), new Vector2(bw, h), new Vector2(0, 0.5f));
            imgs[i] = Img(r, PanelLight, Round, true);
            var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = imgs[i]; b.transition = Selectable.Transition.None;
            texts[i] = Label(r, "t", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(bw - 8, h), 28, TextAnchor.MiddleCenter, options[i], Body, null, false);
            b.onClick.AddListener(() => { set(k); Fx.Sound2D("click", 0.5f); });
        }
        Action refresh = () =>
        {
            int cur = get();
            for (int i = 0; i < imgs.Length; i++)
            {
                imgs[i].color = i == cur ? Accent : PanelLight;
                texts[i].color = i == cur ? AccentDark : Muted;
            }
        };
        foreach (var img in imgs) img.GetComponent<Button>().onClick.AddListener(() => refresh());
        refresh();
        return refresh;
    }

    /// Horizontal slider with a value read-out; calls set(value) while dragging.
    public static Action SliderCtl(RectTransform area, float min, float max, Func<float> get, Action<float> set, Func<float, string> fmt)
    {
        float w = area.sizeDelta.x, h = area.sizeDelta.y;
        var value = Label(area, "value", new Vector2(1, 0.5f), Vector2.zero, new Vector2(110, h), 30, TextAnchor.MiddleRight, "", Title, Accent, false);
        var track = Node(area, "track", new Vector2(0, 0.5f), new Vector2(0, 0), new Vector2(w - 130, 44), new Vector2(0, 0.5f));
        Img(track, new Color(1, 1, 1, 0.001f), null, true);
        var bg = Node(track, "bg", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(w - 150, 8)); Img(bg, new Color(1, 1, 1, 0.14f), RoundSmall);
        var fillArea = Node(track, "fillArea", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(w - 150, 8));
        var fill = Node(fillArea, "fill", new Vector2(0, 0.5f), Vector2.zero, new Vector2(0, 8), new Vector2(0, 0.5f));
        fill.anchorMin = new Vector2(0, 0); fill.anchorMax = new Vector2(0, 1); fill.sizeDelta = Vector2.zero;
        Img(fill, Accent, RoundSmall);
        var handleArea = Node(track, "handleArea", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(w - 150, 40));
        var handle = Node(handleArea, "handle", new Vector2(0, 0.5f), Vector2.zero, new Vector2(34, -6));   // the slider stretches the handle over the 40-high area: 40 - 6 = 34
        var himg = Img(handle, Fg, Circle, true);
        var s = track.gameObject.AddComponent<UnityEngine.UI.Slider>();
        s.fillRect = fill; s.handleRect = handle; s.targetGraphic = himg; s.direction = UnityEngine.UI.Slider.Direction.LeftToRight;
        s.minValue = min; s.maxValue = max; s.value = get();
        value.text = fmt(get());
        s.onValueChanged.AddListener(v => { set(v); value.text = fmt(v); });
        return () => { s.SetValueWithoutNotify(get()); value.text = fmt(get()); };
    }

    /// On/off switch.
    public static Action SwitchCtl(RectTransform area, Func<bool> get, Action<bool> set)
    {
        var r = Node(area, "switch", new Vector2(1, 0.5f), Vector2.zero, new Vector2(110, 54), new Vector2(1, 0.5f));
        var bg = Img(r, PanelLight, Round, true);
        var knob = Node(r, "knob", new Vector2(0, 0.5f), Vector2.zero, new Vector2(42, 42));
        var kimg = Img(knob, Fg, Circle);
        var state = Label(area, "state", new Vector2(1, 0.5f), new Vector2(-130, 0), new Vector2(200, 54), 28, TextAnchor.MiddleRight, "", Body, Muted, false);
        state.rectTransform.pivot = new Vector2(1, 0.5f);
        Action refresh = () =>
        {
            bool on = get();
            bg.color = on ? Accent : PanelLight;
            kimg.color = on ? AccentDark : Muted;
            knob.anchoredPosition = new Vector2(on ? 82 : 28, 0);
            state.text = on ? "Вкл." : "Выкл.";
        };
        var b = r.gameObject.AddComponent<Button>(); b.targetGraphic = bg; b.transition = Selectable.Transition.None;
        b.onClick.AddListener(() => { set(!get()); refresh(); Fx.Sound2D("click", 0.5f); });
        refresh();
        return refresh;
    }

    public static InputField Field(Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, string placeholder, string value)
    {
        var r = Node(parent, "field", anchor, pos, size);
        Img(r, new Color(1, 1, 1, 0.07f), Round, true);
        var f = r.gameObject.AddComponent<InputField>();
        var t = Label(r, "text", new Vector2(0.5f, 0.5f), Vector2.zero, size - new Vector2(36, 8), 32, TextAnchor.MiddleLeft, "", Body, Fg, false);
        t.horizontalOverflow = HorizontalWrapMode.Wrap;
        var ph = Label(r, "ph", new Vector2(0.5f, 0.5f), Vector2.zero, size - new Vector2(36, 8), 30, TextAnchor.MiddleLeft, placeholder, BodyReg, new Color(1, 1, 1, 0.35f), false);
        f.textComponent = t; f.placeholder = ph; f.text = value;
        f.caretColor = Accent; f.selectionColor = new Color(Accent.r, Accent.g, Accent.b, 0.35f);
        return f;
    }
}
