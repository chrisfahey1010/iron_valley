import bpy
import os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(SCRIPT_DIR, 'farmhouse.blend')
bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 900; scene.render.resolution_y = 700
scene.render.film_transparent = False
scene.render.filepath = os.path.join(SCRIPT_DIR, 'preview.png')
# camera
cam_data = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
from mathutils import Vector
cam.location = (2, 26, 14)
direction = Vector((0, 0, 3.5)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
# ground plane
import bpy as _bpy
_bpy.ops.mesh.primitive_plane_add(size=80, location=(0,0,0))
gnd = _bpy.context.active_object
gnd.name = 'Ground'
gnd_mat = _bpy.data.materials.new('Ground')
gnd_mat.use_nodes = True
bsdf = gnd_mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.36, 0.42, 0.30, 1.0)
bsdf.inputs['Roughness'].default_value = 1.0
gnd.data.materials.append(gnd_mat)

# simple lights
for i, (loc, energy) in enumerate([((8, -10, 14), 350), ((-10, 10, 9), 120)]):
    ld = bpy.data.lights.new('L', 'SUN')
    ld.energy = energy
    lo = bpy.data.objects.new('L', ld)
    bpy.context.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (0.9, 0.4, 0.3)
    lo.data.use_shadow = True
scene.world = bpy.data.worlds.new('W')
scene.world.color = (0.6, 0.7, 0.8)
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.62, 0.72, 0.82, 1.0)
    bg.inputs['Strength'].default_value = 0.5
bpy.context.view_layer.update()
bpy.ops.render.render(write_still=True)
print('rendered', scene.render.filepath)
