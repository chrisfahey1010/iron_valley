#!/usr/bin/env python3
"""Build the Iron Valley WWII machinegun emplacement.

Outputs:
  assets_src/mg_emplacement/mg_emplacement.blend   (editable source)
  public/models/mg_emplacement.glb                (game asset, ~4.5 m footprint)

Authoring convention (Blender is Z-up, export_yup=True):
  - Blender X = game X (left/right), Blender Y = -game forward... see below
  - Blender Z = up
  - With export_yup=True, Blender (X, Y, Z) maps to glTF (X, Z, -Y), so
    glTF forward +Z corresponds to Blender -Y. Author with the gun
    pointing toward Blender -Y.
  - Origin at ground level (center of the turret pivot).

Rig (for future animation): turret group named "Mg_Turret" (pivot at the
turret rotation axis, bottom center, z = pedestal top). The machinegun is
parented under an "Mg_GunPivot" empty (pivot at the bore axis, near the
stock hinge) so the gun can pitch -20..10 deg. Sandbags stay static.
All objects flat-shaded, low segment count.

Run:
  ~/.local/bin/blender --background --factory-startup --disable-autoexec \
    --offline-mode --threads 6 --python-exit-code 1 --python build.py
"""
import bpy
import math
import os
import random

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
BLEND_OUT = os.path.join(SCRIPT_DIR, 'mg_emplacement.blend')
GLB_OUT = os.path.join(PROJECT, 'public', 'models', 'mg_emplacement.glb')

SEED = 42
rng = random.Random(SEED)

ARC_R = 2.1          # sandbag arc radius (m)
SAND_H = 0.72        # sandbag stack height (m)
TURRET_Z = 0.42      # pedestal top / turret pivot height (m)
TURRET_TOP = 1.18    # top of turret body
GUN_HEIGHT = 1.05    # bore height (above sandbags)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- materials ----------
def mat(name, color, rough=0.85, metal=0.05):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    try:
        m.use_backface_culling = False
    except Exception:
        pass
    return m

M_SAND = mat('MG_Sandbag', (0.55, 0.48, 0.34), 0.95, 0.0)
M_SAND_DARK = mat('MG_SandbagDark', (0.46, 0.40, 0.28), 0.97, 0.0)
M_METAL = mat('MG_Metal', (0.24, 0.25, 0.24), 0.62, 0.45)
M_METAL_LIGHT = mat('MG_MetalLight', (0.34, 0.35, 0.33), 0.55, 0.5)
M_WOOD = mat('MG_Wood', (0.36, 0.26, 0.16), 0.85, 0.0)
M_GUN = mat('MG_Gun', (0.15, 0.16, 0.15), 0.5, 0.6)
M_SHIELD = mat('MG_Shield', (0.30, 0.32, 0.26), 0.8, 0.15)

# ---------- helpers ----------
def flat_shade(o):
    for p in o.data.polygons:
        p.use_smooth = False

def box(name, loc, size, material, rot=None, parent=None, bevel=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(material)
    if bevel:
        bpy.ops.object.modifier_add(type='BEVEL')
        o.modifiers.get('Bevel').width = bevel
        o.modifiers.get('Bevel').segments = 2
        bpy.ops.object.modifier_apply(modifier='Bevel')
    flat_shade(o)
    if parent:
        o.parent = parent
    return o

def cyl(name, loc, radius, height, material, segments=10, parent=None, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=segments, radius=radius, depth=height, location=loc)
    o = bpy.context.active_object
    o.name = name
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(material)
    flat_shade(o)
    if parent:
        o.parent = parent
    return o

# ---------- sandbag arc (front half, facing Blender -Y) ----------
def sandbag_arc():
    rows = [
        (0.16, 13, 0.28, 0.42),   # z, count, bag height, bag depth
        (0.44, 11, 0.26, 0.38),
        (0.68, 9, 0.22, 0.34),
    ]
    for row_i, (z, count, bh, bd) in enumerate(rows):
        # stagger alternate rows
        offset = (180.0 / count) * 0.5 * (row_i % 2)
        for i in range(count):
            # symmetric arc from -90 to +90 degrees about forward (-Y)
            theta = math.radians(-90 + (180.0 * (i + 0.5) / count) + offset * 0)
            # jitter position slightly for organic look
            r = ARC_R + rng.uniform(-0.05, 0.05)
            x = r * math.sin(theta)
            y = -r * math.cos(theta)
            size_x = (2 * math.pi * r / count) * 0.95   # tangential arc length
            bag = box(f'Sandbag_{row_i}_{i}',
                      (x, y, z),
                      (size_x, bd, bh),
                      M_SAND_DARK if row_i % 2 else M_SAND,
                      rot=(0, 0, theta + rng.uniform(-0.06, 0.06)), bevel=0.07)
    # end caps: slightly larger ground stones
    for theta_deg in (-95, 95):
        theta = math.radians(theta_deg)
        x = ARC_R * math.sin(theta)
        y = -ARC_R * math.cos(theta)
        cyl(f'EndRock_{theta_deg}', (x, y, 0.14), 0.28, 0.28, M_METAL_LIGHT, 7)

sandbag_arc()

# ---------- pedestal ----------
pedestal = cyl('MG_Pedestal', (0, 0, TURRET_Z / 2), 0.55, TURRET_Z, M_METAL_LIGHT, 12)
cyl('MG_PedestalTop', (0, 0, TURRET_Z + 0.06), 0.42, 0.12, M_METAL, 12)

# ---------- turret (pivot group at origin, turret_z) ----------
turret = bpy.data.objects.new('Mg_Turret', None)
bpy.context.collection.objects.link(turret)
turret.location = (0, 0, TURRET_Z)
turret.empty_display_type = 'PLAIN_AXES'
turret.empty_display_size = 0.3

# turret body (low squat cylinder + shoulders)
body = cyl('MG_TurretBody', (0, 0, 0.28), 0.62, 0.5, M_SHIELD, 14,
           parent=turret)
# shoulders left/right
box('MG_TurretShoulderL', (-0.38, 0.05, 0.34), (0.22, 0.5, 0.42), M_SHIELD, parent=turret)
box('MG_TurretShoulderR', (0.38, 0.05, 0.34), (0.22, 0.5, 0.42), M_SHIELD, parent=turret)
# rear engine block
box('MG_TurretRear', (0, 0.42, 0.26), (0.6, 0.42, 0.4), M_METAL, parent=turret)

# gun shield: curved low-poly plate in front (Blender -Y)
shield = box('MG_GunShield', (0, -0.50, 0.46), (0.95, 0.10, 0.52), M_SHIELD,
             rot=(math.radians(-8), 0, 0), parent=turret, bevel=0.04)

# gun pivot: empty at the bore axis, near the stock hinge (parent = turret)
gunPivot = bpy.data.objects.new('Mg_GunPivot', None)
bpy.context.collection.objects.link(gunPivot)
gunPivot.location = (0, 0.12, GUN_HEIGHT - TURRET_Z)
gunPivot.empty_display_type = 'PLAIN_AXES'
gunPivot.empty_display_size = 0.2
gunPivot.parent = turret

# machinegun: receiver + barrel along forward (-Y). Positions below are
# turret-local, matching the pre-pivot asset; re-attached to gunPivot so its
# world transform stays exactly where it was.
def attach_to_pivot(obj):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    local = obj.matrix_local.copy()
    obj.parent = gunPivot
    bpy.context.view_layer.update()
    obj.matrix_parent_inverse = gunPivot.matrix_world.inverted() @ world @ local.inverted()
    bpy.context.view_layer.update()
    d = obj.matrix_world.to_translation() - world.to_translation()
    assert d.length < 0.001, f're-parent moved {obj.name}: {d}'

box('MG_Receiver', (0, -0.34, GUN_HEIGHT - TURRET_Z), (0.26, 0.72, 0.28), M_GUN, parent=turret, bevel=0.05)
cyl('MG_Barrel', (0, -1.15, GUN_HEIGHT - TURRET_Z), 0.055, 1.5, M_GUN, 8,
    rot=(math.radians(90), 0, 0), parent=turret)
box('MG_MuzzleBrake', (0, -1.85, GUN_HEIGHT - TURRET_Z), (0.11, 0.22, 0.11), M_METAL, parent=turret)
cyl('MG_Scope', (0, -0.30, GUN_HEIGHT - TURRET_Z + 0.24), 0.07, 0.30, M_METAL, 8,
    rot=(math.radians(90), 0, 0), parent=turret)
box('MG_Stock', (0, 0.34, GUN_HEIGHT - TURRET_Z - 0.02), (0.16, 0.42, 0.2), M_WOOD, parent=turret)

# sandbag-softened cheek plates beside the gun
box('MG_CheekL', (-0.33, -0.40, GUN_HEIGHT - TURRET_Z - 0.08), (0.07, 0.40, 0.18), M_SHIELD, parent=turret)
box('MG_CheekR', (0.33, -0.40, GUN_HEIGHT - TURRET_Z - 0.08), (0.07, 0.40, 0.18), M_SHIELD, parent=turret)

for name in ('MG_Receiver', 'MG_Barrel', 'MG_MuzzleBrake', 'MG_Scope', 'MG_Stock', 'MG_CheekL', 'MG_CheekR'):
    attach_to_pivot(bpy.data.objects[name])

# ---------- collect / export ----------
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
