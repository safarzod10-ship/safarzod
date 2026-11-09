extends Node
## screenshots + checks of the start menu: main, shop, buy dialog, promo code, about, settings
const OUT := "/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/"

func _snap(n: String) -> void:
	for i in 6:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OUT + "m_" + n + ".png")


func _ready() -> void:
	Account.no_save = true
	Wallet.no_save = true
	var m: Control = (load("res://scenes/menu/main_menu.tscn") as PackedScene).instantiate()
	add_child(m)
	await get_tree().process_frame
	await _snap("main")
	(m.get("_main_btns")["shop"] as Button).pressed.emit()
	await _snap("shop")
	(m.get("_shop_btns")["buy1"] as Button).pressed.emit()
	await _snap("buy")
	m.call("show_screen", "shop")
	var code: LineEdit = m.get("_code")
	code.text = "tajdush"
	var m0 := Wallet.money
	(m.get("_shop_btns")["ok"] as Button).pressed.emit()
	print("PROMO +", Wallet.money - m0)
	await _snap("promo")
	code.text = "TAJDUSH"
	(m.get("_shop_btns")["ok"] as Button).pressed.emit()
	print("PROMO again +", Wallet.money - m0 - 20000, " msg ", (m.get("_toast") as Label).text)
	(m.get("_shop_btns")["back"] as Button).pressed.emit()
	(m.get("_main_btns")["about"] as Button).pressed.emit()
	await _snap("about")
	(m.get("_main_btns")["settings"] as Button).pressed.emit()
	await _snap("settings")
	get_tree().quit()
