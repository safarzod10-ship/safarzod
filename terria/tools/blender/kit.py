"""
TERRIA building kit for Blender (run inside Blender's Python).

Everything a building script needs: an empty scene in metres, the game's
camera (orthographic, 2:1 isometric: 45 degrees around, 30 degrees above the
ground, looking north-west), the sun from the left of the screen, a shadow
catcher, stylised materials and mesh builders that merge thousands of
bevelled pieces into a few objects.

Blender axes: X = east, Y = north, Z = up. The game's world y points south,
so game (x, y) = Blender (X, -Y). A lot of N cells is N*16 m square, centred
on the origin.
"""
import json
import math
import random

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Matrix, Vector

CELL = 16.0
#: camera elevation: 30 degrees gives the 2:1 diamond of the game's map
ELEV = math.radians(30.0)
#: from the lot towards the camera (south-east)
CAM_DIR = Vector((math.cos(ELEV) * 0.70710678, -math.cos(ELEV) * 0.70710678, math.sin(ELEV)))
#: from the lot towards the sun: west-south-west, high (light from the screen's left,
#: short shadows that stay near the building, as in Clash of Clans)
_h = Vector((-1.0, -0.6, 0.0)).normalized()
_E = math.radians(58)
SUN_DIR = Vector((_h.x * math.cos(_E), _h.y * math.cos(_E), math.sin(_E)))


# --------------------------------------------------------------------------
# scene
# --------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 160
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 4
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    sc.view_settings.exposure = 0.35
    sc.render.threads_mode = 'AUTO'
    return sc


def setup_world(strength=1.0):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    # a soft blue sky from above, warmer near the horizon (fills the shade side)
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'LINEAR'
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.78, 0.74, 0.62, 1)
    ramp.color_ramp.elements[1].position = 0.45
    ramp.color_ramp.elements[1].color = (0.5, 0.66, 0.92, 1)
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    mapr = nt.nodes.new('ShaderNodeMapRange')
    mapr.inputs['From Min'].default_value = 0.5
    mapr.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs['Z'], mapr.inputs['Value'])
    nt.links.new(mapr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    return w


def setup_sun(energy=4.2, angle_deg=6.0, color=(1.0, 0.93, 0.8)):
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = energy
    ld.angle = math.radians(angle_deg)
    ld.color = color
    ob = bpy.data.objects.new('sun', ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (-SUN_DIR).to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup_camera(cells, res=1400, margin=1.32, lift=0.0):
    """Orthographic game camera centred over the lot (lift: move the view up, m)."""
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    lot_diag = cells * CELL * math.sqrt(2.0)
    cd.ortho_scale = lot_diag * margin
    cd.clip_start = 1
    cd.clip_end = 1000
    cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam)
    target = Vector((0, 0, 0))
    cam.location = target + CAM_DIR * 300
    cam.rotation_euler = (-CAM_DIR).to_track_quat('-Z', 'Y').to_euler()
    # shift the frame up so tall buildings fit (shift is in units of ortho_scale)
    cd.shift_y = lift / cd.ortho_scale
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return cam


def shadow_catcher(size=400):
    me = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('ground', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.is_shadow_catcher = True
    ob.location.z = 0.0
    return ob


def project(points):
    """World points -> pixel coordinates (x right, y down) of the render."""
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    cam = sc.camera
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    out = []
    for p in points:
        v = world_to_camera_view(sc, cam, Vector(p))
        out.append((v.x * rx, (1.0 - v.y) * ry))
    return out


def scale_building(factor, ground=0.0, keep=('square', 'kerb', 'ground', 'cam', 'sun')):
    """
    Scale everything but the lot (square, kerb), the camera and the light
    about the lot centre, keeping the building standing on `ground` (z).
    """
    for ob in bpy.context.scene.objects:
        if ob.name in keep:
            continue
        ob.location = ob.location * factor
        ob.location.z -= ground * (factor - 1.0)
        ob.scale = ob.scale * factor


def lot_meta(cells, extra=None):
    """Anchor (lot centre) and lot diamond width in pixels, plus named points."""
    h = cells * CELL / 2
    c, w, e = project([(0, 0, 0), (-h, -h, 0), (h, h, 0)])
    meta = {'ax': c[0], 'ay': c[1], 'dw': abs(e[0] - w[0]), 'cells': cells}
    if extra:
        names = list(extra.keys())
        pts = project([extra[n] for n in names])
        meta['points'] = {n: [round(p[0], 1), round(p[1], 1)] for n, p in zip(names, pts)}
    return meta


def render(path, meta_path=None, meta=None):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if meta_path and meta is not None:
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=1)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
def hexc(h):
    """'#rrggbb' (sRGB) -> linear RGB tuple for Blender colour sockets."""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def _node(nt, kind, loc=(0, 0)):
    n = nt.nodes.new(kind)
    n.location = loc
    return n


def material(name, color, rough=0.75, var=0.08, hue_var=0.015, noise_scale=1.6, noise_amt=0.12,
             emission=None, emission_strength=0.0, metallic=0.0, attr='rnd', bump=0.0, bump_scale=6.0):
    """
    Stylised base material: a colour with per-piece variation (the mesh
    attribute `attr`, 0..1 per piece), soft noise over the surface and an
    optional bump.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metallic
    base = _node(nt, 'ShaderNodeRGB')
    base.outputs[0].default_value = (*color, 1)
    # per-piece random value
    at = _node(nt, 'ShaderNodeAttribute')
    at.attribute_name = attr
    at.attribute_type = 'GEOMETRY'
    hsv = _node(nt, 'ShaderNodeHueSaturation')
    # hue +-hue_var, value 1 +- var
    hmath = _node(nt, 'ShaderNodeMath')
    hmath.operation = 'MULTIPLY_ADD'
    hmath.inputs[1].default_value = hue_var * 2
    hmath.inputs[2].default_value = 0.5 - hue_var
    vmath = _node(nt, 'ShaderNodeMath')
    vmath.operation = 'MULTIPLY_ADD'
    vmath.inputs[1].default_value = var * 2
    vmath.inputs[2].default_value = 1.0 - var
    nt.links.new(at.outputs['Fac'], hmath.inputs[0])
    nt.links.new(at.outputs['Fac'], vmath.inputs[0])
    nt.links.new(hmath.outputs[0], hsv.inputs['Hue'])
    nt.links.new(vmath.outputs[0], hsv.inputs['Value'])
    nt.links.new(base.outputs[0], hsv.inputs['Color'])
    # surface noise
    tc = _node(nt, 'ShaderNodeTexCoord')
    noise = _node(nt, 'ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = noise_scale
    noise.inputs['Detail'].default_value = 4.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    mix = _node(nt, 'ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'OVERLAY'
    mix.inputs['Factor'].default_value = noise_amt
    nt.links.new(hsv.outputs['Color'], mix.inputs['A'])
    nt.links.new(noise.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    if bump > 0:
        bn = _node(nt, 'ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        n2 = _node(nt, 'ShaderNodeTexNoise')
        n2.inputs['Scale'].default_value = bump_scale
        n2.inputs['Detail'].default_value = 6.0
        nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        nt.links.new(n2.outputs['Fac'], bn.inputs['Height'])
        nt.links.new(bn.outputs['Normal'], bsdf.inputs['Normal'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return m


def glass_material(name='glass', glow=(1.0, 0.72, 0.36), strength=1.6):
    """Window glass: dark blue-grey with a warm light inside."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.08, 0.1, 0.14, 1)
    bsdf.inputs['Roughness'].default_value = 0.12
    bsdf.inputs['Specular IOR Level'].default_value = 0.7
    bsdf.inputs['Emission Color'].default_value = (*glow, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return m


def cobble_material(name='cobble', a=(0.58, 0.53, 0.45), b=(0.43, 0.4, 0.35), mortar=(0.3, 0.27, 0.22), scale=0.9):
    """Cobblestones from a Voronoi pattern: rounded stones in darker mortar, with bump."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    tc = _node(nt, 'ShaderNodeTexCoord')
    mp = _node(nt, 'ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    vor = _node(nt, 'ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    nt.links.new(mp.outputs['Vector'], vor.inputs['Vector'])
    vor2 = _node(nt, 'ShaderNodeTexVoronoi')
    vor2.feature = 'F1'
    nt.links.new(mp.outputs['Vector'], vor2.inputs['Vector'])
    # stone colour per cell
    ramp_c = _node(nt, 'ShaderNodeValToRGB')
    ramp_c.color_ramp.elements[0].color = (*b, 1)
    ramp_c.color_ramp.elements[1].color = (*a, 1)
    nt.links.new(vor2.outputs['Color'], ramp_c.inputs['Fac'])
    # mortar mask
    edge = _node(nt, 'ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = 0.02
    edge.inputs['From Max'].default_value = 0.12
    nt.links.new(vor.outputs['Distance'], edge.inputs['Value'])
    mix = _node(nt, 'ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['B'].default_value = (*mortar, 1)
    inv = _node(nt, 'ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(edge.outputs['Result'], inv.inputs[1])
    nt.links.new(inv.outputs[0], mix.inputs['Factor'])
    nt.links.new(ramp_c.outputs['Color'], mix.inputs['A'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bump = _node(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    bump.inputs['Distance'].default_value = 0.25
    nt.links.new(edge.outputs['Result'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# --------------------------------------------------------------------------
# meshes
# --------------------------------------------------------------------------
class Pieces:
    """Many bevelled boxes (and other shapes) merged into one object."""

    def __init__(self, name, mat, bevel=0.12, segments=2, seed=1):
        self.name = name
        self.mat = mat
        self.bevel = bevel
        self.segments = segments
        self.bm = bmesh.new()
        self.rnd_layer = self.bm.faces.layers.float.new('rnd')
        self.rng = random.Random(seed)

    def box(self, size, loc, rot=(0, 0, 0), rnd=None):
        """Axis box of `size` (x, y, z) at `loc` (centre), rotated by Euler `rot` (radians)."""
        r = self.rng.random() if rnd is None else rnd
        m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        faces = {f for v in res['verts'] for f in v.link_faces}
        for f in faces:
            f[self.rnd_layer] = r
        return r

    def mesh_from(self, verts, faces, rnd=None):
        r = self.rng.random() if rnd is None else rnd
        vs = [self.bm.verts.new(v) for v in verts]
        for f in faces:
            face = self.bm.faces.new([vs[i] for i in f])
            face[self.rnd_layer] = r

    def lathe(self, profile, loc, segments=24, rnd=None):
        """Surface of revolution of profile [(radius, z)] around Z, at loc."""
        r = self.rng.random() if rnd is None else rnd
        rings = []
        for rad, z in profile:
            ring = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                ring.append(self.bm.verts.new((loc[0] + rad * math.cos(a), loc[1] + rad * math.sin(a), loc[2] + z)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(segments):
                k2 = (k + 1) % segments
                f = self.bm.faces.new([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]])
                f[self.rnd_layer] = r

    def build(self, smooth=False):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me)
        self.bm.free()
        # face attribute -> mesh attribute for the shader
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(self.mat)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        if self.bevel > 0:
            b = ob.modifiers.new('bevel', 'BEVEL')
            b.width = self.bevel
            b.segments = self.segments
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(40)
            b.harden_normals = False
        return ob


def tile_rows(p: Pieces, origin, along, down, length, slope_len, tile_w=1.45, tile_l=1.9, thick=0.26,
              overlap=0.42, jitter=0.05, stagger=True):
    """
    Rows of overlapping roof tiles on a sloped plane. `origin` is the top
    (ridge) corner, `along` a unit vector along the ridge, `down` a unit
    vector down the slope; tiles are laid from the ridge to the eave.
    """
    along = Vector(along).normalized()
    down = Vector(down).normalized()
    origin = Vector(origin)
    if along.cross(down).z < 0:
        # keep the frame right-handed: lay the tiles from the other end
        origin = origin + along * length
        along = -along
    normal = along.cross(down).normalized()
    # rotation: tile x along the ridge, y down the slope, z out of the roof
    rot = Matrix((along, down, normal)).transposed().to_euler()
    step = tile_l * (1 - overlap)
    rows = max(1, int(math.ceil(slope_len / step)))
    n = max(1, int(math.ceil(length / tile_w)))
    for r in range(rows):
        d = min(slope_len - tile_l / 2, r * step + tile_l / 2)
        off = (tile_w / 2) if (stagger and r % 2) else 0.0
        for i in range(n + (1 if off else 0)):
            x = i * tile_w - off + tile_w / 2
            if x - tile_w / 2 >= length or x + tile_w / 2 <= 0:
                continue
            w = tile_w * 0.94
            x0 = max(0.0, x - w / 2)
            x1 = min(length, x + w / 2)
            if x1 - x0 < 0.2:
                continue
            c = Vector(origin) + along * ((x0 + x1) / 2) + down * d + normal * (thick * 0.5 + r * 0.0)
            # tiles further down sit slightly proud: each row overlaps the next
            c += normal * (0.06 * ((r * 7 + i * 3) % 3))
            jr = p.rng.uniform(-jitter, jitter)
            p.box((x1 - x0, tile_l, thick), c, (rot.x + jr, rot.y, rot.z + p.rng.uniform(-jitter, jitter)))
    return rows


def stone_course(p: Pieces, start, direction, length, z0, height, depth, block=(1.6, 2.6), rows=None, gap=0.08):
    """Courses of stone blocks along a wall (start = left end at the wall face line)."""
    d = Vector(direction).normalized()
    side = Vector((-d.y, d.x, 0))
    rows = rows or max(1, int(round(height / 0.9)))
    rh = height / rows
    for r in range(rows):
        x = 0.0
        if r % 2:
            x = -p.rng.uniform(0.3, 0.8)
        while x < length:
            bl = p.rng.uniform(*block)
            x0 = max(0.0, x)
            x1 = min(length, x + bl)
            if x1 - x0 > 0.25:
                cx = (x0 + x1) / 2
                dd = depth + p.rng.uniform(-0.05, 0.1)
                c = Vector(start) + d * cx + side * (-dd / 2) + Vector((0, 0, z0 + r * rh + rh / 2))
                ang = math.atan2(d.y, d.x)
                p.box((x1 - x0 - gap, dd, rh - gap), c, (0, 0, ang))
            x += bl
