"""DUSHANBE city relief: one smooth height function shared by the city generator (roads, sidewalks,
lawns, buildings, props, colliders) and the coast generator (terrain heightmap / collision), so the
visible city, its collision and the surrounding land always agree.

The city rises to the north (towards the mountains, ~3 m over 600 m) with soft undulations
(+-1.3 m, wavelengths 300-1100 m): range -0.2 .. +4.0 m, max grade ~1.4 % (comfortable streets and
level-floored buildings, no flat "platform"). Defined everywhere, the coast blends into it.
Works on floats and numpy arrays.
"""
import math

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None


def _sin(v):
    return np.sin(v) if np is not None and not isinstance(v, (int, float)) else math.sin(v)


def _cos(v):
    return np.cos(v) if np is not None and not isinstance(v, (int, float)) else math.cos(v)


def city_relief(x, z):
    """height offset (m) of the ground at world (x, z); +X east, -Z north"""
    return (1.7 + 1.5 * (-z / 300.0)
            + 0.9 * _sin(x / 140.0 + 0.6) * _cos(z / 170.0 - 0.3)
            + 0.45 * _sin((x + 0.6 * z) / 95.0 + 1.1))


def max_grade(step=2.0):
    """numerical max slope of the relief inside the city (for tests/docs)"""
    best = 0.0
    x = -300.0
    while x <= 300.0:
        z = -300.0
        while z <= 300.0:
            gx = (city_relief(x + step, z) - city_relief(x - step, z)) / (2 * step)
            gz = (city_relief(x, z + step) - city_relief(x, z - step)) / (2 * step)
            best = max(best, math.hypot(gx, gz))
            z += 10.0
        x += 10.0
    return best


if __name__ == "__main__":
    vals = [city_relief(x, z) for x in range(-300, 301, 10) for z in range(-300, 301, 10)]
    print("relief range %.2f .. %.2f m, max grade %.2f %%" % (min(vals), max(vals), max_grade() * 100))
