// Render level.json objects (trees, farmhouses, ...) into the scene and
// register colliders in world.js's collider arrays.
import * as THREE from 'three';
import { ASSETS } from './scale.js';
import { terrainHeight, treeColliders, farmhouseColliders, objectColliders, rebuildTreeGrid } from './world.js';
import { loadTreeModel } from './tree.js';
import { loadFarmhouseModel } from './farmhouse.js';

export const occluderMeshes = []; // solid world occluders (farmhouses), for camera/barrel raycasts

const loaders = {
  tree: loadTreeModel,
  farmhouse: loadFarmhouseModel,
};

function rootedBase(x, z, baseRadius) {
  let h = terrainHeight(x, z);
  for (const dx of [-baseRadius, baseRadius]) for (const dz of [-baseRadius, baseRadius]) {
    h = Math.max(h, terrainHeight(x + dx, z + dz));
  }
  return h;
}

export async function loadObjectSources(level) {
  const sources = {};
  const needed = new Set(level.objects.map(o => o.type));
  for (const type of needed) {
    const loader = loaders[type];
    if (!loader) { console.warn('[objects] no loader for type', type); continue; }
    try { sources[type] = await loader(); }
    catch (err) { console.error('[objects] failed to load', type, err); }
  }
  return sources;
}

export function placeObjects(scene, level, sources) {
  treeColliders.length = 0;
  farmhouseColliders.length = 0;
  objectColliders.length = 0;
  const placed = [];
  for (const o of level.objects) {
    const source = sources[o.type];
    const meta = ASSETS[o.type];
    if (!source || !meta) { console.warn('[objects] skipping unknown object', o.id, o.type); continue; }
    const inst = source.clone(true);
    const editorMeta = meta.editor || {};
    const r = editorMeta.footprintR ?? 1;
    const scale = o.scale ?? 1;
    inst.scale.multiplyScalar(scale);
    inst.rotation.y = o.rotation || 0;
    const baseRadius = Math.max(1, r * scale);
    const base = rootedBase(o.x, o.z, baseRadius);
    inst.position.set(o.x, base - (o.type === 'tree' ? 0.35 : 0.15), o.z);
    inst.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    scene.add(inst);
    if (o.type === 'farmhouse') occluderMeshes.push(inst);
    placed.push(o);
    if (editorMeta.collidable !== false) {
      if (o.type === 'tree') {
        // trunk-only circle; canopy is passable
        treeColliders.push({ x: o.x, z: o.z, r: 0.65 * scale, base: base });
      } else if (o.type === 'farmhouse') {
        // oriented box (local X = model length axis), slightly trimmed to its edges
        farmhouseColliders.push({ x: o.x, z: o.z, rot: o.rotation || 0, halfW: 6.7 * scale, halfD: 3.7 * scale });
      } else {
        objectColliders.push({ x: o.x, z: o.z, r: r * scale });
      }
    }
  }
  rebuildTreeGrid();
  console.log(`placed ${placed.length} objects from level`);
  return placed.length;
}
