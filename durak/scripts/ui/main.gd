extends Control
## Корень приложения: заставка, меню, профиль, настройки игры с ботами,
## Wi-Fi-комнаты, лобби, правила и стол. Переходы — через бежевую шторку
## с анимацией мастей.

var screen := ""
var content: Control
var curtain: Control
var curtain_video: SuitVideo
var toast_box: VBoxContainer
var table: TableScreen
var _rooms_list: VBoxContainer
var _rooms_empty: Control
var _joining := false
var _pending_join := false
var _photo_dialog: FileDialog


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = UI.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	content = Control.new()
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(content)
	curtain = ColorRect.new()
	(curtain as ColorRect).color = UI.BG
	curtain.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	curtain.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(curtain)
	curtain_video = SuitVideo.new(110)
	curtain.add_child(curtain_video)
	_center_curtain_video(110)
	toast_box = VBoxContainer.new()
	toast_box.set_anchors_preset(Control.PRESET_TOP_WIDE)
	toast_box.position.y = 110
	toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(toast_box)

	Session.lobby_changed.connect(_on_lobby_changed)
	Session.closed.connect(func(reason: String) -> void:
		_joining = false
		_toast(reason)
		go("wifi" if screen in ["lobby", "connecting"] and not Session.is_web() else "menu"))
	Session.rooms_changed.connect(_on_rooms)
	Session.view_changed.connect(func(_v: Dictionary, _e: Array) -> void:
		if screen != "table":
			go("table"))
	Session.toast.connect(func(t: String) -> void:
		if screen != "table":
			_toast(t))
	get_tree().root.go_back_requested.connect(_on_back)
	_splash()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		Session.leave()


# ================================================================ переходы

func _splash() -> void:
	curtain.visible = true
	curtain.modulate.a = 1.0
	_center_curtain_video(200)
	var title := UI.label("ДУРАК", 92, UI.TEXT, true, 800)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	title.anchor_top = 0.5
	title.anchor_bottom = 0.5
	title.offset_top = 210
	title.offset_left = -360
	title.offset_right = 360
	title.modulate.a = 0.0
	curtain.add_child(title)
	var t := create_tween()
	t.tween_property(title, "modulate:a", 1.0, 0.6).set_delay(0.3)
	t.tween_interval(4.6)
	t.tween_callback(func() -> void:
		_center_curtain_video(110)
		title.queue_free()
		if screen == "":
			_after_splash())


## Веб: ссылка вида http://IP:8080/?join сразу ведёт в комнату хоста;
## ?name=... задаёт имя, если профиля ещё нет.
func _after_splash() -> void:
	var query := ""
	if Session.is_web():
		query = str(JavaScriptBridge.eval("window.location.search", true))
	var params := {}
	for part in query.trim_prefix("?").split("&", false):
		params[part.get_slice("=", 0)] = part.get_slice("=", 1).uri_decode() if part.contains("=") else ""
	if not Profile.has_profile() and String(params.get("name", "")) != "":
		Profile.player_name = String(params["name"]).left(16)
		Profile.save()
	if not Profile.has_profile():
		_pending_join = params.has("join")
		go("profile_first", true)
	elif params.has("join") and Session.web_origin_host() != "":
		_join(Session.web_origin_host())
	else:
		go("menu", true)


func _center_curtain_video(sz: float) -> void:
	curtain_video.set_box(sz)
	curtain_video.set_anchors_preset(Control.PRESET_CENTER)
	curtain_video.position = get_viewport_rect().size / 2.0 - curtain_video.size / 2.0 - Vector2(0, 40)


## Сменить экран через шторку.
func go(target: String, from_splash: bool = false) -> void:
	if target == screen and target != "lobby":
		return
	var t := create_tween()
	if not from_splash:
		curtain.visible = true
		curtain.modulate.a = 0.0
		t.tween_property(curtain, "modulate:a", 1.0, 0.25)
	t.tween_callback(func() -> void: _build(target))
	t.tween_interval(0.9 if target in ["table", "lobby"] else 0.2)
	t.tween_property(curtain, "modulate:a", 0.0, 0.3)
	t.tween_callback(func() -> void: curtain.visible = false)


func _build(target: String) -> void:
	if screen == "wifi" and target != "wifi":
		Session.stop_scan()
	screen = target
	for c in content.get_children():
		c.queue_free()
	table = null
	match target:
		"menu": _menu()
		"profile": _profile(false)
		"profile_first": _profile(true)
		"bots": _bots()
		"wifi": _wifi()
		"lobby": _lobby()
		"rules": _rules()
		"connecting": _connecting()
		"table":
			table = TableScreen.new()
			table.leave_requested.connect(func() -> void:
				Session.leave()
				go("menu"))
			content.add_child(table)


func _on_back() -> void:
	match screen:
		"table":
			table.back_pressed()
		"lobby", "connecting":
			Session.leave()
			go("menu" if Session.is_web() else "wifi")
		"menu", "profile_first":
			get_tree().quit()
		_:
			go("menu")


func _toast(text: String) -> void:
	var pc := PanelContainer.new()
	var sb := UI.box(UI.TEXT, 999)
	sb.content_margin_left = 28
	sb.content_margin_right = 28
	sb.content_margin_top = 14
	sb.content_margin_bottom = 14
	pc.add_theme_stylebox_override("panel", sb)
	pc.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pc.add_child(UI.label(text, 24, UI.PAPER, false, 700))
	toast_box.add_child(pc)
	var t := pc.create_tween()
	t.tween_interval(2.6)
	t.tween_property(pc, "modulate:a", 0.0, 0.3)
	t.tween_callback(pc.queue_free)


# ================================================================ каркас экрана

func _page(title: String, back: bool = true) -> VBoxContainer:
	var m := MarginContainer.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var sm := UI.safe_margins(self)
	m.add_theme_constant_override("margin_left", 40)
	m.add_theme_constant_override("margin_right", 40)
	m.add_theme_constant_override("margin_top", int(sm.y) + 12)
	m.add_theme_constant_override("margin_bottom", int(sm.w) + 24)
	content.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 18)
	m.add_child(v)
	if title != "":
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 18)
		if back:
			var b := UI.icon_button("back")
			b.pressed.connect(_on_back)
			h.add_child(b)
		var l := UI.label(title, 44, UI.TEXT, true, 700)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(l)
		v.add_child(h)
		v.add_child(UI.spacer(12))
	return v


func _fill_space(v: Control) -> void:
	var sp := Control.new()
	sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(sp)


func _profile_chip() -> Control:
	var b := Button.new()
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 80)
	b.pressed.connect(func() -> void: go("profile"))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 16)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var av := AvatarView.new(72)
	av.display_name = Profile.player_name
	av.texture = Profile.texture_from_bytes(Profile.avatar)
	h.add_child(av)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(UI.label(Profile.player_name, 28, UI.TEXT, false, 800))
	col.add_child(UI.label("профиль", 20, UI.MUTED, false, 600))
	h.add_child(col)
	b.add_child(h)
	return b


# ================================================================ меню

func _menu() -> void:
	var v := _page("", false)
	var top := HBoxContainer.new()
	top.add_child(_profile_chip())
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	var snd := UI.icon_button("sound_on" if Profile.settings.sound else "sound_off")
	snd.pressed.connect(func() -> void:
		Profile.settings.sound = not Profile.settings.sound
		Profile.save()
		(snd.get_child(0) as IconGlyph).kind = "sound_on" if Profile.settings.sound else "sound_off")
	top.add_child(snd)
	v.add_child(top)
	_fill_space(v)
	var morph := SuitVideo.new(170)
	morph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(morph)
	var title := UI.label("ДУРАК", 110, UI.TEXT, true, 800)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)
	var sub := UI.label("с друзьями · без интернета", 24, UI.MUTED, false, 700)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)
	_fill_space(v)
	var b1 := UI.button("С ботами", "primary", 32)
	b1.custom_minimum_size.y = 110
	b1.pressed.connect(func() -> void: go("bots"))
	v.add_child(b1)
	var web_host := Session.web_origin_host()
	var b2 := UI.button("Войти в комнату" if web_host != "" else "С друзьями по Wi-Fi", "ghost", 30)
	b2.custom_minimum_size.y = 110
	b2.pressed.connect(func() -> void:
		if web_host != "":
			_join(web_host)
		else:
			go("wifi"))
	v.add_child(b2)
	var b3 := UI.button("Правила", "ghost", 26)
	b3.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	b3.pressed.connect(func() -> void: go("rules"))
	v.add_child(b3)


# ================================================================ профиль

func _profile(first: bool) -> void:
	var v := _page("Кто играет?" if first else "Профиль", not first)
	_fill_space(v)
	var av := AvatarView.new(260)
	av.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	av.display_name = Profile.player_name if Profile.player_name != "" else "?"
	av.texture = Profile.texture_from_bytes(Profile.avatar)
	av.ring = UI.TEXT
	v.add_child(av)
	var photo_row := HBoxContainer.new()
	photo_row.alignment = BoxContainer.ALIGNMENT_CENTER
	photo_row.add_theme_constant_override("separation", 12)
	var pick := UI.button("Выбрать фото", "ghost", 24)
	pick.custom_minimum_size = Vector2(0, 76)
	pick.pressed.connect(func() -> void: _pick_photo(av))
	photo_row.add_child(pick)
	var clear := UI.button("Убрать", "ghost", 24)
	clear.custom_minimum_size = Vector2(0, 76)
	clear.visible = not Profile.avatar.is_empty()
	clear.pressed.connect(func() -> void:
		Profile.clear_avatar()
		av.texture = null
		clear.visible = false)
	photo_row.add_child(clear)
	v.add_child(photo_row)
	v.add_child(UI.spacer(24))
	v.add_child(UI.caption("Имя"))
	var name_edit := LineEdit.new()
	name_edit.text = Profile.player_name
	name_edit.placeholder_text = "Как тебя зовут?"
	name_edit.max_length = 16
	name_edit.custom_minimum_size = Vector2(0, 96)
	name_edit.add_theme_font_override("font", UI.font(true, 600))
	name_edit.add_theme_font_size_override("font_size", 34)
	name_edit.add_theme_color_override("font_color", UI.TEXT)
	name_edit.add_theme_color_override("font_placeholder_color", UI.MUTED)
	name_edit.add_theme_color_override("caret_color", UI.ACCENT)
	var sb := UI.box(Color(0, 0, 0, 0), 0)
	sb.border_color = UI.TEXT
	sb.border_width_bottom = 3
	name_edit.add_theme_stylebox_override("normal", sb)
	name_edit.add_theme_stylebox_override("focus", sb)
	name_edit.text_changed.connect(func(t: String) -> void:
		av.display_name = t if t != "" else "?")
	v.add_child(name_edit)
	_fill_space(v)
	var save := UI.button("Готово", "primary", 32)
	save.custom_minimum_size.y = 110
	save.pressed.connect(func() -> void:
		var nm := name_edit.text.strip_edges()
		if nm == "":
			_toast("Введи имя")
			return
		Profile.player_name = nm
		Profile.save()
		if _pending_join and Session.web_origin_host() != "":
			_pending_join = false
			_join(Session.web_origin_host())
		else:
			go("menu"))
	v.add_child(save)


var _js_photo_cb: JavaScriptObject


## Выбор фото в браузере (Safari): обычный <input type=file>, фото уменьшается
## на стороне браузера и приходит в игру как JPEG в base64.
func _pick_photo_web(av: AvatarView) -> void:
	JavaScriptBridge.eval("""
	window.durakPickPhoto = function (cb) {
		var input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = function () {
			var f = input.files && input.files[0];
			if (!f) { return; }
			var img = new Image();
			img.onload = function () {
				var s = Math.min(img.width, img.height);
				var c = document.createElement('canvas');
				c.width = 384; c.height = 384;
				c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 384, 384);
				cb(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
				URL.revokeObjectURL(img.src);
			};
			img.onerror = function () { cb(''); };
			img.src = URL.createObjectURL(f);
		};
		input.click();
	};
	""", true)
	_js_photo_cb = JavaScriptBridge.create_callback(func(args: Array) -> void:
		var b64 := str(args[0]) if args.size() > 0 else ""
		var img := Image.new()
		if b64 == "" or img.load_jpg_from_buffer(Marshalls.base64_to_raw(b64)) != OK:
			_toast("Не получилось открыть фото")
			return
		Profile.set_avatar_image(img)
		av.texture = Profile.texture_from_bytes(Profile.avatar))
	var win := JavaScriptBridge.get_interface("window")
	win.durakPickPhoto(_js_photo_cb)


func _pick_photo(av: AvatarView) -> void:
	if Session.is_web():
		_pick_photo_web(av)
		return
	var filters := PackedStringArray(["*.jpg, *.jpeg, *.png, *.webp ; Фото"])
	var cb := func(status: bool, paths: PackedStringArray, _f: int) -> void:
		if status and paths.size() > 0:
			_load_photo(paths[0], av)
	if DisplayServer.has_feature(DisplayServer.FEATURE_NATIVE_DIALOG_FILE):
		DisplayServer.file_dialog_show("Фото профиля", "", "", false, DisplayServer.FILE_DIALOG_MODE_OPEN_FILE, filters, cb)
		return
	if _photo_dialog == null:
		_photo_dialog = FileDialog.new()
		_photo_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		_photo_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_photo_dialog.filters = filters
		_photo_dialog.size = Vector2i(680, 1000)
		add_child(_photo_dialog)
	for c in _photo_dialog.file_selected.get_connections():
		_photo_dialog.file_selected.disconnect(c.callable)
	_photo_dialog.file_selected.connect(func(p: String) -> void: _load_photo(p, av))
	_photo_dialog.popup_centered()


func _load_photo(path: String, av: AvatarView) -> void:
	var img := Image.new()
	var err := img.load(path)
	if err != OK:
		var bytes := FileAccess.get_file_as_bytes(path)
		if not bytes.is_empty():
			err = img.load_jpg_from_buffer(bytes)
			if err != OK:
				err = img.load_png_from_buffer(bytes)
			if err != OK:
				err = img.load_webp_from_buffer(bytes)
	if err != OK:
		_toast("Не получилось открыть фото")
		return
	Profile.set_avatar_image(img)
	av.texture = Profile.texture_from_bytes(Profile.avatar)


# ================================================================ с ботами

func _bots() -> void:
	var v := _page("С ботами")
	var s: Dictionary = Profile.settings
	v.add_child(UI.caption("Соперники"))
	v.add_child(UI.segmented([1, 2, 3, 4, 5], int(s.bots) - 1, func(i: int) -> void: s.bots = i + 1))
	v.add_child(UI.spacer(8))
	v.add_child(UI.caption("Сложность"))
	v.add_child(UI.segmented(["Лёгкий", "Норм", "Сильный"], int(s.level), func(i: int) -> void: s.level = i))
	v.add_child(UI.spacer(8))
	v.add_child(UI.caption("Режим"))
	v.add_child(UI.segmented(["Подкидной", "Переводной"], 1 if s.mode == "perevodnoy" else 0, func(i: int) -> void:
		s.mode = "perevodnoy" if i == 1 else "podkidnoy"))
	v.add_child(UI.spacer(8))
	v.add_child(UI.caption("Обман"))
	v.add_child(UI.segmented(["С обманом", "Честно"], 0 if s.cheats else 1, func(i: int) -> void: s.cheats = i == 0))
	var hint := UI.label("Неправильный ход проходит, но его можно поймать: коснись подозрительной карты на столе и нажми «Обман?» — карта вернётся владельцу.", 22, UI.MUTED, false, 600)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(hint)
	_fill_space(v)
	var play := UI.button("Играть", "primary", 34)
	play.custom_minimum_size.y = 110
	play.pressed.connect(func() -> void:
		Profile.save()
		Session.start_local(int(s.bots), int(s.level), String(s.mode), bool(s.cheats)))
	v.add_child(play)


# ================================================================ Wi-Fi

func _wifi() -> void:
	var v := _page("По Wi-Fi")
	var hint := UI.label("Все в одной Wi-Fi сети или на точке доступа того, кто создаёт комнату. Интернет не нужен.", 22, UI.MUTED, false, 600)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(hint)
	v.add_child(UI.spacer(6))
	var create := UI.button("Создать комнату", "primary", 32)
	create.custom_minimum_size.y = 110
	create.pressed.connect(func() -> void:
		var err := Session.host_room()
		if err != "":
			_toast(err))
	v.add_child(create)
	v.add_child(UI.spacer(16))
	v.add_child(UI.caption("Комнаты рядом"))
	_rooms_list = VBoxContainer.new()
	_rooms_list.add_theme_constant_override("separation", 12)
	v.add_child(_rooms_list)
	_rooms_empty = HBoxContainer.new()
	_rooms_empty.add_theme_constant_override("separation", 12)
	var spin := SuitVideo.new(34)
	_rooms_empty.add_child(spin)
	var l := UI.label("Ищем комнаты…", 24, UI.MUTED, false, 700)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_rooms_empty.add_child(l)
	_rooms_list.add_child(_rooms_empty)
	_fill_space(v)
	v.add_child(UI.caption("Или по IP хоста"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var ip := LineEdit.new()
	ip.placeholder_text = "192.168.1.5"
	ip.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ip.custom_minimum_size = Vector2(0, 90)
	ip.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER_DECIMAL
	ip.add_theme_font_override("font", UI.font(true, 500))
	ip.add_theme_font_size_override("font_size", 30)
	ip.add_theme_color_override("font_color", UI.TEXT)
	ip.add_theme_color_override("font_placeholder_color", UI.LINE)
	var sb := UI.box(Color(0, 0, 0, 0), 0)
	sb.border_color = UI.TEXT
	sb.border_width_bottom = 3
	ip.add_theme_stylebox_override("normal", sb)
	ip.add_theme_stylebox_override("focus", sb)
	row.add_child(ip)
	var go_btn := UI.button("Войти", "ghost", 26)
	go_btn.custom_minimum_size = Vector2(160, 90)
	go_btn.pressed.connect(func() -> void:
		if ip.text.strip_edges() != "":
			_join(ip.text))
	row.add_child(go_btn)
	v.add_child(row)
	Session.start_scan()


func _on_rooms(rooms: Array) -> void:
	if screen != "wifi" or _rooms_list == null or not is_instance_valid(_rooms_list):
		return
	for c in _rooms_list.get_children():
		if c != _rooms_empty:
			c.queue_free()
	_rooms_empty.visible = rooms.is_empty()
	for r in rooms:
		var b := UI.button("", "dark", 26)
		b.custom_minimum_size.y = 100
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var running: bool = r.running
		b.text = "%s   ·   %d/6%s" % [r.name, int(r.players), "   ·   идёт игра" if running else ""]
		b.pressed.connect(func() -> void: _join(String(r.ip)))
		_rooms_list.add_child(b)


func _join(ip: String) -> void:
	var err := Session.join(ip)
	if err != "":
		_toast(err)
		return
	_joining = true
	go("connecting")


func _connecting() -> void:
	var v := _page("", false)
	_fill_space(v)
	var morph := SuitVideo.new(130)
	morph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(morph)
	var l := UI.label("Подключаемся…", 32, UI.TEXT, true, 600)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(l)
	_fill_space(v)
	var cancel := UI.button("Отмена", "ghost")
	cancel.pressed.connect(func() -> void:
		Session.leave()
		go("wifi"))
	v.add_child(cancel)


# ================================================================ лобби

func _on_lobby_changed() -> void:
	if Session.role == Session.Role.NONE or Session.role == Session.Role.LOCAL:
		return
	if Session.running:
		return
	if screen == "lobby":
		_build("lobby")
	elif screen in ["wifi", "connecting", "table"]:
		_joining = false
		go("lobby")


func _lobby() -> void:
	var host := Session.role == Session.Role.HOST
	var v := _page("Комната")
	if host:
		var ips := Session.local_ips()
		var ip_l := UI.label("IP: " + (", ".join(ips) if not ips.is_empty() else "нет сети"), 24, UI.MUTED, true, 500)
		v.add_child(ip_l)
		if Session.web_port > 0 and not ips.is_empty():
			var web := VBoxContainer.new()
			web.add_theme_constant_override("separation", 2)
			web.add_child(UI.caption("iPhone: открой в Safari"))
			web.add_child(UI.label("%s:%d/?join" % [ips[0], Session.web_port], 32, UI.ACCENT, true, 700))
			v.add_child(web)
	else:
		v.add_child(UI.label("Хост: " + Session.host_name, 24, UI.MUTED, false, 700))
	v.add_child(UI.spacer(6))
	v.add_child(UI.caption("Игроки %d/6" % Session.seats.size()))
	for i in Session.seats.size():
		var s: Dictionary = Session.seats[i]
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 18)
		var av := AvatarView.new(72)
		av.display_name = s.name
		av.texture = Session.avatar_for(s.uid)
		h.add_child(av)
		var col := VBoxContainer.new()
		col.add_theme_constant_override("separation", 0)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.add_child(UI.label(s.name, 28, UI.TEXT, false, 800))
		var tag: String = "хост" if i == 0 else ("бот · " + Session.LEVEL_NAMES[int(s.level)] if s.bot else "игрок")
		if s.uid == Profile.uid:
			tag += " · вы"
		col.add_child(UI.label(tag, 20, UI.MUTED, false, 700))
		h.add_child(col)
		if host and i > 0:
			var x := UI.icon_button("close", 64)
			var idx := i
			x.pressed.connect(func() -> void: Session.remove_seat(idx))
			h.add_child(x)
		v.add_child(h)
	if host and Session.seats.size() < 6:
		var add := UI.button("+ Бот", "ghost", 24)
		add.custom_minimum_size = Vector2(0, 76)
		add.pressed.connect(Session.add_bot)
		v.add_child(add)
	v.add_child(UI.spacer(10))
	var st: Dictionary = Session.settings
	if host:
		v.add_child(UI.segmented(["Подкидной", "Переводной"], 1 if st.mode == "perevodnoy" else 0, func(i: int) -> void:
			Session.set_setting("mode", "perevodnoy" if i == 1 else "podkidnoy")))
		v.add_child(UI.segmented(["С обманом", "Честно"], 0 if st.cheats else 1, func(i: int) -> void:
			Session.set_setting("cheats", i == 0)))
		v.add_child(UI.segmented(["Лёгкие", "Норм", "Сильные"], int(st.level), func(i: int) -> void:
			Session.set_setting("level", i)))
	else:
		var txt := ("Переводной" if st.mode == "perevodnoy" else "Подкидной") + (" · с обманом" if st.cheats else " · честно")
		v.add_child(UI.label(txt, 26, UI.TEXT, false, 700))
	_fill_space(v)
	if host:
		var start := UI.button("Начать", "primary", 34)
		start.custom_minimum_size.y = 110
		start.disabled = Session.seats.size() < 2
		start.pressed.connect(func() -> void:
			var err := Session.start_game()
			if err != "":
				_toast(err))
		v.add_child(start)
	else:
		var w := HBoxContainer.new()
		w.alignment = BoxContainer.ALIGNMENT_CENTER
		w.add_theme_constant_override("separation", 12)
		w.add_child(SuitVideo.new(34))
		var l := UI.label("Ждём, когда хост начнёт", 24, UI.MUTED, false, 700)
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		w.add_child(l)
		v.add_child(w)


# ================================================================ правила

func _rules() -> void:
	var v := _page("Правила")
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(sc)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 22)
	sc.add_child(col)
	var parts := [
		["Цель", "Избавиться от карт. Кто вышел — «Гап нест!». Последний с картами — дурак, ему «Чумо»."],
		["Колода", "36 карт, от шестёрки до туза (В — валет, Д — дама, К — король, Т — туз). Всем по 6, нижняя карта колоды — козырь."],
		["Ход", "Первым ходит тот, у кого младший козырь. Отбиваются старшей картой той же масти или козырем."],
		["Подкидной", "Подкидывать можно карты тех достоинств, что уже на столе. В первом отбое — до 5 карт, потом до 6, и не больше, чем карт у отбивающегося."],
		["Пас и Беру", "Не можешь отбиться — нажми «Беру»: заберёшь все карты со стола. Нападающие, когда больше не хотят подкидывать, нажимают «Пас». Кон заканчивается, когда все сказали «Пас»."],
		["Переводной", "Пока ни одна карта не побита, можно положить карту того же достоинства — и отбиваться будет следующий."],
		["Добор", "После кона все добирают до 6: сначала ходивший, отбивавшийся — последним."],
		["Обман", "Можно побить не той картой или подкинуть не то достоинство — игра пропустит. Но любой может коснуться такой карты и нажать «Обман?», и она вернётся владельцу. Ошибся с обвинением — до конца кона ловить больше нельзя."],
		["Управление", "Коснись карты, чтобы выбрать, ещё раз — сыграть. Или перетащи на стол или на карту, которую бьёшь."],
	]
	for p in parts:
		var b := VBoxContainer.new()
		b.add_theme_constant_override("separation", 6)
		b.add_child(UI.label(p[0], 30, UI.TEXT, true, 700))
		var t := UI.label(p[1], 25, UI.TEXT, false, 500)
		t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		t.custom_minimum_size = Vector2(600, 0)
		b.add_child(t)
		col.add_child(b)
