"""Joint positions for the DUSHANBE player rig (Blender coords: Z up, character faces -Y).
Measured from cross-sections of main_character.glb (A-pose, 1.75 m)."""

# name: (head, tail, parent, connected)
def _m(p):  # mirror right(-X) -> left(+X)
    return (-p[0], p[1], p[2])

R = {
    'shoulder': ((-0.030, 0.000, 1.420), (-0.175, 0.010, 1.380)),
    'upper_arm': ((-0.175, 0.010, 1.380), (-0.295, 0.020, 1.100)),
    'forearm': ((-0.295, 0.020, 1.100), (-0.390, -0.025, 0.845)),
    'hand': ((-0.390, -0.025, 0.845), (-0.405, -0.055, 0.760)),
    'fingers': ((-0.405, -0.055, 0.760), (-0.395, -0.065, 0.700)),
    'thigh': ((-0.100, 0.000, 0.900), (-0.152, 0.010, 0.490)),
    'shin': ((-0.152, 0.010, 0.490), (-0.205, 0.045, 0.090)),
    'foot': ((-0.205, 0.045, 0.090), (-0.255, -0.072, 0.032)),
    'toe': ((-0.255, -0.072, 0.032), (-0.272, -0.135, 0.022)),
}
PARENT = {'shoulder': 'spine2', 'upper_arm': 'shoulder', 'forearm': 'upper_arm', 'hand': 'forearm',
          'fingers': 'hand', 'thigh': 'hips', 'shin': 'thigh', 'foot': 'shin', 'toe': 'foot'}

BONES = [
    # name, head, tail, parent, connected
    ('root', (0, 0, 0), (0, 0.25, 0), None, False),
    ('hips', (0, 0.0, 0.930), (0, 0.0, 1.030), 'root', False),
    ('spine', (0, 0.0, 1.030), (0, 0.0, 1.150), 'hips', True),
    ('spine1', (0, 0.0, 1.150), (0, 0.0, 1.280), 'spine', True),
    ('spine2', (0, 0.0, 1.280), (0, 0.0, 1.440), 'spine1', True),
    ('neck', (0, 0.0, 1.440), (0, -0.020, 1.540), 'spine2', True),
    ('head', (0, -0.020, 1.540), (0, -0.020, 1.750), 'neck', True),
]
for n, (h, t) in R.items():
    p = PARENT[n]
    conn = n in ('forearm', 'hand', 'fingers', 'shin', 'foot', 'toe', 'upper_arm')
    for side, f in (('R', lambda q: q), ('L', _m)):
        par = p if p in ('spine2', 'hips') else p + '.' + side
        BONES.append((n + '.' + side, f(h), f(t), par, conn))
