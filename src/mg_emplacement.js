// Machinegun emplacement model loading. Instances are created by src/objects.js
// from level.json. Static for now — the turret is baked at center-forward; the
// "Mg_Turret" node is the future pivot for ±45° traverse.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';

const loader = new GLTFLoader();

export async function loadMgEmplacementModel() {
  const asset = ASSETS.mg_emplacement;
  const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  source.updateWorldMatrix(true, true);
  const bb = measureRootBbox(source);
  const size = bb.getSize(new THREE.Vector3());
  const s = asset.lengthM / Math.max(size.x, size.z);
  source.scale.setScalar(s);
  source.updateMatrixWorld(true);
  return source;
}
