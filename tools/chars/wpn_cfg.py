# Weapon table: source file, kept/dropped nodes, axes, real length, grip origin and hand markers (unity coords, metres, relative to the grip).
# python3 -I tools/chars/wpn_cfg.py [keys] [-views] [-nowrite]   -> Assets/Weapons/Src/<key>/ + weapons.json
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from wpn import prep, OUT
def hand(p, N, F):
    """left-hand frame: palm normal N (towards the gripped part), finger direction F"""
    N = np.array(N, float); N /= np.linalg.norm(N); F = np.array(F, float); F -= N * F.dot(N); F /= np.linalg.norm(F)
    T = np.cross(F, N); a = np.radians(28.0)
    return {'p': p, 'f': (np.cos(a) * T + np.sin(a) * F).tolist(), 'u': N.tolist()}
def pt(p, f=None, u=None):
    d = {'p': p}
    if f: d['f'] = f; d['u'] = u
    return d
SUP = dict(N=(1, 0, 0), F=(0, -0.64, 0.77))       # pistol support hand: palm on the left side, fingers wrapping forward-down
CFG = {
 'knife': dict(id='b3c3a8c7', keep=['Object_2'], fwd='+z', up='+x', length=0.30, origin=[0, 0.050, 0.072],
               markers={'GripR': pt([0, 0, 0], [0, -0.978, -0.208], [0, -0.208, 0.978]), 'Muzzle': pt([0, -0.05, 0.228])}),
 'usp': dict(id='972e3643', fwd='+z', up='+y', length=0.194, origin=[0, 0.062, 0.048],
             markers={'GripR': pt([0, 0, 0]), 'GripL': hand([0.004, -0.008, 0.026], **SUP), 'Muzzle': pt([0, 0.071, 0.146]),
                      'MagGrip': pt([0, -0.030, -0.006]), 'SlideGrip': hand([0.0, 0.066, -0.01], (0.3, -1, 0), (1, 0, 0.2))},
             split=dict(node='Slide', part='Mag', box=[-0.07, 0.063, -0.045, 0.047]), parts={'Slide': ['Slide']}, slide=0.035),
 'deagle': dict(id='cabde59f', drop=['BulletCase_low', 'Bullet_low'], fwd='+z', up='+y', length=0.27, origin=[0, 0.060, 0.064],
                markers={'GripR': pt([0, 0, 0]), 'GripL': hand([0.004, -0.008, 0.026], **SUP), 'Muzzle': pt([0, 0.075, 0.206]),
                         'MagGrip': pt([0, -0.028, 0.004]), 'SlideGrip': hand([0.0, 0.072, -0.01], (0.3, -1, 0), (1, 0, 0.2))},
                parts={'Mag': ['Magazine_low', 'MagazineBase_low', 'BaseInside_low'],
                       'Slide': ['Slide_low', 'Safety_low', 'BoltMain_low', 'BoltAdd_low', 'RearSight_low', 'SlidePart_low', 'BoltButton_low', 'BoltBack_low']}, slide=0.045),
 'ak': dict(id='8b6ce774', drop=['accessories_*'], fwd='-z', up='+y', length=0.88, origin=[0, 0.155, 0.283],
            markers={'GripR': pt([0, 0, 0]), 'GripL': pt([0, 0.050, 0.307]), 'Muzzle': pt([0, 0.060, 0.597]),
                     'MagGrip': hand([0.012, -0.06, 0.185], (1, 0, 0), (0, -0.2, 1)), 'SlideGrip': hand([0.03, 0.075, 0.19], (0.6, -1, 0), (1, 0.2, 0))},
            parts={'Mag': ['lowerReceiver_h_low'], 'Slide': ['buttstock_j_low']}, slide=0.09),
 'awp': dict(id='5e985383', keep=['Cylinder001', 'Box001', 'Cylinder002', 'Object002', 'Box002', 'Box003', 'Box004', 'Cylinder003', 'Cylinder004'],
             fwd='+x', up='+y', length=1.2, origin=[0, 0.070, 0.322],
             markers={'GripR': pt([0, 0, 0]), 'GripL': pt([0, 0.040, 0.338]), 'Muzzle': pt([0, 0.072, 0.878]),
                      'MagGrip': hand([0.012, 0.012, 0.14], (1, 0, 0), (0, -0.2, 1)), 'SlideGrip': pt([0.05, 0.062, 0.075])},
             parts={'Mag': ['Box002'], 'Slide': ['Cylinder002', 'Object002']}, slide=0.08),
}
if __name__ == '__main__':
    only = sys.argv[1].split(',') if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else list(CFG)
    write = '-nowrite' not in sys.argv
    res = []
    for k in CFG:
        if k in only: prep(k, CFG[k], write=write, views='-views' in sys.argv)
        c = CFG[k]
        res.append({'key': k, 'markers': [dict(name=n, p=m['p'], f=m.get('f', [0, 0, 1]), u=m.get('u', [0, 1, 0])) for n, m in c['markers'].items()],
                    'parts': [dict(name=n, nodes=v) for n, v in c.get('parts', {}).items()],
                    'split': [dict(c['split'])] if 'split' in c else [], 'slide': c.get('slide', 0)})
    json.dump({'weapons': res}, open(os.path.join(OUT, 'weapons.json'), 'w'), indent=1)
