"""Road network of the DUSHANBE-X world.

City streets are laid out as a grid (straight, given), country / mountain roads are ROUTED over the
terrain between waypoints with A* on a 16 m grid: the cost punishes grades above the road class
limit, so on steep slopes the route zig-zags into real serpentines; rivers may only be crossed
(short, ~perpendicular) and lakes are avoided. Routes are smoothed (Chaikin), resampled to 4 m and
get a longitudinal profile: smoothed terrain, grade-limited. Where the profile runs > 5 m above the
ground over water / a gorge the span becomes a BRIDGE; > 14 m below the ground over > 60 m a TUNNEL.
"""
import heapq, math
import numpy as np
import terrain as T

G = 16.0                       # routing grid (m)


class Router:
    def __init__(self):
        self.nx = int(T.SIZE / G) + 1
        xs = T.X0 + np.arange(self.nx) * G
        zs = T.Z0 + np.arange(self.nx) * G
        X, Z = np.meshgrid(xs, zs)
        F = T.heights(X, Z)
        self.H = F["h"]
        rv = np.minimum(np.minimum(F["d_var"], F["d_gis"]), np.minimum(F["d_east"], F["d_trib"]))
        self.river = rv < 20.0
        self.lake = (F["lake_d"] < 1.05) | (F["kom_d"] < 1.05)
        self.taken = np.zeros_like(self.H, bool)        # cells used by earlier roads (merging allowed, cheap)

    def cell(self, x, z):
        return (int(round((z - T.Z0) / G)), int(round((x - T.X0) / G)))

    def route(self, a, b, gmax, margin=900.0, curv=0.6):
        """A* from point a to b (x, z): returns a list of (x, z)"""
        ja, ia = self.cell(*a); jb, ib = self.cell(*b)
        m = int(margin / G)
        j0, j1 = max(0, min(ja, jb) - m), min(self.nx - 1, max(ja, jb) + m)
        i0, i1 = max(0, min(ia, ib) - m), min(self.nx - 1, max(ia, ib) + m)
        H = self.H; R = self.river; Lk = self.lake
        moves = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1),
                 (2, 1), (2, -1), (-2, 1), (-2, -1), (1, 2), (1, -2), (-1, 2), (-1, -2)]
        mv = [(dj, di, G * math.hypot(dj, di)) for dj, di in moves]
        start = (ja, ia); goal = (jb, ib)
        gs = {start: 0.0}; came = {}
        hq = [(0.0, start)]
        while hq:
            f, cur = heapq.heappop(hq)
            if cur == goal:
                break
            g0 = gs[cur]
            cj, ci = cur
            h0 = H[cj, ci]
            for dj, di, L in mv:
                nj, ni = cj + dj, ci + di
                if nj < j0 or nj > j1 or ni < i0 or ni > i1:
                    continue
                if Lk[nj, ni]:
                    continue
                gr = abs(H[nj, ni] - h0) / L
                c = L
                if gr > gmax:
                    c += L * 400.0 * (gr - gmax)            # steeper than the class allows: very expensive
                c += L * 2.5 * gr                            # prefer flatter lines anyway
                if R[nj, ni]:
                    c += 60.0                                # a bridge: short crossings only
                if self.taken[nj, ni]:
                    c *= 0.7                                 # join existing roads rather than run parallel
                ng = g0 + c
                k = (nj, ni)
                if ng < gs.get(k, 1e18):
                    gs[k] = ng; came[k] = cur
                    hh = math.hypot(nj - jb, ni - ib) * G
                    heapq.heappush(hq, (ng + hh, k))
        if goal not in came and goal != start:
            raise RuntimeError("no route %s -> %s" % (a, b))
        path = [goal]
        while path[-1] != start:
            path.append(came[path[-1]])
        path.reverse()
        for (j, i) in path:
            self.taken[j, i] = True
        return [(T.X0 + i * G, T.Z0 + j * G) for (j, i) in path]


def smooth_route(pts, step=4.0):
    P = np.asarray(pts, np.float64)
    # drop collinear grid points, then Chaikin to round the corners (hairpins ~ 10-15 m radius)
    keep = [P[0]]
    for k in range(1, len(P) - 1):
        d1 = P[k] - keep[-1]; d2 = P[k + 1] - P[k]
        if abs(d1[0] * d2[1] - d1[1] * d2[0]) > 1e-6 or np.linalg.norm(P[k] - keep[-1]) > 64:
            keep.append(P[k])
    keep.append(P[-1])
    P = T.chaikin(keep, 3)
    return T.resample(P, step)


def profile(P, H_at, gmax, win=60.0, step=4.0):
    """longitudinal heights: terrain smoothed over `win` m, then grade-limited both ways"""
    h = H_at(P[:, 0], P[:, 1])
    n = max(1, int(win / step))
    k = np.exp(-0.5 * (np.arange(-2 * n, 2 * n + 1) / n) ** 2); k /= k.sum()
    hp = np.convolve(np.pad(h, 2 * n, mode="edge"), k, mode="same")[2 * n:-2 * n]
    lim = gmax * step
    for _ in range(3):
        for i in range(1, len(hp)):
            hp[i] = np.clip(hp[i], hp[i - 1] - lim, hp[i - 1] + lim)
        for i in range(len(hp) - 2, -1, -1):
            hp[i] = np.clip(hp[i], hp[i + 1] - lim, hp[i + 1] + lim)
    return hp, h


def structures(P, hp, h, water, step=4.0, allow_tunnels=True, bridge_h=5.0):
    """bridge / tunnel spans as index ranges"""
    above = hp - h
    br = []; tu = []
    i = 0; n = len(P)
    while i < n:
        if above[i] > bridge_h or (water[i] and above[i] > -0.5):
            j = i
            while j < n and (above[j] > 1.5 or water[j]):
                j += 1
            a = max(0, i - 3); b = min(n - 1, j + 3)
            if (b - a) * step >= 12:
                br.append([a, b])
            i = j + 1
            continue
        if allow_tunnels and above[i] < -14.0:
            j = i
            while j < n and above[j] < -7.0:
                j += 1
            if (j - i) * step >= 100:
                tu.append([max(0, i - 4), min(n - 1, j + 4)])
            i = j + 1
            continue
        i += 1
    return br, tu
