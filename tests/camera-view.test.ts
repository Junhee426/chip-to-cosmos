import { expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, applyInterpolatedView } from '../src/graphics/camera';

it('direct poster and completed camera flight use the same radial up and orientation', () => {
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(), update() {} };
  const view = { pos: new THREE.Vector3(8, 2, 4), target: new THREE.Vector3(5, 1, 0), up: new THREE.Vector3(1, 0, 0) };
  CameraRig.prototype.setView.call({ camera, controls } as unknown as CameraRig, view);
  const flown = new THREE.PerspectiveCamera();
  applyInterpolatedView(flown, new THREE.Vector3(), { pos: new THREE.Vector3(0, 0, 5), target: new THREE.Vector3() }, view, 1);
  expect(Math.abs(camera.quaternion.dot(flown.quaternion))).toBeCloseTo(1, 10);
  expect(camera.up.dot(view.up)).toBeCloseTo(1, 10);
  CameraRig.prototype.setView.call({ camera, controls } as unknown as CameraRig, { pos: view.pos, target: view.target });
  expect(camera.up.toArray()).toEqual([0, 1, 0]);
});
