import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';

/** Free rotation, screen-plane panning, and bounded zoom without inertial drift. */
export function createViewerControls(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
  const controls = new TrackballControls(camera, canvas);
  controls.rotateSpeed = 1.2;
  controls.panSpeed = 0.65;
  controls.zoomSpeed = 0.65;
  controls.staticMoving = true;
  controls.keys = ['', '', '']; // Do not capture letters typed in the measurement editor.
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  let mode: 'orbit' | 'pan' = 'orbit';
  const pointerDown = (event: PointerEvent) => {
    controls.handleResize(); // Also account for page/panel scrolling since the last resize.
    controls.mouseButtons.LEFT = mode === 'pan' || event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  };
  const wheel = (event: WheelEvent) => {
    if (!controls.enabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    controls.update();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    const factor = Math.exp(THREE.MathUtils.clamp(delta, -120, 120) * 0.0015);
    zoomAtPointer(camera, controls, factor, new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2,
    ));
    controls.update();
  };
  canvas.addEventListener('pointerdown', pointerDown, true);
  canvas.addEventListener('wheel', wheel, { capture: true, passive: false });
  return {
    controls,
    setMode(next: 'orbit' | 'pan') { mode = next; },
    dispose() {
      canvas.removeEventListener('pointerdown', pointerDown, true);
      canvas.removeEventListener('wheel', wheel, true);
      controls.dispose();
    },
  };
}

/** Keep the point beneath the cursor fixed on the plane through the orbit target. */
export function zoomAtPointer(
  camera: THREE.PerspectiveCamera,
  controls: Pick<TrackballControls, 'target' | 'minDistance' | 'maxDistance'>,
  factor: number,
  pointer: THREE.Vector2,
) {
  const distance = camera.position.distanceTo(controls.target);
  if (distance === 0) return;
  const next = THREE.MathUtils.clamp(distance * factor, controls.minDistance, controls.maxDistance);
  const ratio = next / distance;
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), controls.target);
  const anchor = ray.ray.intersectPlane(plane, new THREE.Vector3()) ?? controls.target.clone();
  camera.position.sub(anchor).multiplyScalar(ratio).add(anchor);
  controls.target.sub(anchor).multiplyScalar(ratio).add(anchor);
}
