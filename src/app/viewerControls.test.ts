// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { createViewerControls, zoomAtPointer } from './viewerControls';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); });
function setup() {
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 520, right: 800, bottom: 520, x: 0, y: 0, toJSON() {} });
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  const camera = new THREE.PerspectiveCamera(40, 800 / 520, 0.1, 10000);
  camera.up.set(0, 0, 1); camera.position.set(100, -100, 140); camera.lookAt(0, 0, 0);
  const navigation = createViewerControls(camera, canvas);
  navigation.controls.minDistance = 10; navigation.controls.maxDistance = 1000;
  cleanup.push(() => { navigation.dispose(); canvas.remove(); });
  return { camera, canvas, ...navigation };
}
function pointer(target: EventTarget, type: string, x: number, y: number, button = 0, shiftKey = false) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button, shiftKey });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

test.each([{ button: 1, shift: false }, { button: 2, shift: false }, { button: 0, shift: true }])('pan moves camera and target together: %j', ({ button, shift }) => {
  const { camera, controls, canvas } = setup();
  const eye = camera.position.clone().sub(controls.target);
  pointer(canvas, 'pointerdown', 400, 260, button, shift);
  pointer(document, 'pointermove', 450, 280, button, shift); controls.update();
  pointer(document, 'pointerup', 450, 280, button, shift);
  expect(controls.target.length()).toBeGreaterThan(1);
  expect(camera.position.clone().sub(controls.target).distanceTo(eye)).toBeLessThan(1e-8);
});

test('Pan mode allows plain left-drag panning', () => {
  const { controls, canvas, setMode } = setup(); setMode('pan');
  pointer(canvas, 'pointerdown', 400, 260);
  pointer(document, 'pointermove', 450, 260); controls.update();
  pointer(document, 'pointerup', 450, 260);
  expect(controls.target.length()).toBeGreaterThan(1);
});

test('rotation passes through poles and stops immediately after release', () => {
  const { camera, controls, canvas } = setup();
  const radius = camera.position.distanceTo(controls.target);
  let wentBelow = false, invertedUp = false;
  for (let i = 0; i < 32; i++) {
    pointer(canvas, 'pointerdown', 400, 240);
    pointer(document, 'pointermove', 400, 360); controls.update();
    pointer(document, 'pointerup', 400, 360);
    wentBelow ||= camera.position.z < 0;
    invertedUp ||= camera.up.z < 0;
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(radius, 7);
    expect(Number.isFinite(camera.quaternion.w)).toBe(true);
  }
  expect(wentBelow).toBe(true); expect(invertedUp).toBe(true);
  const position = camera.position.clone(), up = camera.up.clone();
  for (let i = 0; i < 30; i++) controls.update();
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
  expect(camera.up.distanceTo(up)).toBeLessThan(1e-8);
});

test('cursor-centered zoom preserves the pointed-at location and clamps both limits', () => {
  const { camera, controls } = setup();
  const pointer = new THREE.Vector2(.4, -.3);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), controls.target);
  const anchor = ray.ray.intersectPlane(plane, new THREE.Vector3())!;
  zoomAtPointer(camera, controls, .75, pointer); controls.update(); camera.updateMatrixWorld();
  const projected = anchor.clone().project(camera);
  expect(projected.x).toBeCloseTo(pointer.x, 7); expect(projected.y).toBeCloseTo(pointer.y, 7);
  zoomAtPointer(camera, controls, 1e-10, pointer); controls.update();
  expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 7);
  zoomAtPointer(camera, controls, 1e10, pointer); controls.update();
  expect(camera.position.distanceTo(controls.target)).toBeCloseTo(1000, 7);
});

test('large wheel events remain bounded and do not scroll the page', () => {
  const { camera, controls, canvas } = setup();
  const before = camera.position.distanceTo(controls.target);
  const event = new WheelEvent('wheel', { deltaY: 10000, clientX: 400, clientY: 260, cancelable: true });
  canvas.dispatchEvent(event);
  const ratio = camera.position.distanceTo(controls.target) / before;
  expect(ratio).toBeGreaterThan(1); expect(ratio).toBeLessThan(1.2);
  expect(event.defaultPrevented).toBe(true);
});
