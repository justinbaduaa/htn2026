import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { annotate, type Annotation, type AnnotationSet, type Bounds } from '../shared/annotations';
import type { CadGeometry } from '../shared/cadGeometry';

/** One printed part as loaded from its STL, in the model's own frame (outline corner at 0,0, bed at Z=0). */
export type LoadedPart = { name: string; geometry: THREE.BufferGeometry; bounds: Bounds; box: THREE.Box3 };
/** A label sits at `position`. A dimension label also carries its line and outward normal so it can be drawn along the line, drafting style. */
export type Label = { position: THREE.Vector3; text: string; kind: 'dim' | 'circle' | 'path' | 'ordinate'; line?: [THREE.Vector3, THREE.Vector3]; normal?: THREE.Vector3 };
export type Built = { group: THREE.Group; labels: Label[] };

export const PART_GAP = 12;   // mm between parts laid out along X
export const DIM_COLOR_DARK = '#b9403c';    // coral on the light viewer
export const DIM_COLOR_LIGHT = '#1d4ed8';   // blue on a white drawing sheet

export async function loadParts(parts: { name: string; url: string }[]): Promise<LoadedPart[]> {
  const loader = new STLLoader();
  return Promise.all(parts.map(async p => {
    const geometry = await loader.loadAsync(p.url);
    geometry.computeBoundingBox(); geometry.computeVertexNormals();
    const b = geometry.boundingBox!;
    return { name: p.name, geometry, box: b, bounds: { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } };
  }));
}

/** X offset of each part when they sit side by side, keeping each one's own frame otherwise. */
export function layoutOffsets(parts: LoadedPart[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const p of parts) { out.push(cursor - p.box.min.x); cursor += p.box.max.x - p.box.min.x + PART_GAP; }
  return out;
}

export function partMesh(part: LoadedPart, style: 'viewer' | 'drawing'): THREE.Object3D {
  const material = style === 'viewer'
    ? new THREE.MeshStandardMaterial({ color: '#a9bdce', roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const mesh = new THREE.Mesh(part.geometry, material);
  if (style === 'viewer') return mesh;
  const g = new THREE.Group(); g.add(mesh);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 25), new THREE.LineBasicMaterial({ color: '#111111' })));
  return g;
}

export function annotationsFor(geometry: CadGeometry, part: LoadedPart): AnnotationSet {
  const measured = geometry.parts.find(p => p.name === part.name);
  return measured ? annotate(measured) : { drawn: [] };
}

const v = (p: [number, number, number]) => new THREE.Vector3(...p);

/**
 * Lines for one annotation set. Dimension lines get extension lines and drafting ticks; holes get a
 * circle with a crosshair; openings a rectangle. Labels are returned separately so the caller can draw
 * them as HTML over the canvas or as text on an exported image.
 */
export function buildAnnotations(set: AnnotationSet, color: string, depthTest = false): Built {
  const segments: number[] = [];
  const labels: Label[] = [];
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (const a of set.drawn) {
    if (a.type === 'dim') {
      const from = v(a.from), to = v(a.to), off = v(a.offset);
      const offN = off.clone().normalize();
      const a1 = from.clone().add(off), b1 = to.clone().add(off);
      // Extension lines start a little off the part and overshoot the dimension line.
      seg(from.clone().add(offN.clone().multiplyScalar(1)), from.clone().add(off).add(offN.clone().multiplyScalar(1.5)));
      seg(to.clone().add(offN.clone().multiplyScalar(1)), to.clone().add(off).add(offN.clone().multiplyScalar(1.5)));
      seg(a1, b1);
      const dir = b1.clone().sub(a1).normalize();
      const tick = dir.clone().add(offN).normalize().multiplyScalar(1.2);
      seg(a1.clone().sub(tick), a1.clone().add(tick));
      seg(b1.clone().sub(tick), b1.clone().add(tick));
      labels.push({ position: a1.clone().add(b1).multiplyScalar(0.5), text: a.text, kind: 'dim', line: [a1, b1], normal: offN });
    } else if (a.type === 'circle') {
      const c = v(a.center), r = a.radius, n = 48;
      const axes = [0, 1, 2].filter(i => i !== a.normal);
      const point = (x: number, y: number) => { const p = c.clone(); p.setComponent(axes[0]!, p.getComponent(axes[0]!) + x); p.setComponent(axes[1]!, p.getComponent(axes[1]!) + y); return p; };
      for (let i = 0; i < n; i++) {
        const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2;
        seg(point(r * Math.cos(t0), r * Math.sin(t0)), point(r * Math.cos(t1), r * Math.sin(t1)));
      }
      seg(point(-r - 1, 0), point(r + 1, 0)); seg(point(0, -r - 1), point(0, r + 1));
      labels.push({ position: point(r + 1, r + 1), text: a.text, kind: 'circle' });
    } else if (a.type === 'ordinate') {
      // Leader from just off the feature point out to the tier, text centred beyond its end.
      const p = v(a.point), d = v(a.direction).normalize();
      const start = p.clone().add(d.clone().multiplyScalar(0.8)), end = p.clone().add(d.clone().multiplyScalar(a.length));
      seg(start, end);
      const side = new THREE.Vector3(d.y, d.z, d.x);   // any vector not parallel to d
      const across = d.clone().cross(side).normalize().multiplyScalar(0.8);
      seg(p.clone().sub(across), p.clone().add(across));
      labels.push({ position: end.clone().add(d.clone().multiplyScalar(a.pad + 0.6)), text: a.text, kind: 'ordinate', line: [start, end], normal: across });
    } else {
      for (const path of a.paths) for (let i = 1; i < path.length; i++) seg(v(path[i - 1]!), v(path[i]!));
      labels.push({ position: v(a.position), text: a.text, kind: 'path' });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest, transparent: true, opacity: 0.95 }));
  lines.renderOrder = 10;
  const group = new THREE.Group(); group.add(lines);
  return { group, labels };
}

/** Screen position of a world point for the given camera and canvas size. */
export function project(p: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
  const n = p.clone().project(camera);
  return { x: (n.x + 1) / 2 * width, y: (1 - n.y) / 2 * height, visible: n.z > -1 && n.z < 1 };
}

/**
 * Where and how to draw a label on screen. Dimension text runs along its line, never upside down, and
 * sits on the side of the line away from the part (`below` means the text hangs under the anchor in its own frame).
 */
export function placeLabel(l: Label, camera: THREE.Camera, width: number, height: number) {
  const p = project(l.position, camera, width, height);
  if (!l.line || !l.normal) return { ...p, angle: 0, below: false, centered: false };
  const a = project(l.line[0], camera, width, height), b = project(l.line[1], camera, width, height);
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
  // Ordinate text continues the leader, centred on its axis.
  if (l.kind === 'ordinate') return { ...p, angle, below: false, centered: true };
  const n = project(l.position.clone().add(l.normal), camera, width, height);
  const rad = angle * Math.PI / 180;
  // The text's own "up" after rotation, in screen space (y down). Keep the text on the outward side of the line.
  const below = Math.sin(rad) * (n.x - p.x) - Math.cos(rad) * (n.y - p.y) < 0;
  return { ...p, angle, below, centered: false };
}

/** Whether an annotation reads in an orthographic view looking along `dir`: a vertical dim is a dot from above, a footprint is a line from the side. */
export function readableFrom(a: Annotation, dir: THREE.Vector3): boolean {
  if (a.type === 'dim') {
    const d = v(a.to).sub(v(a.from)).normalize();
    return Math.abs(d.dot(dir)) < 0.9;
  }
  return Math.abs(dir.getComponent(a.normal)) > 0.5;
}

/**
 * Frames `box` in an orthographic camera looking along `dir` with `up`, leaving room for dimension lines
 * around the part. Returns the camera.
 */
export function frameOrtho(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, aspect: number, margin = 0.32): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length();
  camera.up.copy(up);
  camera.position.copy(center).add(dir.clone().normalize().multiplyScalar(radius * 2 + 100));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  // Extents of the box corners in camera space set the frustum.
  const inv = camera.matrixWorldInverse;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  let w = (maxX - minX) * (1 + margin), h = (maxY - minY) * (1 + margin);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  camera.left = cx - w / 2; camera.right = cx + w / 2; camera.top = cy + h / 2; camera.bottom = cy - h / 2;
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * Sheet views. `normal` and `face` pick which annotations belong to an orthographic view; the isometric
 * view has neither. `optional` views only go on the sheet when a part has features facing that way.
 */
export type View = { key: string; title: string; dir: [number, number, number]; up: [number, number, number]; normal?: 0 | 1 | 2; face?: 'min' | 'max'; optional?: boolean };
export const VIEWS: View[] = [
  { key: 'top', title: 'Top', dir: [0, 0, 1], up: [0, 1, 0], normal: 2, face: 'max' },
  { key: 'front', title: 'Front', dir: [0, -1, 0], up: [0, 0, 1], normal: 1, face: 'min' },
  { key: 'right', title: 'Right', dir: [1, 0, 0], up: [0, 0, 1], normal: 0, face: 'max' },
  { key: 'iso', title: 'Isometric', dir: [1, -1, 1], up: [0, 0, 1] },
  { key: 'bottom', title: 'Bottom', dir: [0, 0, -1], up: [0, 1, 0], normal: 2, face: 'min', optional: true },
  { key: 'back', title: 'Back', dir: [0, 1, 0], up: [0, 0, 1], normal: 1, face: 'max', optional: true },
  { key: 'left', title: 'Left', dir: [-1, 0, 0], up: [0, 0, 1], normal: 0, face: 'min', optional: true },
];

/** An optional view earns its place when it shows a feature, not just repeated ordinates and overall sizes. */
export function viewsFor(set: AnnotationSet): View[] {
  return VIEWS.filter(v => !v.optional || set.drawn.some(a => belongsTo(a, v) && (a.type === 'circle' || a.type === 'path' || (a.type === 'dim' && !a.id.startsWith('part_')))));
}

/** Which annotations a sheet view draws: its own plane's, or for the isometric view everything readable except the ordinate leaders. */
export function belongsTo(a: Annotation, view: typeof VIEWS[number]): boolean {
  if (view.normal === undefined) return !a.secondary && a.type !== 'ordinate' && readableFrom(a, new THREE.Vector3(...view.dir).normalize());
  return a.normal === view.normal && a.face === view.face;
}

/** Do not label features through an intervening solid (e.g. a rear counterbore from above). */
export function labelVisible(position: THREE.Vector3, camera: THREE.Camera, solids: THREE.Object3D[]): boolean {
  camera.updateMatrixWorld();
  const projected = position.clone().project(camera);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
  const distance = position.clone().sub(ray.ray.origin).dot(ray.ray.direction);
  ray.far = Math.max(0, distance - 0.05);
  return ray.intersectObjects(solids, false).length === 0;
}
