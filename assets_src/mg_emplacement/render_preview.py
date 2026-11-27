import bpy
import os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(SCRIPT_DIR, 'mg_emplacement.blend')
bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.render.resolution_x = 900
scene.cycles.samples = 48
scene.render.resolution_y = 700
scene.view_settings.exposure = -0.8
scene.render.filepath = os.path.join(SCRIPT_DIR, 'preview.png')
from mathutils import Vector
# camera looks from front-right, elevated
for name, (loc, tgt) in {'Front': ((1.5, -8.5, 3.6), (0, 0, 0.8)),
                          'ThreeQuarter': ((6.5, -6.0, 4.5), (0, 0, 0.6))}.items():
    cam_data = bpy.data.cameras.new('Cam')
    cam = bpy.data.objects.new('Cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    direction = Vector(tgt) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(SCRIPT_DIR, f'preview_{name}.png')
    # ground plane
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    gnd = bpy.context.active_object
    gnd.name = 'Ground'
    gnd_mat = bpy.data.materials.new('Ground')
    gnd_mat.use_nodes = True
    bsdf = gnd_mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.38, 0.44, 0.30, 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    gnd.data.materials.append(gnd_mat)
    for i, (loc2, energy) in enumerate([((4, -8, 12), 110), ((-6, 8, 8), 40)]):
        ld = bpy.data.lights.new('L', 'SUN')
        ld.energy = energy
        lo = bpy.data.objects.new('L', ld)
        bpy.context.collection.objects.link(lo)
        lo.location = loc2
        lo.rotation_euler = (0.9, 0.4, 0.3)
        lo.data.use_shadow = True
    scene.world = bpy.data.worlds.new('W')
    scene.world.color = (0.6, 0.7, 0.8)
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.62, 0.72, 0.82, 1.0)
        bg.inputs['Strength'].default_value = 0.55
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)
    # remove ground/lights/cam for next shot
    for o in list(bpy.data.objects):
        if o.name in ('Ground', 'L', 'Cam'):
            bpy.data.objects.remove(o, do_unlink=True)
    scene.camera = None
