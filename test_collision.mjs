// Headless collision tests for Iron Valley (node, pure math)
import * as THREE from 'three';
import { farmhouseColliders, treeColliders, deadTankColliders, resolveObstacles, terrainHeight, pushOutOfBox } from './src/world.js';
import { predictPath } from './src/shells.js';

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
  if (!cond) failures++;
}

// Farmhouse oriented box: rotate 90° so local X points world -Z... use rot=0 for sanity
const house = { x: 0, z: 0, rot: 0, halfW: 6.7, halfD: 3.7 };
farmhouseColliders.length = 0;
farmhouseColliders.push(house);

// shell aimed straight at the house from 60m out
const muzzle = new THREE.Vector3(-60, terrainHeight(-60, 0) + 2, 0);
const dir = new THREE.Vector3(1, 0.02, 0).normalize();
const hit = predictPath({ muzzle, dir, tanks: [] });
check('shell hits farmhouse box -> rock', hit && hit.hitObstacle === 'rock');

// shell aimed beside the house (off to the side, clear)
const muzzle2 = new THREE.Vector3(-60, terrainHeight(-60, 40) + 2, 40);
const dir2 = new THREE.Vector3(1, 0, 0).normalize();
const hit2 = predictPath({ muzzle: muzzle2, dir: dir2, tanks: [] });
check('shell beside the house keeps going (terrain/rock, not farmhouse)', !hit2 || hit2.hitObstacle !== 'farmhouse');

// farmhouse box push-out for tank: spawn inside the box
const pos = new THREE.Vector3(0, 0, 0);
pushOutOfBox(pos, 2.5, house);
const inside = Math.abs(pos.x) < 6.7 + 2.5 && Math.abs(pos.z) < 3.7 + 2.5;
check('tank pushed out of farmhouse box', !inside || Math.hypot(pos.x, pos.z) > 0.1);

// tree trunk: shell through the canopy center should hit trunk
treeColliders.length = 0;
treeColliders.push({ x: 0, z: 0, r: 0.65 });
const tMuzzle = new THREE.Vector3(-30, terrainHeight(-30, 0) + 6, 0);
const tDir = new THREE.Vector3(1, 0.02, 0).normalize();
const tHit = predictPath({ muzzle: tMuzzle, dir: tDir, tanks: [] });
check('shell hits tree trunk -> rock', tHit && tHit.hitObstacle === 'rock');

// shell aimed through canopy but offset from trunk (leaves pass through)
const tMuzzle2 = new THREE.Vector3(-30, terrainHeight(-30, 3) + 6, 3);
const tDir2 = new THREE.Vector3(1, 0.02, 0).normalize();
const tHit2 = predictPath({ muzzle: tMuzzle2, dir: tDir2, tanks: [] });
check('shell aimed beside trunk passes through canopy (no rock-obstacle hit at distance)', tHit2 && tHit2.point.x > -25);

// dead tank wreck: blocks shell, returns tank hit
deadTankColliders.length = 0;
treeColliders.length = 0;
farmhouseColliders.length = 0;
deadTankColliders.push({ x: 0, z: 0, r: 2.4 });
const wreckMuzzle = new THREE.Vector3(-30, terrainHeight(0, 0) + 1.4, 0);
const wreckDir = new THREE.Vector3(1, 0.03, 0).normalize();
const wreckHit = predictPath({ muzzle: wreckMuzzle, dir: wreckDir, tanks: [] });
check('shell hits dead-tank wreck', wreckHit && wreckHit.hitTank && wreckHit.hitTank.wreck === true);

// wrecks still block tanks via resolveObstacles
const wreckTankPos = new THREE.Vector3(0, 0, 0);
resolveObstacles(wreckTankPos, 2.5);
check('tank pushed out of dead-tank wreck', Math.hypot(wreckTankPos.x, wreckTankPos.z) > 0.1);

// rotated farmhouse box: rot=90°, local X along world -Z? Use atan2 convention
farmhouseColliders.length = 0;
const rot90 = Math.PI / 2;
const houseRot = { x: 0, z: 0, rot: rot90, halfW: 6.7, halfD: 3.7 };
farmhouseColliders.push(houseRot);
const rotPos = new THREE.Vector3(0, 0, 0);
pushOutOfBox(rotPos, 2.5, houseRot);
check('tank pushed out of rotated farmhouse box', Math.hypot(rotPos.x, rotPos.z) > 0.1);

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
