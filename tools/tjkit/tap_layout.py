"""Tapchan: raised wooden platform 2.0 x 1.6, deck at 0.45, low rail on 3 sides, carpet,
kurpacha quilts, bolsters, low table with dastarkhan, teapot, bowls, bread."""
S = 1024
LX, LY, DECK = 2.0, 1.6, 0.45
RAIL_TOP = 0.84
CARPET = (1.9, 1.5)
ISL = {
    'carpet': (0, 0, 640, 506, 1.9 / 640),
    'deck': (644, 0, 380, 506, 1 / 250.0),
    'ikat1': (0, 510, 512, 160, 1 / 280.0),
    'ikat2': (0, 674, 512, 160, 1 / 280.0),
    'cloth': (516, 510, 256, 172, 1 / 280.0),
    'ceramic': (776, 510, 248, 124, 1 / 600.0),
    'bread': (776, 638, 124, 124, 1 / 400.0),
    'plain': (0, 838, 1024, 186, 1 / 250.0),
}
