"""Majolica tile panel 1.2 x 1.6 m (6 x 8 tiles of 0.2 m) in a terracotta brick surround."""
S = 1024
PW, PH = 1.2, 1.6
TILE = 0.2
FRAME = 0.06
DEPTH = 0.03          # panel thickness (front at y = -DEPTH)
FDEPTH = 0.045        # brick surround protrusion
ISL = {
    'front': (0, 0, 768, 1024, PH / 1024),
    'brick': (772, 0, 252, 1024, 1 / 500.0),
}
