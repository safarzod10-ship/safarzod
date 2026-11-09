"""Re-draw assets/ui/world_map.png from the generated world (data/world: height / splat / biome bins +
world.json) without rebuilding the world:  python3 restyle_map.py"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import terrain as T
import places as PL

GAME = os.path.join(os.path.dirname(__file__), "..", "..", "..", "dushanbe_city")
D = os.path.join(GAME, "data", "world")
W = json.load(open(os.path.join(D, "world.json")))
n = T.N
H = np.fromfile(os.path.join(D, "height.bin"), dtype=np.float32).reshape(n, n)
splat = np.fromfile(os.path.join(D, "splat.bin"), dtype=np.uint8).reshape(n, n, 4) / 255.0
biome = np.fromfile(os.path.join(D, "biome.bin"), dtype=np.uint8).reshape(n, n, 4) / 255.0
PL.write_map(W, H, splat, biome, None, os.path.join(GAME, "assets", "ui", "world_map.png"))
print("ok")
