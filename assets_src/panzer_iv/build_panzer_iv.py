"""Build the Panzer IV enemy tank for Iron Valley and export a game-ready GLB.

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

Run:  blender -b -P build_panzer_iv.py
"""
import bpy
import math
from mathutils import Vector, Matrix
import os

OUT = "/home/chris/dev/localprojs/iron_valley/public/models/tank_5_panzer_iv.glb"

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

M_HULL = mat("PV_Hull", (0.30, 0.33, 0.26), 0.78, 0.20)
M_TUR = mat("PV_Turret", (0.33, 0.36, 0.28), 0.72, 0.22)
M_DARK = mat("PV_Tracks", (0.14, 0.14, 0.13), 0.92, 0.10)
M_WHEEL = mat("PV_Wheels", (0.24, 0.24, 0.21), 0.85, 0.12)
M_METAL = mat("PV_Metal", (0.42, 0.42, 0.40), 0.55, 0.55)

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
    # bake the object's scale into the mesh so the object stays identity
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
    if axis == "y":      # width axis (left-right)
        o.rotation_euler = (math.radians(90), 0, 0)
    elif axis == "x":    # length axis (barrel)
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

# ---------- hull ----------
body = empty("Tank_body", (0, 0, 0))

tracks = {}
for side, sign in (("L", 1), ("R", -1)):
    y = sign * 1.18
    for seg, x0 in ((1, -1.55), (2, 1.55)):
        mesh = box(f"TankTrack{seg}.{side}", (x0, y, 0.37), (2.55, 0.55, 0.74), material=M_DARK, parent=body)
        tracks[f"TankTrack{seg}.{side}"] = mesh

for side, sign in (("L", 1), ("R", -1)):
    y = sign * 1.10
    for i, x in enumerate([-2.35, -1.18, 0.0, 1.18, 2.35]):
        cyl(f"Wheel_{side}_{i}", (x, y, 0.40), 0.36, 0.30, axis="y", material=M_WHEEL, parent=body)
    cyl(f"Wheel_{side}_drive", (2.55, y, 0.42), 0.34, 0.30, axis="y", material=M_WHEEL, parent=body)

box("Hull_lower", (0, 0, 0.95), (5.55, 2.05, 0.62), material=M_HULL, parent=body)
box("Hull_glacis", (-2.62, 0, 1.12), (0.95, 2.05, 0.55), rot=(0, math.radians(-38), 0), material=M_HULL, parent=body)
box("Hull_skirt_L", (0, 1.06, 1.02), (5.3, 0.08, 0.52), material=M_HULL, parent=body)
box("Hull_skirt_R", (0, -1.06, 1.02), (5.3, 0.08, 0.52), material=M_HULL, parent=body)
box("Hull_rear", (2.82, 0, 1.02), (0.12, 1.95, 0.55), material=M_HULL, parent=body)
cyl("Headlamp_L", (-2.82, 0.62, 1.08), 0.11, 0.10, axis="x", material=M_METAL, parent=body)
cyl("Headlamp_R", (-2.82, -0.62, 1.08), 0.11, 0.10, axis="x", material=M_METAL, parent=body)

# ---------- turret (pivot at bottom center) ----------
t = empty("Tank_Turret", (-0.35, 0, 1.28))
box("Turret_base", (0, 0, 0.10), (1.75, 1.75, 0.22), material=M_TUR, parent=t)
box("Turret_body", (0, 0, 0.55), (1.55, 1.55, 0.60), material=M_TUR, parent=t)
box("Turret_front", (-0.72, 0, 0.62), (0.35, 1.45, 0.48), rot=(0, math.radians(-24), 0), material=M_TUR, parent=t)
box("Turret_rear", (0.78, 0, 0.55), (0.28, 1.50, 0.50), material=M_TUR, parent=t)
cyl("Turret_hatch_top", (0.15, 0.35, 0.90), 0.28, 0.09, axis="z", material=M_TUR, parent=t, vertices=12)
cyl("Turret_cupola", (0.45, -0.42, 0.88), 0.30, 0.22, axis="z", material=M_TUR, parent=t, vertices=12)

# ---------- gun (pivot at gun root) ----------
gun = empty("Tank_Gun", (-0.98, 0, 0.62), parent=t)
box("Gun_mantlet", (0.0, 0.0, 0.0), (0.34, 0.40, 0.42), material=M_TUR, parent=gun)
cyl("Gun_barrel", (-1.0, 0.0, 0.02), 0.085, 2.05, axis="x", material=M_METAL, parent=gun, vertices=12)
cyl("Gun_muzzle", (-2.02, 0.0, 0.02), 0.13, 0.30, axis="x", material=M_METAL, parent=gun, vertices=12)

# ---------- armature + tread bones ----------
bone_armature = bpy.data.objects.new("TankArmature", bpy.data.armatures.new("TankArmature"))
bpy.context.scene.collection.objects.link(bone_armature)
bpy.context.view_layer.objects.active = bone_armature
bone_armature.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

root_eb = bone_armature.data.edit_bones.new("Root")
root_eb.head = (0, 0, 0)
root_eb.tail = (0, 0, 0.01)

# tread bones: direction along world Z (vertical) so bone local X = world X
# (Hull length axis) -> animating bone location[0] slides the tread along the hull.
for name, sign, x0 in (("TankTrack1.L", 1, -1.55), ("TankTrack2.L", 1, 1.55),
                       ("TankTrack1.R", -1, -1.55), ("TankTrack2.R", -1, 1.55)):
    y = sign * 1.18
    b = bone_armature.data.edit_bones.new(name)
    b.head = (x0, y, 0.37)
    b.tail = (x0, y, 0.38)
    b.parent = root_eb

bpy.ops.object.mode_set(mode="OBJECT")

# parent track meshes to bones; compute inverse explicitly (Blender does NOT)
for name, mesh in tracks.items():
    world_pose = mesh.matrix_world.copy()  # BEFORE parenting
    mesh.parent = bone_armature
    mesh.parent_type = "BONE"
    mesh.parent_bone = name
    bpy.context.view_layer.update()
    bone = bone_armature.data.bones[name]
    mesh.matrix_parent_inverse = bone.matrix_local.inverted() @ world_pose
    mesh.matrix_local = Matrix.Identity(4)

bpy.context.view_layer.update()

# sanity check: each track mesh world translation must equal its intended world position
intended = {
    "TankTrack1.L": (-1.55, 1.18, 0.37), "TankTrack2.L": (1.55, 1.18, 0.37),
    "TankTrack1.R": (-1.55, -1.18, 0.37), "TankTrack2.R": (1.55, -1.18, 0.37),
}
for name, mesh in tracks.items():
    exp = intended[name]
    act = mesh.matrix_world.translation
    print(f"{name}: expected {exp}, actual {tuple(round(v, 4) for v in act)}")
    assert (Vector(exp) - act).length < 0.02, f"{name} misplaced"
print("ALL TRACK MESHES CORRECT")

# ---------- animations ----------
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
clips["Tank_Forward"] = build_clip("Tank_Forward", {"L": (-0.45, -0.45), "R": (-0.45, -0.45)})
clips["Tank_Backwards"] = build_clip("Tank_Backwards", {"L": (0.45, 0.45), "R": (0.45, 0.45)})
clips["Tank_TurningLeft"] = build_clip("Tank_TurningLeft", {"L": (-0.12, -0.12), "R": (-0.45, -0.45)})
clips["Tank_TurningRight"] = build_clip("Tank_TurningRight", {"L": (-0.45, -0.45), "R": (-0.12, -0.12)})

# NLA strips (one per clip)
bone_armature.animation_data.action = None
for clip_name, act in clips.items():
    track = bone_armature.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 1, act)
    strip.repeat = -1
    strip.frame_start = 1
    strip.frame_end = fps * FRAME_LEN + 1

# ---------- export ----------
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
