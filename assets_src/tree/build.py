#!/usr/bin/env python3
"""Build the Iron Valley low-poly conifer tree.

Outputs:
  assets_src/tree/tree.blend   (editable source)
  public/models/tree_conifer.glb  (game asset, height = HEIGHT_M meters, origin at ground)

Run:
  ~/.local/bin/blender --background --factory-startup --disable-autoexec \
    --offline-mode --threads 6 --python-exit-code 1 --python build.py
"""
import bpy
import math
import os

HEIGHT_M = 10.0
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
BLEND_OUT = os.path.join(SCRIPT_DIR, 'tree.blend')
GLB_OUT = os.path.join(PROJECT, 'public', 'models', 'tree_conifer.glb')

# Colours (match Iron Valley palette)
TRUNK_COLOR = (0.36, 0.26, 0.18, 1.0)   # brown
LEAF_COLORS = [
    (0.16, 0.30, 0.18, 1.0),             # deep green
    (0.20, 0.37, 0.22, 1.0),
    (0.25, 0.45, 0.27, 1.0),             # lighter top
]

# Wipe the default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    return m

trunk_mat = mat('Trunk', TRUNK_COLOR)
leaf_mats = [mat(f'Leaf{i}', c) for i, c in enumerate(LEAF_COLORS)]

def add_flat(mesh_name, bm, material):
    obj = bpy.data.objects.new(mesh_name, bm)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    # flat shading
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj

# Trunk: tapered 6-sided prism with a slight flare at the base
trunk_h = HEIGHT_M * 0.32
trunk_bm = bpy.data.meshes.new('TrunkMesh')
verts = []
# rings: base flare, 1/3 height, top
rings = [
    (0.00, 0.62, 0.48),   # z, radius_bottom, radius_top... we'll do explicit ring sets
]
# Build manually: base ring (r=0.62), mid ring (r=0.38), top ring (r=0.26)
import random
random.seed(7)
ring_defs = [(0.0, 0.62), (trunk_h * 0.45, 0.40), (trunk_h, 0.26)]
sides = 6
for z, r in ring_defs:
    for i in range(sides):
        a = (i / sides) * math.tau + 0.3
        verts.append((math.cos(a) * r, math.sin(a) * r, z))
faces = []
for r_idx in range(len(ring_defs) - 1):
    for i in range(sides):
        a = r_idx * sides + i
        b = r_idx * sides + (i + 1) % sides
        c = (r_idx + 1) * sides + (i + 1) % sides
        d = (r_idx + 1) * sides + i
        faces.append((a, b, c, d))
# cap bottom
center_idx = len(verts)
verts.append((0.0, 0.0, 0.0))
for i in range(sides):
    faces.append((i, (i + 1) % sides, center_idx))
# cap top
top_center = len(verts)
verts.append((0.0, 0.0, trunk_h))
top_ring_start = (len(ring_defs) - 1) * sides
for i in range(sides):
    faces.append((top_ring_start + i, top_center, top_ring_start + (i + 1) % sides))
trunk_bm.from_pydata(verts, [], faces)
trunk_bm.update()
add_flat('Trunk', trunk_bm, trunk_mat)

# Foliage: 3 stacked cones with jittered base radius — silhouette like a pine
foliage_start = trunk_h * 0.55
foliage_top = HEIGHT_M
layers = 3
layer_h = (foliage_top - foliage_start) / layers
radii = [2.6, 2.0, 1.35]
for i in range(layers):
    z0 = foliage_start + i * layer_h * 0.75
    z1 = foliage_start + (i + 1) * layer_h + 0.4
    r_base = radii[i]
    cone_bm = bpy.data.meshes.new(f'Foliage{i}Mesh')
    csides = 7 + i
    cverts = [(0.0, 0.0, z1)]  # apex
    for j in range(csides):
        a = (j / csides) * math.tau + (0.2 + i * 0.35)
        r = r_base * (0.9 + random.uniform(-0.12, 0.12))
        cverts.append((math.cos(a) * r, math.sin(a) * r, z0))
    cfaces = []
    bottom_center = len(cverts)
    cverts.append((0.0, 0.0, z0))
    for j in range(csides):
        a = 1 + j
        b = 1 + (j + 1) % csides
        cfaces.append((0, a, b))                      # apex skirt
        cfaces.append((a, bottom_center, b))          # bottom cap (visible from below)
    cone_bm.from_pydata(cverts, [], cfaces)
    cone_bm.update()
    add_flat(f'Foliage{i}', cone_bm, leaf_mats[i])

# Ground origin is already y=0 (z in blender, y up in glTF after export)
# Ensure no camera/light objects accidentally exported; we export only Tree collection objects
# Shadow/sun not needed for props. Set scene units
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0

# Save blend
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

# Export GLB (apply transforms)
for obj in bpy.context.scene.objects:
    obj.select_set(True)
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    obj.select_set(True)
    obj.name = obj.name  # keep
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_materials='EXPORT',
    export_normals=True,
    export_tangents=False,
)
print('exported', GLB_OUT)
