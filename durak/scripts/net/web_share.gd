class_name WebShare
extends Node
## Маленький HTTP-сервер на телефоне хоста: раздаёт веб-версию игры по Wi-Fi,
## чтобы iPhone открыл её в Safari (http://<IP хоста>:8080) без интернета.
## Веб-сборка лежит в res://web/durak_web.zip (её кладёт tools/build.sh).
## Большой .wasm хранится уже сжатым (.gz) и отдаётся с Content-Encoding: gzip.

const BUNDLE := "res://web/durak_web.zip"
const CHUNK := 65536
const MIME := {
	"html": "text/html; charset=utf-8", "js": "application/javascript", "wasm": "application/wasm",
	"pck": "application/octet-stream", "png": "image/png", "json": "application/json",
	"ico": "image/x-icon",
}

var _server := TCPServer.new()
var _files := {}     # "/path" -> {data: PackedByteArray, type: String, gz: bool}
var _conns: Array = []


static func available() -> bool:
	return FileAccess.file_exists(BUNDLE)


## Запустить на порту (или следующем свободном). Возвращает порт или 0.
func start(port: int) -> int:
	if not available() or not _load_bundle():
		return 0
	for p in range(port, port + 5):
		if _server.listen(p) == OK:
			return p
	return 0


func stop() -> void:
	for c in _conns:
		c.peer.disconnect_from_host()
	_conns.clear()
	_server.stop()


func _load_bundle() -> bool:
	var z := ZIPReader.new()
	if z.open(BUNDLE) != OK:
		return false
	for f in z.get_files():
		var data := z.read_file(f)
		var path := "/" + f
		var gz := false
		if path.ends_with(".gz"):
			path = path.trim_suffix(".gz")
			gz = true
		var ext := path.get_extension().to_lower()
		_files[path] = {"data": data, "type": MIME.get(ext, "application/octet-stream"), "gz": gz}
	z.close()
	return _files.has("/index.html")


func _process(_delta: float) -> void:
	if not _server.is_listening():
		return
	while _server.is_connection_available():
		var peer := _server.take_connection()
		peer.set_no_delay(true)
		_conns.append({"peer": peer, "req": PackedByteArray(), "out": PackedByteArray(), "pos": 0, "age": 0.0, "head_only": false})
	var keep: Array = []
	for c in _conns:
		if _serve(c):
			keep.append(c)
		else:
			c.peer.disconnect_from_host()
	_conns = keep


## Обслужить соединение. false — закрыть.
func _serve(c: Dictionary) -> bool:
	var peer: StreamPeerTCP = c.peer
	peer.poll()
	var st := peer.get_status()
	if st == StreamPeerTCP.STATUS_ERROR or st == StreamPeerTCP.STATUS_NONE:
		return false
	if st != StreamPeerTCP.STATUS_CONNECTED:
		return true
	c.age += get_process_delta_time()
	if c.out.is_empty():
		if c.age > 15.0:
			return false
		var n := peer.get_available_bytes()
		if n > 0:
			var r := peer.get_partial_data(n)
			if r[0] == OK:
				c.req.append_array(r[1])
		var text: String = c.req.get_string_from_utf8()
		if not text.contains("\r\n\r\n"):
			return c.req.size() < 16384
		_respond(c, text)
	# Отдаём ответ кусками, пока сокет принимает.
	for i in 16:
		if c.pos >= c.out.size():
			return false  # Connection: close
		var end := mini(c.pos + CHUNK, c.out.size())
		var want: int = end - c.pos
		var r := peer.put_partial_data(c.out.slice(c.pos, end))
		if r[0] != OK:
			return false
		var sent: int = r[1]
		c.pos += sent
		if sent < want:
			break  # буфер сокета полон — продолжим в следующем кадре
	c.age = 0.0
	return true


func _respond(c: Dictionary, text: String) -> void:
	var first := text.get_slice("\r\n", 0)
	var method := first.get_slice(" ", 0)
	var path := first.get_slice(" ", 1).get_slice("?", 0).uri_decode()
	if path == "/" or path == "":
		path = "/index.html"
	var head := ""
	var body := PackedByteArray()
	if (method == "GET" or method == "HEAD") and _files.has(path):
		var f: Dictionary = _files[path]
		body = f.data
		head = "HTTP/1.1 200 OK\r\nContent-Type: %s\r\n" % f.type
		if f.gz:
			head += "Content-Encoding: gzip\r\n"
	else:
		body = "Не найдено".to_utf8_buffer()
		head = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\n"
	head += "Content-Length: %d\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n" % body.size()
	var out := head.to_utf8_buffer()
	if method != "HEAD":
		out.append_array(body)
	c.out = out
	c.pos = 0
