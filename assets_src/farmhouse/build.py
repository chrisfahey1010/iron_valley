#!/usr/bin/env python3
"""Build the Iron Valley low-poly Fachwerk (German half-timbered) farmhouse.

Outputs:
  assets_src/farmhouse/farmhouse.blend   (editable source)
  public/models/farmhouse.glb             (game asset, ~14m footprint, origin at ground center)

Run:
  ~/.local/bin/blender --background --factory-startup --disable-autoexec \
    --offline-mode --threads 6 --python-exit-code 1 --python build.py
"""
import bpy
import math
import os

LENGTH_M = 14.0   # long axis (x)
WIDTH_M = 8.0     # short axis (z)
WALL_H = 4.6
RIDGE_H = 8.2     # apex height
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
BLEND_OUT = os.path.join(SCRIPT_DIR, 'farmhouse.blend')
GLB_OUT = os.path.join(PROJECT, 'public', 'models', 'farmhouse.glb')

PLASTER = (0.92, 0.86, 0.70, 1.0)   # cream
TIMBER = (0.23, 0.16, 0.11, 1.0)    # dark timber
ROOF = (0.24, 0.23, 0.27, 1.0)      # dark slate
STONE = (0.45, 0.41, 0.36, 1.0)     # chimney
DARK = (0.12, 0.10, 0.09, 1.0)      # door/windows

bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    try:
        m.use_backface_culling = False
    except Exception:
        pass
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    return m

plaster_mat = mat('Plaster', PLASTER)
timber_mat = mat('Timber', TIMBER, 0.9)
roof_mat = mat('Roof', ROOF, 0.8)
stone_mat = mat('Stone', STONE, 0.95)
dark_mat = mat('Dark', DARK, 0.6)

def box(name, cx, cy, cz, sx, sy, sz, material, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, cz))
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o

def prism_gable(name, x, material):
    # triangle wall at x = const, spanning z -WIDTH/2..WIDTH/2 at WALL_H, apex at RIDGE_H
    hw = WIDTH_M / 2
    verts = [(x, -hw, WALL_H), (x, hw, WALL_H), (x, 0, RIDGE_H)]
    faces = [(0, 1, 2)]
    bm = bpy.data.meshes.new(name + 'Mesh')
    bm.from_pydata(verts, [], faces)
    bm.update()
    bm.polygons[0].use_smooth = False
    obj = bpy.data.objects.new(name, bm)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj

hx = LENGTH_M / 2
hz = WIDTH_M / 2

# Plaster base box (walls)
box('PlasterWalls', 0, 0, WALL_H / 2, LENGTH_M, WIDTH_M, WALL_H, plaster_mat)

# Gable-end plaster triangles
prism_gable('GableL', -hx, plaster_mat)
prism_gable('GableR', hx, plaster_mat)

# Plinth stone band
box('Plinth', 0, 0, 0.25, LENGTH_M + 0.3, WIDTH_M + 0.3, 0.5, stone_mat)

# Timber frame on front/back (z = +/-hz) faces
for side in [-1, 1]:
    z = side * (hz + 0.06)
    # corner posts
    for x in (-hx + 0.15, hx - 0.15):
        box(f'Post{side}{x}', x, z, WALL_H / 2, 0.3, 0.14, WALL_H, timber_mat)
    # horizontal rails
    for y in (0.55, 2.3, 4.15):
        box(f'Rail{side}{y}', 0, z, y, LENGTH_M, 0.14, 0.28, timber_mat)
    box(f'TopPlate{side}', 0, z, WALL_H - 0.1, LENGTH_M, 0.16, 0.3, timber_mat)
    # vertical intermediate posts
    for x in (-hx * 0.5, 0, hx * 0.5):
        box(f'MidPost{side}{x}', x, z, WALL_H / 2, 0.24, 0.14, WALL_H, timber_mat)
    # diagonal braces (alternating herringbone)
    for x0, x1 in [(-hx + 0.3, -hx * 0.5), (-hx * 0.5 + 0.3, 0), (0.3, hx * 0.5), (hx * 0.5 + 0.3, hx - 0.3)]:
        yc = 1.45
        dx = x1 - x0
        dy = 2.3 - 0.55
        ang = math.atan2(dy, dx)
        length = math.hypot(dx, dy)
        cx = (x0 + x1) / 2
        # brace on lower panel between rails y=0.55 and y=2.3
        box(f'Brace{side}{x0:.1f}', cx, z, yc, length, 0.12, 0.18, timber_mat,
            rot=(0, 0, ang))

# Roof: two sloped boxes
rise = RIDGE_H - WALL_H
overhang = 0.7
half_span = hz + overhang
slope_len = math.hypot(half_span, rise)
roof_len_x = LENGTH_M + 2 * overhang
for side in [-1, 1]:
    cy = (RIDGE_H + WALL_H) / 2
    cz = side * half_span / 2
    theta = math.atan2(rise, -side * half_span)
    box(f'Roof{side}', 0, cz, cy, roof_len_x, slope_len, 0.28, roof_mat, rot=(theta, 0, 0))

# Ridge cap
box('RidgeCap', 0, 0, RIDGE_H + 0.05, roof_len_x, 0.5, 0.35, roof_mat)

# Gable end timber verticals on plaster triangles (front-facing x ends)
for side in [-1, 1]:
    x = side * (hx + 0.05)
    box(f'GablePost{side}', x, 0, (WALL_H + RIDGE_H) / 2, 0.26, 0.14, RIDGE_H - WALL_H, timber_mat)

# Door (front, z+)
box('Door', -1.5, hz + 0.08, 1.05, 1.4, 0.12, 2.1, dark_mat)
# Windows front (3)
for wx in (-4.5, 0.5, 4.5):
    box(f'WindowF{wx}', wx, hz + 0.08, 2.9, 1.1, 0.12, 1.1, dark_mat)
# Windows back (2)
for wx in (-3.0, 3.0):
    box(f'WindowB{wx}', wx, -(hz + 0.08), 2.9, 1.1, 0.12, 1.1, dark_mat)

# Chimney
box('Chimney', hx - 2.2, 0.0, RIDGE_H + 0.9, 0.9, 0.9, 2.4, stone_mat)
box('ChimneyCap', hx - 2.2, 0.0, RIDGE_H + 2.15, 1.2, 1.2, 0.25, stone_mat)

# Merge into one mesh for light-weight game asset? Keep separate meshes but same materials.
# Export
for obj in list(bpy.data.objects):
    obj.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format='GLB',
    use_selection=False,
    export_apply=False,
)
print('Saved', BLEND_OUT, 'and', GLB_OUT)
