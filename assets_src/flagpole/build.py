#!/usr/bin/env python3
"""Build the Iron Valley flagpole.

Outputs:
  assets_src/flagpole/flagpole.blend   (editable source)
  public/models/flagpole.glb          (game asset, 10 m pole, no flag — the flag is
                                        a runtime animation in src/flagpole.js)

Authoring convention (Blender is Z-up, export_yup=True):
  - Blender X = game X (left/right), Blender Y = -game forward, Blender Z = up
  - Origin at ground level (center of the base).

Run:
  ~/.local/bin/blender --background --factory-startup --disable-autoexec \
    --offline-mode --threads 6 --python-exit-code 1 --python build.py
"""
import bpy
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
BLEND_OUT = os.path.join(SCRIPT_DIR, 'flagpole.blend')
GLB_OUT = os.path.join(PROJECT, 'public', 'models', 'flagpole.glb')

POLE_H = 10.0
POLE_R = 0.09

bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.6, metal=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m

M_METAL = mat('Flagpole_Metal', (0.62, 0.63, 0.66), 0.35, 0.85)
M_DARK = mat('Flagpole_DarkMetal', (0.22, 0.22, 0.24), 0.6, 0.7)
M_BASE = mat('Flagpole_Base', (0.28, 0.28, 0.30), 0.9, 0.15)
M_GOLD = mat('Flagpole_Finial', (0.95, 0.78, 0.35), 0.35, 0.9)

def flat_shade(o):
    for p in o.data.polygons:
        p.use_smooth = False

def cyl(name, loc, radius, depth, material, segments=16, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    flat_shade(o)
    if parent:
        o.parent = parent
    return o

def box(name, loc, size, material, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    flat_shade(o)
    if parent:
        o.parent = parent
    return o

# Base: weighted concrete plinth + dark metal foot ring
cyl('Base_Plinth', (0, 0, 0.15), 0.55, 0.30, M_BASE, 20)
cyl('Base_Foot', (0, 0, 0.38), 0.30, 0.18, M_DARK, 16)

# Pole tapered: use a 16-sided low-poly cylinder; add a slight top taper via a scaled second cylinder
cyl('Pole', (0, 0, 0.47 + POLE_H / 2), POLE_R, POLE_H, M_METAL, 14)

# Finial
finial = bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=(0, 0, 10.62))
f = bpy.context.active_object
f.name = 'Finial'
f.scale = (0.13, 0.13, 0.20)
f.data.materials.append(M_GOLD)
flat_shade(f)
# small spire between pole tip and finial ball
cyl('Finial_Spire', (0, 0, 10.10), 0.045, 0.18, M_GOLD, 8)

# Collect / export
for obj in list(bpy.data.objects):
    obj.select_set(True)

bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format='GLB',
    use_selection=False,
    export_apply=False,
    export_yup=True,
)
print('Saved', BLEND_OUT)
print('Saved', GLB_OUT)
