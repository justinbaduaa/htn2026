import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { annotate, type Annotation, type AnnotationSet, type Bounds } from '../shared/annotations';
import type { DimsFile } from '../shared/types';

/** One printed part as loaded from its STL, in the model's own frame (outline corner at 0,0, bed at Z=0). */
export type LoadedPart = { name: string; geometry: THREE.BufferGeometry; bounds: Bounds; box: THREE.Box3 };
/** A label sits at `position`. A dimension label also carries its line and outward normal so it can be drawn along the line, drafting style. */
export type Label = { position: THREE.Vector3; text: string; kind: 'dim' | 'circle' | 'rect'; line?: [THREE.Vector3, THREE.Vector3]; normal?: THREE.Vector3 };
export type Built = { group: THREE.Group; labels: Label[] };

export const PART_GAP = 12;   // mm between parts laid out along X
export const DIM_COLOR_DARK = '#fbbf24';    // amber on the black viewer
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
    ? new THREE.MeshStandardMaterial({ color: '#d4d4d4', roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const mesh = new THREE.Mesh(part.geometry, material);
  if (style === 'viewer') return mesh;
  const g = new THREE.Group(); g.add(mesh);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 25), new THREE.LineBasicMaterial({ color: '#111111' })));
  return g;
}

export function annotationsFor(dims: DimsFile, part: LoadedPart): AnnotationSet {
  return annotate(dims, part.bounds);
}

const v = (p: [number, number, number]) => new THREE.Vector3(...p);

/**
 * Lines for one annotation set. Dimension lines get extension lines and drafting ticks; holes get a
 * circle with a crosshair; openings a rectangle. Labels are returned separately so the caller can draw
 * them as HTML over the canvas or as text on an exported image.
 */
export function buildAnnotations(set: AnnotationSet, color: string): Built {
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
      const c = v(a.center), r = a.radius, n = 32;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
        seg(new THREE.Vector3(c.x + r * Math.cos(t0), c.y + r * Math.sin(t0), c.z), new THREE.Vector3(c.x + r * Math.cos(t1), c.y + r * Math.sin(t1), c.z));
      }
      const x = r + 1.5;
      seg(new THREE.Vector3(c.x - x, c.y, c.z), new THREE.Vector3(c.x + x, c.y, c.z));
      seg(new THREE.Vector3(c.x, c.y - x, c.z), new THREE.Vector3(c.x, c.y + x, c.z));
      labels.push({ position: new THREE.Vector3(c.x + r + 1, c.y + r + 1, c.z), text: a.text, kind: 'circle' });
    } else {
      const o = v(a.origin);
      const p = [o, new THREE.Vector3(o.x + a.w, o.y, o.z), new THREE.Vector3(o.x + a.w, o.y + a.h, o.z), new THREE.Vector3(o.x, o.y + a.h, o.z)];
      for (let i = 0; i < 4; i++) seg(p[i]!, p[(i + 1) % 4]!);
      labels.push({ position: new THREE.Vector3(o.x + a.w / 2, o.y + a.h + 1.5, o.z), text: a.text, kind: 'rect' });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
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
  if (!l.line || !l.normal) return { ...p, angle: 0, below: false };
  const a = project(l.line[0], camera, width, height), b = project(l.line[1], camera, width, height);
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
  const n = project(l.position.clone().add(l.normal), camera, width, height);
  const rad = angle * Math.PI / 180;
  // The text's own "up" after rotation, in screen space (y down). Keep the text on the outward side of the line.
  const below = Math.sin(rad) * (n.x - p.x) - Math.cos(rad) * (n.y - p.y) < 0;
  return { ...p, angle, below };
}

/** Whether an annotation reads in an orthographic view looking along `dir`: a vertical dim is a dot from above, a footprint is a line from the side. */
export function readableFrom(a: Annotation, dir: THREE.Vector3): boolean {
  if (a.type === 'dim') {
    const d = v(a.to).sub(v(a.from)).normalize();
    return Math.abs(d.dot(dir)) < 0.9;
  }
  return Math.abs(dir.z) > 0.5;
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

export const VIEWS: { key: string; title: string; dir: [number, number, number]; up: [number, number, number] }[] = [
  { key: 'top', title: 'Top', dir: [0, 0, 1], up: [0, 1, 0] },
  { key: 'front', title: 'Front', dir: [0, -1, 0], up: [0, 0, 1] },
  { key: 'right', title: 'Right', dir: [1, 0, 0], up: [0, 0, 1] },
  { key: 'iso', title: 'Isometric', dir: [1, -1, 1], up: [0, 0, 1] },
];
