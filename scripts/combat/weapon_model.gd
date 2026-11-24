class_name WeaponModel
extends Node3D
## Normalised weapon / prop model (see WeaponCatalog).

var def: Dictionary = {}
var muzzle := Vector3.ZERO      ## local muzzle tip
var eject := Vector3.ZERO       ## local ejection port
var support := Vector3.ZERO     ## handguard point for the left palm
var bounds := AABB()


## Combined AABB of all meshes under `root`, in root space.
static func mesh_bounds(root: Node3D) -> AABB:
	var out := AABB()
	var first := true
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var x := AnimRetarget.rel_xform(mi, root)
		var a := x * mi.get_aabb()
		out = a if first else out.merge(a)
		first = false
	return out


static func create_weapon(id: String) -> WeaponModel:
	var w := WeaponModel.new()
	w.def = WeaponCatalog.weapon(id)
	w.name = "Weapon_" + id
	var m := (load(w.def["scene"]) as PackedScene).instantiate() as Node3D
	w.add_child(m)
	var b := mesh_bounds(m)
	# Longest axis is the barrel; second longest is the height (grip / magazine).
	var size := b.size
	var la := size.max_axis_index()
	var sa := size.min_axis_index()
	var ha := 3 - la - sa
	var axes := [Vector3.RIGHT, Vector3.UP, Vector3.BACK]
	var fwd: Vector3 = axes[la] * (-1.0 if w.def["flip"] else 1.0)
	var up: Vector3 = axes[ha]
	var basis := Basis(up.cross(-fwd).normalized(), up, -fwd).orthonormalized()  # columns: x, y, z(back)
	var s: float = float(w.def["length"]) / size[la]
	var rot := Basis(Vector3.FORWARD, deg_to_rad(float(w.def["roll"]))) * basis.inverse()
	m.transform = Transform3D(rot.scaled(Vector3.ONE * s), Vector3.ZERO)
	b = mesh_bounds(w)
	# origin -> pistol grip (fractions of the bounds: x = from muzzle along barrel, y = from bottom)
	var gf: Vector2 = w.def["grip_f"]
	m.position -= Vector3(b.get_center().x, b.position.y + b.size.y * gf.y, b.position.z + b.size.z * gf.x)
	w.bounds = mesh_bounds(w)
	b = w.bounds
	var barrel_y := b.position.y + b.size.y * float(w.def["muzzle_yf"])
	w.muzzle = Vector3(0.0, barrel_y, b.position.z)
	w.support = Vector3(0.0, barrel_y - 0.05, b.position.z * float(w.def.get("support_f", 0.5)))
	w.eject = Vector3(b.end.x, barrel_y, b.position.z + b.size.z * float(w.def["eject_zf"]))
	return w


static func create_prop(scene_path: String, longest: float) -> Node3D:
	var root := Node3D.new()
	var m := (load(scene_path) as PackedScene).instantiate() as Node3D
	root.add_child(m)
	var b := mesh_bounds(m)
	var s := longest / maxf(b.get_longest_axis_size(), 0.0001)
	m.transform = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * s), -b.get_center() * s)
	return root
