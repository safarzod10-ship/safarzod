extends Node
## Профиль игрока (имя, фото) и настройки. Хранится в user://.

signal changed

const CFG := "user://profile.cfg"
const AVATAR := "user://avatar.jpg"
const AVATAR_SIZE := 192

var player_name := ""
var uid := ""
var avatar: PackedByteArray = PackedByteArray()
var settings := {
	"bots": 2, "level": 1, "mode": "podkidnoy", "cheats": true,
	"sound": true, "vibro": true,
}


func _ready() -> void:
	var cf := ConfigFile.new()
	if cf.load(CFG) == OK:
		player_name = cf.get_value("p", "name", "")
		uid = cf.get_value("p", "uid", "")
		for k in settings.keys():
			settings[k] = cf.get_value("s", k, settings[k])
	if uid == "":
		uid = "%x%x" % [Time.get_ticks_usec(), randi()]
		save()
	if FileAccess.file_exists(AVATAR):
		avatar = FileAccess.get_file_as_bytes(AVATAR)


func has_profile() -> bool:
	return player_name.strip_edges() != ""


func save() -> void:
	var cf := ConfigFile.new()
	cf.set_value("p", "name", player_name)
	cf.set_value("p", "uid", uid)
	for k in settings.keys():
		cf.set_value("s", k, settings[k])
	cf.save(CFG)
	changed.emit()


## Обрезать фото в квадрат по центру, уменьшить и сохранить как JPEG.
func set_avatar_image(img: Image) -> void:
	if img == null or img.is_empty():
		return
	img.convert(Image.FORMAT_RGB8)
	var s := mini(img.get_width(), img.get_height())
	var x := (img.get_width() - s) / 2
	var y := (img.get_height() - s) / 2
	var sq := img.get_region(Rect2i(x, y, s, s))
	sq.resize(AVATAR_SIZE, AVATAR_SIZE, Image.INTERPOLATE_LANCZOS)
	avatar = sq.save_jpg_to_buffer(0.85)
	var f := FileAccess.open(AVATAR, FileAccess.WRITE)
	if f:
		f.store_buffer(avatar)
		f.close()
	changed.emit()


func clear_avatar() -> void:
	avatar = PackedByteArray()
	if FileAccess.file_exists(AVATAR):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(AVATAR))
	changed.emit()


static func texture_from_bytes(bytes: PackedByteArray) -> Texture2D:
	if bytes.is_empty():
		return null
	var img := Image.new()
	if img.load_jpg_from_buffer(bytes) != OK and img.load_png_from_buffer(bytes) != OK:
		return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func vibrate(ms: int) -> void:
	if settings.vibro and OS.has_feature("mobile"):
		Input.vibrate_handheld(ms)
