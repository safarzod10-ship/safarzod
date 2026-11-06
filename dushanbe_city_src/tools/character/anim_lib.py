"""Procedural animation authoring for the DUSHANBE player rig (runs inside Blender).

Coordinate frame: Blender armature space, Z up, character faces -Y, ground z = 0.
Every FK bone gets an armature-space delta rotation D (rotation about the bone head, carried
by the parent's delta).  pose_bone.rotation_quaternion = Rrest^-1 * D * Rrest.
Legs are solved with an analytic two-bone IK so the feet follow exact ground trajectories.
"""
import math
import numpy as np

FPS = 30
Z = np.array([0.0, 0.0, 1.0])


# ----------------------------------------------------------------------------- math helpers
def rot(axis, ang):
    a = np.asarray(axis, float); a = a / np.linalg.norm(a)
    x, y, z = a; c, s = math.cos(ang), math.sin(ang); C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def nrm(v):
    return v / np.linalg.norm(v)


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def hermite(p0, p1, m0, m1, u):
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


def lerp(a, b, t):
    return a + (b - a) * t


D2R = math.pi / 180.0


# ----------------------------------------------------------------------------- rig model
class Rig:
    def __init__(self, arm_obj):
        self.names = [b.name for b in arm_obj.data.bones]
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm_obj.data.bones}
        self.head = {b.name: np.array(b.head_local[:]) for b in arm_obj.data.bones}
        self.tail = {b.name: np.array(b.tail_local[:]) for b in arm_obj.data.bones}
        self.R = {b.name: np.array(b.matrix_local.to_3x3()) for b in arm_obj.data.bones}
        # order parents first
        order, seen = [], set()
        def visit(n):
            if n in seen: return
            p = self.parent[n]
            if p: visit(p)
            seen.add(n); order.append(n)
        for n in self.names: visit(n)
        self.order = order
        self.leg = {}
        for s in ('L', 'R'):
            hip, knee, ank = self.head['thigh.' + s], self.head['shin.' + s], self.head['foot.' + s]
            ball, tip = self.head['toe.' + s], self.tail['toe.' + s]
            f0 = ball - ank; f0[2] = 0; f0 = nrm(f0)          # rest toe direction (splayed)
            heel = ank - 0.085 * f0; heel[2] = 0.0             # bottom-back of the boot heel
            u0 = nrm(ank - hip)
            v0 = nrm(f0 - f0.dot(u0) * u0)
            n0 = nrm(np.cross(v0, u0))
            self.leg[s] = dict(hip=hip, knee=knee, ank=ank, ball=ball, tip=tip, heel=heel, f0=f0,
                               l1=np.linalg.norm(knee - hip), l2=np.linalg.norm(ank - knee),
                               n0=n0, dt0=nrm(knee - hip), ds0=nrm(ank - knee),
                               yaw0=math.atan2(f0[1], f0[0]))
        self.arm = {}
        for s in ('L', 'R'):
            dirs = {}
            for b in ('upper_arm', 'forearm', 'hand', 'fingers'):
                d = nrm(self.tail[b + '.' + s] - self.head[b + '.' + s])
                hinge = nrm(np.array([d[2], 0.0, -d[0]]))   # cross(d, -Y): forward-flex axis
                dirs[b] = (d, hinge)
            self.arm[s] = dirs


def frame(x, y):
    """orthonormal frame with columns [x', y, x' x y] where x' is x orthogonalised to y"""
    y = nrm(y); x = nrm(x - x.dot(y) * y)
    return np.column_stack([x, y, np.cross(x, y)])


def leg_ik(rig, s, hip_w, A, pole):
    """returns (delta_thigh, delta_shin, reach_error)"""
    L = rig.leg[s]; l1, l2 = L['l1'], L['l2']
    d_vec = A - hip_w; d = np.linalg.norm(d_vec)
    dc = min(max(d, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.99995)
    u = d_vec / d
    v = nrm(pole - pole.dot(u) * u)
    a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    K = hip_w + a * u + h * v
    Aeff = hip_w + dc * u
    n = nrm(np.cross(v, u))
    dt, ds = nrm(K - hip_w), nrm(Aeff - K)
    Dt = frame(n, dt) @ frame(L['n0'], L['dt0']).T
    Ds = frame(n, ds) @ frame(L['n0'], L['ds0']).T
    return Dt, Ds, d - dc


# ----------------------------------------------------------------------------- pose model
def default_params():
    p = dict(hx=0.0, hy=0.0, hz=0.0, h_yaw=0.0, h_roll=0.0, h_pitch=0.0,
             sp_pitch=0.0, sp_yaw=0.0, sp_roll=0.0, nk_pitch=0.0, hd_pitch=0.0, hd_yaw=0.0, hd_roll=0.0,
             breath=0.0)
    for s in ('L', 'R'):
        p.update({f'sw_{s}': 0.0, f'ad_{s}': 12.0, f'el_{s}': 12.0, f'wr_{s}': 0.0, f'fc_{s}': 15.0,
                  f'tw_{s}': 0.0, f'cl_up_{s}': 0.0, f'cl_fw_{s}': 0.0,
                  # feet: ankle target (character frame), pitch(+ toes up), toe bend, toe-out yaw, pivot
                  f'fx_{s}': 0.12 if s == 'L' else -0.12, f'fy_{s}': 0.0, f'lift_{s}': 0.0,
                  f'fp_{s}': 0.0, f'tb_{s}': 0.0,
                  f'to_{s}': 8.0, f'kout_{s}': 0.15})
    return p


def foot_basis(rig, s, toe_out_deg):
    """yaw delta Y, desired forward f and lateral axis (rotation about lat by +p = toes up)"""
    sg = 1.0 if s == 'L' else -1.0
    want = -math.pi / 2 + sg * toe_out_deg * D2R
    Y = rot(Z, want - rig.leg[s]['yaw0'])
    f = np.array([math.cos(want), math.sin(want), 0.0])
    lat = nrm(np.cross(f, Z))
    return Y, f, lat


def foot_on_ground(rig, s, x, y, pitch_deg, toe_out_deg, toe_bend_deg=0.0, lift=0.0):
    """Place a foot whose flat-equivalent ankle is at (x,y) with ground contact preserved:
    pitch>0 rolls about the heel, pitch<0 about the ball (toe stays flat).
    Returns ankle target A (char frame), foot delta G, toe delta Gt."""
    L = rig.leg[s]
    Y, f, lat = foot_basis(rig, s, toe_out_deg)
    F = np.array([x, y, L['ank'][2] + lift])
    p = pitch_deg * D2R
    G = rot(lat, p) @ Y
    if p > 0:
        Pw = F + Y @ (L['heel'] - L['ank'])
        A = Pw + G @ (L['ank'] - L['heel'])
        Gt = rot(lat, p + toe_bend_deg * D2R) @ Y
    elif p < 0:
        Pw = F + Y @ (L['ball'] - L['ank'])
        A = Pw + G @ (L['ank'] - L['ball'])
        Gt = rot(lat, toe_bend_deg * D2R) @ Y                       # toe stays flat on the ground
    else:
        A = F; Gt = rot(lat, toe_bend_deg * D2R) @ Y
    if lift > 0.01:                         # airborne: toes follow the foot
        Gt = rot(lat, p + toe_bend_deg * D2R) @ Y
    return A, G, Gt


def solve(rig, P, feet=None):
    """P: params dict. feet: optional {side: (A, G, Gt)} overriding the param ankle targets.
    Returns (local quaternions dict as (w,x,y,z), hips location (local), reach errors, world heads)."""
    D = {n: np.eye(3) for n in rig.names}
    # pelvis
    D['hips'] = rot(Z, P['h_yaw'] * D2R) @ rot([0, -1, 0], P['h_roll'] * D2R) @ rot([1, 0, 0], P['h_pitch'] * D2R)
    br = P['breath']
    for b, w in (('spine', 0.3), ('spine1', 0.35), ('spine2', 0.35)):
        D[b] = (rot(Z, w * P['sp_yaw'] * D2R) @ rot([0, -1, 0], w * P['sp_roll'] * D2R)
                @ rot([1, 0, 0], (w * P['sp_pitch'] + (0.6 if b != 'spine' else -0.4) * br) * D2R))
    D['neck'] = rot([1, 0, 0], P['nk_pitch'] * D2R) @ rot(Z, 0.4 * P['hd_yaw'] * D2R)
    D['head'] = (rot(Z, 0.6 * P['hd_yaw'] * D2R) @ rot([0, -1, 0], P['hd_roll'] * D2R)
                 @ rot([1, 0, 0], P['hd_pitch'] * D2R))
    for s in ('L', 'R'):
        sg = 1.0 if s == 'L' else -1.0
        A = rig.arm[s]
        D['shoulder.' + s] = rot([0, 1, 0], -sg * (P[f'cl_up_{s}'] + 0.5 * br) * D2R) @ rot(Z, -sg * P[f'cl_fw_{s}'] * D2R)
        # upper arm: adduct towards the body (about forward axis), swing in the sagittal plane, twist
        ad = rot([0, 1, 0], sg * P[f'ad_{s}'] * D2R)
        d_ad = ad @ A['upper_arm'][0]
        sw_axis = nrm(np.array([d_ad[2], 0.0, -d_ad[0]]))
        D['upper_arm.' + s] = rot(d_ad, sg * P[f'tw_{s}'] * D2R) @ rot(sw_axis, P[f'sw_{s}'] * D2R) @ ad
        D['forearm.' + s] = rot(A['forearm'][1], P[f'el_{s}'] * D2R)
        D['hand.' + s] = rot(A['hand'][1], P[f'wr_{s}'] * D2R)
        D['fingers.' + s] = rot([0, 1, 0], sg * P[f'fc_{s}'] * D2R)
    # FK down to the hips joints
    T = np.array([P['hx'], P['hy'], P['hz']])
    tot, head = {}, {}
    for n in rig.order:
        par = rig.parent[n]
        if par is None:
            tot[n] = D[n]; head[n] = rig.head[n].copy(); continue
        if n == 'hips':
            tot[n] = tot[par] @ D[n]; head[n] = rig.head[n] + T; continue
        if n.startswith(('thigh', 'shin', 'foot', 'toe')):
            continue
        tot[n] = tot[par] @ D[n]
        head[n] = head[par] + tot[par] @ (rig.head[n] - rig.head[par])
    errs = {}
    for s in ('L', 'R'):
        hip_w = head['hips'] + tot['hips'] @ (rig.head['thigh.' + s] - rig.head['hips'])
        if feet and s in feet:
            Aw, G, Gt = feet[s]
        else:
            Aw, G, Gt = foot_free(rig, s, P)
        Y, f, lat = foot_basis(rig, s, P[f'to_{s}'])
        out = nrm(np.array([1.0 if s == 'L' else -1.0, 0, 0]))
        pole = nrm(f + P[f'kout_{s}'] * out)
        Dt, Ds, err = leg_ik(rig, s, hip_w, Aw, pole)
        errs[s] = err
        tot['thigh.' + s] = Dt; D['thigh.' + s] = tot['hips'].T @ Dt
        tot['shin.' + s] = Ds; D['shin.' + s] = Dt.T @ Ds
        tot['foot.' + s] = G; D['foot.' + s] = Ds.T @ G
        tot['toe.' + s] = Gt; D['toe.' + s] = G.T @ Gt
        head['thigh.' + s] = hip_w
        head['shin.' + s] = hip_w + Dt @ (rig.head['shin.' + s] - rig.head['thigh.' + s])
        head['foot.' + s] = head['shin.' + s] + Ds @ (rig.head['foot.' + s] - rig.head['shin.' + s])
        head['toe.' + s] = head['foot.' + s] + G @ (rig.head['toe.' + s] - rig.head['foot.' + s])
    q = {}
    for n in rig.names:
        Rr = rig.R[n]
        q[n] = Rr.T @ D[n] @ Rr
    loc = rig.R['hips'].T @ T
    return q, loc, errs, head


def foot_free(rig, s, P):
    """foot from params: flat-equivalent position fx/fy, ground-contact pitch fp, toe bend, lift"""
    return foot_on_ground(rig, s, P[f'fx_{s}'], P[f'fy_{s}'], P[f'fp_{s}'], P[f'to_{s}'],
                          P[f'tb_{s}'], P[f'lift_{s}'])


def hip_joint(rig, s, P):
    """world hip joint for params (used by height constraints)"""
    D = rot(Z, P['h_yaw'] * D2R) @ rot([0, -1, 0], P['h_roll'] * D2R) @ rot([1, 0, 0], P['h_pitch'] * D2R)
    T = np.array([P['hx'], P['hy'], P['hz']])
    return rig.head['hips'] + T + D @ (rig.head['thigh.' + s] - rig.head['hips'])


# ----------------------------------------------------------------------------- gait cycle
class Gait:
    """Cyclic gait with exact ground contact. Phase 0 = left heel/foot strike."""
    def __init__(self, **kw):
        self.__dict__.update(kw)
        self.cycle = self.frames / FPS                 # seconds
        self.stride = self.v * self.cycle              # metres per cycle (2 steps)

    def stance(self, rig, s, phi):
        """phi in [0, beta]: foot on the ground."""
        st = phi / self.beta
        y = self.y_strike + self.v * self.cycle * phi    # ground moves backwards (+Y) at v
        if st < self.s1:
            u = st / self.s1
            p = self.p_strike * (1 - u) ** 2
        elif st < self.s2:
            p = 0.0
        else:
            u = (st - self.s2) / (1 - self.s2)
            p = -self.p_toeoff * u ** self.rise_pow
        tb = 0.0
        return foot_on_ground(rig, s, self.foot_x(s), y, p, self.toe_out, tb), p

    def foot_x(self, s):
        return self.x_foot if s == 'L' else -self.x_foot

    def foot(self, rig, s, phi):
        phi = phi % 1.0
        if phi <= self.beta:
            (A, G, Gt), p = self.stance(rig, s, phi)
            return A, G, Gt, True
        u = (phi - self.beta) / (1 - self.beta)
        e = 1e-4
        (A0, _, _), p0 = self.stance(rig, s, self.beta)
        (A0e, _, _), _ = self.stance(rig, s, self.beta - e)
        (A1, _, _), p1 = self.stance(rig, s, 0.0)
        (A1e, _, _), _ = self.stance(rig, s, e)
        span = 1 - self.beta
        m0 = (A0 - A0e) / e * span
        m1 = (A1e - A1) / e * span
        A = np.array([hermite(A0[i], A1[i], m0[i], m1[i], u) for i in range(3)])
        A[0] = self.foot_x(s) * (1 - self.swing_in * math.sin(math.pi * u))
        w = u ** self.clr_skew
        A[2] += self.clearance * math.sin(math.pi * w) ** 2
        # foot pitch during swing: heel-up at toe-off -> toes-up for strike
        pmid = self.p_swing_mid
        if u < 0.5:
            p = hermite(p0, pmid, 0.0, 0.0, u / 0.5)
        else:
            p = hermite(pmid, p1, 0.0, 0.0, (u - 0.5) / 0.5)
        tb = self.p_toeoff * (1 - smooth(0.0, 0.45, u))   # toe relaxes after push-off
        Y, f, lat = foot_basis(rig, s, self.toe_out)
        G = rot(lat, p * D2R) @ Y
        Gt = rot(lat, (p + tb) * D2R) @ Y
        return A, G, Gt, False
