// Tree model loading. Instances are created by src/objects.js from level.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';

const loader = new GLTFLoader();

export async function loadTreeModel() {
  const asset = ASSETS.tree;
  const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  const s = asset.heightM / measureRootBbox(source).getSize(new THREE.Vector3()).y;
  source.scale.setScalar(s);
  source.updateMatrixWorld(true);
  return source;
}
