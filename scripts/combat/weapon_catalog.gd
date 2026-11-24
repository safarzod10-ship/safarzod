class_name WeaponCatalog
extends RefCounted
## Weapons and grenades. Models are normalised at load (WeaponModel): barrel
## along -Z, sights up (+Y), origin at the pistol grip, real-world length.

const WEAPONS: Array[Dictionary] = [
	{
		"id": "aks74", "name": "АКС-74", "scene": "res://assets/weapons/aks74/aks74.glb",
		"length": 0.94, "flip": true, "roll": 0.0,
		"grip_f": Vector2(0.72, 0.45), "muzzle_yf": 0.81, "eject_zf": 0.55,
		"rpm": 650.0, "mag": 30, "reserve": 150, "damage": 34.0, "spread": 0.35, "recoil": 1.0,
		"sound": "shot_ak", "range": 300.0,
	},
	{
		"id": "m4", "name": "M4A1", "scene": "res://assets/weapons/m4/m4.glb",
		"length": 0.84, "flip": false, "roll": 0.0,
		"grip_f": Vector2(0.65, 0.25), "muzzle_yf": 0.6, "eject_zf": 0.54,
		"rpm": 800.0, "mag": 30, "reserve": 150, "damage": 28.0, "spread": 0.28, "recoil": 0.8,
		"sound": "shot_m4", "range": 300.0,
	},
]

const GRENADES: Array[Dictionary] = [
	{
		"id": "frag", "name": "РГД-5", "kind": "frag", "scene": "res://assets/weapons/rgd5/rgd5.glb",
		"size": 0.115, "fuse": 3.2, "count": 4, "radius": 9.0, "damage": 160.0,
	},
	{
		"id": "incendiary", "name": "Зажигательная", "kind": "fire", "scene": "res://assets/weapons/incendiary/incendiary.glb",
		"size": 0.14, "fuse": 2.2, "count": 3, "radius": 3.6, "damage": 22.0, "burn_time": 11.0,
	},
	{
		"id": "molotov", "name": "Коктейль Молотова", "kind": "fire", "scene": "res://assets/weapons/molotov/molotov.glb",
		"size": 0.28, "fuse": 0.0, "count": 3, "radius": 4.2, "damage": 18.0, "burn_time": 13.0, "impact": true,
	},
]


static func weapon(id: String) -> Dictionary:
	for w in WEAPONS:
		if w["id"] == id:
			return w
	return WEAPONS[0]


static func grenade(id: String) -> Dictionary:
	for g in GRENADES:
		if g["id"] == id:
			return g
	return GRENADES[0]
