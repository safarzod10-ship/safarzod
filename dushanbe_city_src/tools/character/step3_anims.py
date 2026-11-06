"""Step 3: author all player animations (in place, root motion not baked) and save the rig .blend.
blender -b --python step3_anims.py -- <in.blend> <out.blend> <stats.json>"""
import bpy, sys, os, math, json
import numpy as np
from mathutils import Matrix
sys.path.insert(0, os.path.dirname(__file__))
from anim_lib import (Rig, Gait, solve, default_params, hip_joint, foot_free, FPS, smooth, D2R)

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0])
arm = bpy.data.objects['PlayerArmature']
rig = Rig(arm)
STATS = {}

TAU = 2 * math.pi


# ----------------------------------------------------------------------------- keyframing
def write_action(name, frames):
    """frames: list of (P, feet|None). Keys every frame; frame count N = len-1 (last == first for loops)."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    prev = {}
    max_err = 0.0
    for f, (P, feet) in enumerate(frames):
        q, loc, errs, head = solve(rig, P, feet)
        max_err = max(max_err, max(abs(e) for e in errs.values()))
        for n in rig.names:
            pb = arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            qq = Matrix(q[n].tolist()).to_quaternion()
            if n in prev and prev[n].dot(qq) < 0:
                qq.negate()
            prev[n] = qq.copy()
            pb.rotation_quaternion = qq
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if n == 'hips':
                pb.location = loc.tolist()
                pb.keyframe_insert('location', frame=f)
            elif n != 'root' and f == 0:
                pb.location = (0, 0, 0)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act.frame_range = (0, len(frames) - 1)
    act.use_frame_range = True
    print(f'{name}: {len(frames) - 1} frames, max IK reach error {max_err * 1000:.1f} mm')
    STATS.setdefault(name, {})['frames'] = len(frames) - 1
    STATS[name]['length_s'] = (len(frames) - 1) / FPS
    STATS[name]['ik_err_mm'] = round(max_err * 1000, 2)
    return act


def cyclic_min_smooth(x, cons, w, sigma):
    """erode then blur (cyclic) so that the result stays below the constraint, then clamp"""
    n = len(x)
    er = np.array([min(x[(i + k) % n] for k in range(-w, w + 1)) for i in range(n)])
    ks = np.arange(-3 * sigma, 3 * sigma + 1)
    g = np.exp(-0.5 * (ks / sigma) ** 2); g /= g.sum()
    bl = np.array([sum(g[j] * er[(i + int(k)) % n] for j, k in enumerate(ks)) for i in range(n)])
    return np.minimum(bl, cons)


# ----------------------------------------------------------------------------- gaits
def gait_upper(P, g, phi):
    c = math.cos(TAU * phi)
    P['h_yaw'] = -g.yaw * c
    P['h_roll'] = g.roll * math.sin(TAU * phi)
    P['hx'] = g.sway * math.sin(TAU * (phi - 0.05))
    P['h_pitch'] = g.hpitch
    P['sp_pitch'] = g.lean + g.nod * math.cos(2 * TAU * (phi - g.low))
    P['sp_yaw'] = g.yaw * g.counter * c
    P['sp_roll'] = -0.6 * P['h_roll']
    P['hd_yaw'] = -(P['h_yaw'] + P['sp_yaw'])
    P['hd_roll'] = -0.3 * (P['h_roll'] + P['sp_roll'])
    P['hd_pitch'] = -0.5 * g.lean - g.nod * math.cos(2 * TAU * (phi - g.low))
    ca = math.cos(TAU * (phi - g.arm_lag))
    for s, sg in (('L', -1.0), ('R', 1.0)):
        sw = sg * g.arm * ca
        P[f'sw_{s}'] = sw + g.arm_off
        fwd = 0.5 + 0.5 * sw / g.arm             # 1 when the arm is fully forward
        P[f'el_{s}'] = g.el0 + g.el1 * fwd
        P[f'ad_{s}'] = g.ad
        P[f'wr_{s}'] = g.wr * (fwd - 0.5)
        P[f'fc_{s}'] = g.fist
        P[f'cl_fw_{s}'] = 0.12 * sw
        P[f'tw_{s}'] = g.twist
    return P


def build_gait(name, g, hz_profile, k_reach, cap):
    N = g.frames
    phis = [f / N for f in range(N + 1)]
    Ps, feet_all, cons, prof = [], [], [], []
    for phi in phis:
        P = gait_upper(default_params(), g, phi)
        feet = {}
        for s, off in (('L', 0.0), ('R', 0.5)):
            A, G, Gt, st = g.foot(rig, s, phi + off)
            feet[s] = (A, G, Gt)
        P['hz'] = 0.0
        zmax = cap
        for s in ('L', 'R'):
            hj = hip_joint(rig, s, P)
            A = feet[s][0]
            Lr = k_reach * (rig.leg[s]['l1'] + rig.leg[s]['l2'])
            dxy2 = (hj[0] - A[0]) ** 2 + (hj[1] - A[1]) ** 2
            zmax = min(zmax, A[2] + math.sqrt(max(Lr * Lr - dxy2, 0.0)) - hj[2])
        Ps.append(P); feet_all.append(feet); cons.append(zmax); prof.append(hz_profile(phi))
    cons = np.array(cons[:-1]); prof = np.array(prof[:-1])
    hz = cyclic_min_smooth(np.minimum(prof, cons), cons, 2, 1.5)
    hz = np.append(hz, hz[0])
    for P, z in zip(Ps, hz):
        P['hz'] = float(z)
    STATS[name] = dict(speed_mps=g.v, cycle_s=g.cycle, stride_m=g.stride, step_m=g.stride / 2,
                       hip_drop_min_m=float(hz.min()), hip_drop_max_m=float(hz.max()))
    print(f'{name}: v={g.v} m/s cycle={g.cycle:.3f}s stride={g.stride:.3f} m  hz {hz.min():.3f}..{hz.max():.3f}')
    return write_action(name, list(zip(Ps, feet_all)))


WALK = Gait(frames=32, v=1.40, beta=0.61, y_strike=-0.33, s1=0.17, s2=0.52, p_strike=15.0,
            p_toeoff=50.0, rise_pow=1.7, x_foot=0.10, toe_out=7.0, swing_in=0.12, clearance=0.055,
            clr_skew=0.8, p_swing_mid=-4.0,
            yaw=5.0, roll=3.5, sway=0.022, hpitch=2.0, lean=3.0, nod=0.8, low=0.0, counter=1.6,
            arm=19.0, arm_lag=0.03, arm_off=2.0, el0=12.0, el1=22.0, ad=11.0, wr=8.0, fist=20.0, twist=0.0)

RUN = Gait(frames=20, v=4.0, beta=0.31, y_strike=-0.30, s1=0.22, s2=0.40, p_strike=6.0,
           p_toeoff=55.0, rise_pow=1.5, x_foot=0.075, toe_out=5.0, swing_in=0.10, clearance=0.30,
           clr_skew=0.55, p_swing_mid=-22.0,
           yaw=8.0, roll=4.0, sway=0.012, hpitch=6.0, lean=9.0, nod=1.5, low=0.155, counter=1.5,
           arm=36.0, arm_lag=0.02, arm_off=6.0, el0=72.0, el1=22.0, ad=16.0, wr=10.0, fist=55.0, twist=8.0)

build_gait('walk', WALK, lambda phi: -0.018, 0.993, -0.018)
build_gait('run', RUN, lambda phi: -0.062 - 0.033 * math.cos(2 * TAU * (phi - RUN.low)), 0.995, 0.0)


# ----------------------------------------------------------------------------- idle / jump
IDLE_N = 120


def idle_params(t):
    """t in [0,1) over the 4 s idle loop"""
    P = default_params()
    a = TAU * t
    P.update(fx_L=0.125, fy_L=-0.035, to_L=12.0, fx_R=-0.13, fy_R=0.045, to_R=10.0)
    P['hx'] = 0.016 * math.sin(a)
    P['hz'] = -0.016 - 0.004 * (0.5 - 0.5 * math.cos(2 * a))
    P['h_roll'] = 1.3 * math.sin(a)
    P['h_yaw'] = 2.0 + 1.0 * math.sin(a + 0.6)
    P['sp_roll'] = -1.0 * math.sin(a)
    P['sp_yaw'] = -1.5 - 0.8 * math.sin(a + 0.6)
    P['sp_pitch'] = 1.0
    P['breath'] = 1.4 * math.sin(a)
    P['hd_yaw'] = 3.0 * math.sin(a + 1.2) + 1.2 * math.sin(2 * a)
    P['hd_pitch'] = 1.5 + 1.0 * math.sin(2 * a + 0.5)
    P['hd_roll'] = 0.6 * math.sin(a)
    for s, sg in (('L', 1.0), ('R', -1.0)):
        P[f'sw_{s}'] = 3.0 + 1.2 * math.sin(a + (0.4 if s == 'L' else 1.8))
        P[f'el_{s}'] = 14.0 + 2.0 * math.sin(a + 1.0)
        P[f'ad_{s}'] = 12.0 + 0.8 * sg * math.sin(a)
        P[f'fc_{s}'] = 20.0
        P[f'wr_{s}'] = 3.0
        P[f'cl_up_{s}'] = 0.8 * (0.5 + 0.5 * math.sin(a))
    return P


def keyed(N, keys, base):
    """Catmull-Rom interpolation of param dicts. keys: list of (frame, overrides); base: frame->P"""
    full = []
    for f, ov in keys:
        P = base(f); P.update(ov); full.append((f, P))
    out = []
    for f in range(N + 1):
        i = max(j for j in range(len(full)) if full[j][0] <= f) if f >= full[0][0] else 0
        i = min(i, len(full) - 2)
        f0, P0 = full[i]; f1, P1 = full[i + 1]
        u = min(max((f - f0) / (f1 - f0), 0.0), 1.0)
        Pm = full[i - 1][1] if i > 0 else P0
        Pp = full[i + 2][1] if i + 2 < len(full) else P1
        P = {}
        for k in P0:
            p0, p1, pm, pp = P0[k], P1[k], Pm[k], Pp[k]
            m0 = 0.5 * (p1 - pm) if i > 0 else 0.0
            m1 = 0.5 * (pp - p0) if i + 2 < len(full) else 0.0
            u2, u3 = u * u, u * u * u
            P[k] = ((2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1)
        out.append((P, None))
    return out


write_action('idle', [(idle_params(f / IDLE_N), None) for f in range(IDLE_N + 1)])

FALL_N = 30


def fall_params(t):
    P = default_params()
    a = TAU * t
    P.update(hz=-0.03, sp_pitch=5.0, h_pitch=4.0, hd_pitch=-6.0, breath=0.0)
    P.update(fx_L=0.12, fy_L=-0.10 + 0.04 * math.sin(a), lift_L=0.20 + 0.05 * math.sin(a), fp_L=-18.0,
             fx_R=-0.12, fy_R=0.06 - 0.04 * math.sin(a), lift_R=0.13 - 0.05 * math.sin(a), fp_R=-25.0,
             to_L=8.0, to_R=8.0, tb_L=10.0, tb_R=10.0)
    for s, sg in (('L', 1.0), ('R', -1.0)):
        ph = a + (0.0 if s == 'L' else math.pi)
        P[f'ad_{s}'] = -6.0 + 4.0 * math.sin(ph + 0.5)
        P[f'sw_{s}'] = 18.0 + 9.0 * math.sin(ph)
        P[f'el_{s}'] = 38.0 + 6.0 * math.sin(ph + 1.0)
        P[f'cl_up_{s}'] = 3.0
        P[f'fc_{s}'] = 15.0
        P[f'wr_{s}'] = -8.0
    return P


write_action('fall', [(fall_params(f / FALL_N), None) for f in range(FALL_N + 1)])

# jump_start: take-off extension (the body is already leaving the ground) -> fall pose
JS_N = 9
write_action('jump_start', keyed(JS_N, [
    (0, dict(hz=-0.05, sp_pitch=10.0, h_pitch=6.0, hd_pitch=-6.0, fp_L=-30.0, fp_R=-25.0,
             fy_L=-0.02, fy_R=0.06, sw_L=-20.0, sw_R=-20.0, el_L=25.0, el_R=25.0)),
    (3, dict(hz=0.0, sp_pitch=2.0, h_pitch=2.0, fp_L=-45.0, fp_R=-48.0, lift_L=0.05, lift_R=0.03,
             fy_L=-0.03, fy_R=0.06, sw_L=40.0, sw_R=35.0, el_L=30.0, el_R=30.0, cl_up_L=4.0, cl_up_R=4.0)),
    (JS_N, {}),
], lambda f: idle_params(0) if f < JS_N else fall_params(0)))

LAND_N = 15
LAND_FEET = dict(fx_L=0.125, fy_L=-0.035, to_L=12.0, fx_R=-0.13, fy_R=0.045, to_R=10.0, lift_L=0.0, lift_R=0.0,
                 fp_L=0.0, fp_R=0.0, tb_L=0.0, tb_R=0.0)


def land_base(f):
    if f == 0:
        P = fall_params(0); P.update(LAND_FEET); P['hz'] = -0.04; return P
    return idle_params(0)


write_action('land', keyed(LAND_N, [
    (0, {}),
    (3, dict(hz=-0.15, sp_pitch=16.0, h_pitch=9.0, hd_pitch=-10.0, sw_L=22.0, sw_R=18.0, el_L=40.0,
             el_R=42.0, ad_L=4.0, ad_R=4.0, fc_L=25.0, fc_R=25.0)),
    (8, dict(hz=-0.06, sp_pitch=6.0, h_pitch=4.0, hd_pitch=-3.0, sw_L=8.0, sw_R=7.0, el_L=22.0, el_R=22.0)),
    (LAND_N, {}),
], land_base))

arm.animation_data.action = bpy.data.actions['idle']
bpy.context.scene.render.fps = FPS
for a in bpy.data.actions:
    print('action', a.name, a.frame_range[:])
bpy.ops.wm.save_as_mainfile(filepath=argv[1])
json.dump(STATS, open(argv[2], 'w'), indent=1)
