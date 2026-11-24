"""Clay tandoor (tanur) on a mud-brick platform (supa)."""
import math
S = 1024
PL_X, PL_Y, PL_H = 1.4, 1.3, 0.45
NSEG = 24
def profile():
    z = PL_H
    outer = [(0.50, z), (0.535, z + 0.08), (0.56, z + 0.22), (0.555, z + 0.38), (0.52, z + 0.55), (0.45, z + 0.70),
             (0.35, z + 0.82), (0.26, z + 0.90), (0.215, z + 0.94)]
    rim = [(0.24, z + 0.955), (0.25, z + 0.985), (0.225, z + 1.0), (0.195, z + 0.99)]
    inner = [(0.19, z + 0.95), (0.27, z + 0.85), (0.40, z + 0.65), (0.44, z + 0.40), (0.38, z + 0.18), (0.22, z + 0.08), (0.02, z + 0.06)]
    return outer + rim + inner, len(outer), len(outer) + len(rim)
DEV_LEN = 2.6
ISL = {
    'lathe': (0, 0, 1024, 640, DEV_LEN / 640),
    'plat_top': (0, 644, 380, 352, 1 / 270.0),
    'plat_side': (384, 644, 640, 130, 1 / 270.0),
}
