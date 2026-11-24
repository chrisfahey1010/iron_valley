"""Build the M24 Chaffee player tank for Iron Valley and export a game-ready GLB.

Blender is Z-up. The game expects the GLB as +Y up with forward = -X, width = Z
(under export_yup=True, Blender (X, Y, Z) maps to glTF (X, Z, -Y)). So:
  - X = hull length (nose at -X)
  - Y = hull width (left = +Y)
  - Z = up (height)

Rig contract (docs/TANK_RIG_REFERENCE.md):
  - nodes: Tank_Turret (at turret pivot), Tank_Gun (at gun pivot), Tank_body
  - armature root "Root", tread bones TankTrack{1,2}.{L,R}
  - clips (1 s, looped): Tank_Forward / Tank_Backwards / Tank_TurningLeft /
    Tank_TurningRight

Run:  blender -b -P build_m24_chaffee.py
"""
import bpy
import math
from mathutils import Vector, Matrix
import os

OUT = "/home/chris/dev/localprojs/iron_valley/public/models/tank_6_m24_chaffee.glb"

# ---------- clean scene ----------
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# ---------- materials ----------
def mat(name, color, rough=0.75, metal=0.15):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

M_HULL = mat("M24_Hull", (0.34, 0.37, 0.27), 0.80, 0.18)      # olive drab
M_TUR = mat("M24_Turret", (0.36, 0.39, 0.29), 0.74, 0.22)
M_DARK = mat("M24_Tracks", (0.12, 0.12, 0.11), 0.92, 0.10)
M_WHEEL = mat("M24_Wheels", (0.25, 0.25, 0.22), 0.85, 0.12)
M_METAL = mat("M24_Metal", (0.40, 0.40, 0.38), 0.55, 0.55)

# ---------- helpers ----------
def box(name, loc, size, rot=None, material=None, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    if rot is not None:
        o.rotation_euler = rot
    if material:
        o.data.materials.append(material)
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.scale = (1, 1, 1)
    if parent:
        o.parent = parent
    return o

def cyl(name, loc, radius, depth, axis="z", material=None, parent=None, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    if axis == "y":
        o.rotation_euler = (math.radians(90), 0, 0)
    elif axis == "x":
        o.rotation_euler = (0, math.radians(90), 0)
    if material:
        o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    if parent:
        o.parent = parent
    bpy.context.scene.collection.objects.link(o)
    return o

# ---------- hull  (~5 m long, 2.5 m wide)  ----------
body = empty("Tank_body", (0, 0, 0))

tracks = {}
for side, sign in (("L", 1), ("R", -1)):
    y = sign * 1.00
    for seg, x0 in ((1, -1.28), (2, 1.28)):
        mesh = box(f"TankTrack{seg}.{side}", (x0, y, 0.34), (2.15, 0.45, 0.62), material=M_DARK, parent=body)
        tracks[f"TankTrack{seg}.{side}"] = mesh

# road wheels: 5 per side
for side, sign in (("L", 1), ("R", -1)):
    y = sign * 0.92
    for i, x in enumerate([-1.72, -0.86, 0.0, 0.86, 1.72]):
        cyl(f"Wheel_{side}_{i}", (x, y, 0.34), 0.32, 0.26, axis="y", material=M_WHEEL, parent=body)
    cyl(f"Wheel_{side}_drive", (1.98, y, 0.36), 0.30, 0.26, axis="y", material=M_WHEEL, parent=body)

# hull lower + sloped glacis nose + rear plate (Chaffee has a compact,
# slightly rounded profile)
box("Hull_lower", (0, 0, 0.88), (4.85, 1.75, 0.55), material=M_HULL, parent=body)
box("Hull_glacis", (-2.30, 0, 1.05), (0.85, 1.75, 0.50), rot=(0, math.radians(-40), 0), material=M_HULL, parent=body)
box("Hull_rear", (2.42, 0, 0.96), (0.12, 1.68, 0.50), material=M_HULL, parent=body)
box("Hull_skirt_L", (0, 0.92, 0.94), (4.6, 0.07, 0.42), material=M_HULL, parent=body)
box("Hull_skirt_R", (0, -0.92, 0.94), (4.6, 0.07, 0.42), material=M_HULL, parent=body)
# rounded-ish nose/tail caps
cyl("Nose_cap", (-2.72, 0, 0.90), 0.16, 1.60, axis="y", material=M_HULL, parent=body, vertices=12)
cyl("Headlamp_L", (-2.62, 0.50, 1.02), 0.09, 0.09, axis="x", material=M_METAL, parent=body)
cyl("Headlamp_R", (-2.62, -0.50, 1.02), 0.09, 0.09, axis="x", material=M_METAL, parent=body)

# ---------- turret (pivot at bottom center)  ----------
t = empty("Tank_Turret", (-0.30, 0, 1.18))
cyl("Turret_ring", (0, 0, 0.06), 0.78, 0.12, axis="z", material=M_TUR, parent=t, vertices=20)
cyl("Turret_body", (0, 0, 0.40), 0.62, 0.55, axis="z", material=M_TUR, parent=t, vertices=16)
box("Turret_front_mantlet_housing", (-0.55, 0, 0.42), (0.25, 0.72, 0.34), rot=(0, math.radians(-18), 0), material=M_TUR, parent=t)
cyl("Turret_hatch", (0.20, 0.28, 0.72), 0.22, 0.08, axis="z", material=M_TUR, parent=t, vertices=12)
cyl("Turret_cupola", (0.35, -0.28, 0.70), 0.24, 0.20, axis="z", material=M_TUR, parent=t, vertices=12)

# ---------- gun (pivot at gun root)  ----------
gun = empty("Tank_Gun", (-0.68, 0, 0.45), parent=t)
box("Gun_mantlet", (0.0, 0.0, 0.0), (0.32, 0.38, 0.38), material=M_TUR, parent=gun)
cyl("Gun_barrel", (-0.95, 0.0, 0.0), 0.085, 1.90, axis="x", material=M_METAL, parent=gun, vertices=12)
cyl("Gun_muzzle", (-1.92, 0.0, 0.0), 0.11, 0.22, axis="x", material=M_METAL, parent=gun, vertices=12)

# ---------- armature + tread bones  ----------
bone_armature = bpy.data.objects.new("TankArmature", bpy.data.armatures.new("TankArmature"))
bpy.context.scene.collection.objects.link(bone_armature)
bpy.context.view_layer.objects.active = bone_armature
bone_armature.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

root_eb = bone_armature.data.edit_bones.new("Root")
root_eb.head = (0, 0, 0)
root_eb.tail = (0, 0, 0.01)

for name, sign, x0 in (("TankTrack1.L", 1, -1.28), ("TankTrack2.L", 1, 1.28),
                       ("TankTrack1.R", -1, -1.28), ("TankTrack2.R", -1, 1.28)):
    y = sign * 1.00
    b = bone_armature.data.edit_bones.new(name)
    b.head = (x0, y, 0.34)
    b.tail = (x0, y, 0.35)
    b.parent = root_eb

bpy.ops.object.mode_set(mode="OBJECT")

for name, mesh in tracks.items():
    world_pose = mesh.matrix_world.copy()
    mesh.parent = bone_armature
    mesh.parent_type = "BONE"
    mesh.parent_bone = name
    bpy.context.view_layer.update()
    bone = bone_armature.data.bones[name]
    mesh.matrix_parent_inverse = bone.matrix_local.inverted() @ world_pose
    mesh.matrix_local = Matrix.Identity(4)

bpy.context.view_layer.update()

intended = {
    "TankTrack1.L": (-1.28, 1.00, 0.34), "TankTrack2.L": (1.28, 1.00, 0.34),
    "TankTrack1.R": (-1.28, -1.00, 0.34), "TankTrack2.R": (1.28, -1.00, 0.34),
}
for name, mesh in tracks.items():
    exp = intended[name]
    act = mesh.matrix_world.translation
    print(f"{name}: expected {exp}, actual {tuple(round(v, 4) for v in act)}")
    assert (Vector(exp) - act).length < 0.02, f"{name} misplaced"
print("ALL TRACK MESHES CORRECT")

# ---------- animations  ----------
fps = 24
FRAME_LEN = 1.0

def build_clip(name, per_side):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    bone_armature.animation_data_create()
    bone_armature.animation_data.action = act
    bone_armature.select_set(True)
    bpy.context.view_layer.objects.active = bone_armature
    for side, (a1, a2) in per_side.items():
        for seg, x_end in ((1, a1), (2, a2)):
            bone = bone_armature.pose.bones[f"TankTrack{seg}.{side}"]
            bone.location.x = 0.0
            bone.keyframe_insert("location", index=0, frame=1)
            bone.location.x = x_end
            bone.keyframe_insert("location", index=0, frame=fps * FRAME_LEN + 1)
    bone_armature.animation_data.action = None
    return act

clips = {}
clips["Tank_Forward"] = build_clip("Tank_Forward", {"L": (-0.32, -0.32), "R": (-0.32, -0.32)})
clips["Tank_Backwards"] = build_clip("Tank_Backwards", {"L": (0.32, 0.32), "R": (0.32, 0.32)})
clips["Tank_TurningLeft"] = build_clip("Tank_TurningLeft", {"L": (-0.10, -0.10), "R": (-0.32, -0.32)})
clips["Tank_TurningRight"] = build_clip("Tank_TurningRight", {"L": (-0.32, -0.32), "R": (-0.10, -0.10)})

bone_armature.animation_data.action = None
for clip_name, act in clips.items():
    track = bone_armature.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 1, act)
    strip.repeat = -1
    strip.frame_start = 1
    strip.frame_end = fps * FRAME_LEN + 1

# ---------- export  ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)
print("exported", OUT)
