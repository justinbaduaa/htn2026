import * as THREE from 'three';
import type { DimsFile } from '../shared/types';
import { fmt, type Listed } from '../shared/annotations';
import { annotationsFor, buildAnnotations, DIM_COLOR_LIGHT, frameOrtho, partMesh, placeLabel, readableFrom, VIEWS, type LoadedPart } from './scene';

export type ViewImage = { key: string; title: string; dataUrl: string };
export type PartDrawing = { part: string; size: [number, number, number]; views: ViewImage[]; sheet: string; listed: Listed[] };
export type SheetMeta = { title: string; projectId: string; run: number };

const VIEW_W = 1000, VIEW_H = 720;
const FONT = '13px ui-sans-serif, system-ui, sans-serif';

/**
 * Engineering views of every printed part: top, front, right, and isometric, orthographic, on white,
 * with black edges and the same dimension annotations as the viewer. Each view is a PNG; the sheet
 * puts the four views on one page with a title block and the full table of readings the part was built from.
 * Rendered offscreen; the renderer is disposed before returning.
 */
export async function renderDrawings(parts: LoadedPart[], dims: DimsFile, meta: SheetMeta): Promise<PartDrawing[]> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(VIEW_W, VIEW_H);
  const out: PartDrawing[] = [];
  try {
    for (const part of parts) {
      const set = annotationsFor(dims, part);
      const views: ViewImage[] = [];
      for (const view of VIEWS) {
        const dir = new THREE.Vector3(...view.dir).normalize();
        const visible = { drawn: set.drawn.filter(a => readableFrom(a, dir)), listed: set.listed };
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
        scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 1.6));
        const light = new THREE.DirectionalLight('#ffffff', 1.2); light.position.set(1, -1.5, 2.5); scene.add(light);
        scene.add(partMesh(part, 'drawing'));
        const built = buildAnnotations(visible, DIM_COLOR_LIGHT);
        scene.add(built.group);
        // Frame the part plus every annotation point so dimension lines are never cropped.
        const box = part.box.clone();
        for (const a of visible.drawn) {
          if (a.type === 'dim') { box.expandByPoint(new THREE.Vector3(...a.from).add(new THREE.Vector3(...a.offset).multiplyScalar(1.6))); box.expandByPoint(new THREE.Vector3(...a.to).add(new THREE.Vector3(...a.offset).multiplyScalar(1.6))); }
          else if (a.type === 'circle') box.expandByPoint(new THREE.Vector3(a.center[0] + a.radius, a.center[1] + a.radius, a.center[2]));
          else box.expandByPoint(new THREE.Vector3(a.origin[0] + a.w, a.origin[1] + a.h, a.origin[2]));
        }
        const camera = frameOrtho(box, dir, new THREE.Vector3(...view.up), VIEW_W / VIEW_H);
        renderer.render(scene, camera);
        const canvas = document.createElement('canvas'); canvas.width = VIEW_W; canvas.height = VIEW_H;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(renderer.domElement, 0, 0);
        ctx.font = FONT; ctx.textAlign = 'center';
        for (const l of built.labels) {
          const p = placeLabel(l, camera, VIEW_W, VIEW_H);
          const w = ctx.measureText(l.text).width + 6;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle * Math.PI / 180);
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-w / 2, p.below ? 1 : -16, w, 16);
          ctx.textBaseline = p.below ? 'top' : 'bottom';
          ctx.fillStyle = DIM_COLOR_LIGHT; ctx.fillText(l.text, 0, p.below ? 1 : -1);
          ctx.restore();
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#111'; ctx.font = 'bold 16px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${view.title} view`, 14, 12);
        ctx.font = FONT; ctx.fillStyle = '#555'; ctx.fillText('mm, orthographic', 14, 34);
        views.push({ key: view.key, title: view.title, dataUrl: canvas.toDataURL('image/png') });
        scene.traverse(o => { if (o instanceof THREE.LineSegments || o instanceof THREE.Mesh) { (o.material as THREE.Material).dispose(); if (o !== undefined && o.geometry !== part.geometry) o.geometry.dispose(); } });
      }
      const size: [number, number, number] = [part.box.max.x - part.box.min.x, part.box.max.y - part.box.min.y, part.box.max.z - part.box.min.z];
      out.push({ part: part.name, size, views, sheet: await composeSheet(views, part.name, size, dims, meta), listed: set.listed });
    }
  } finally { renderer.dispose(); }
  return out;
}

/** One page: 2x2 views, a title block, and every reading in a three-column table. */
async function composeSheet(views: ViewImage[], part: string, size: [number, number, number], dims: DimsFile, meta: SheetMeta): Promise<string> {
  const images = await Promise.all(views.map(v => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = v.dataUrl; })));
  const gap = 20, cols = 3, rowH = 18, tableTop = 2 * VIEW_H + 3 * gap + 110;
  const rows = Math.ceil(dims.dimensions.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = 2 * VIEW_W + 3 * gap; canvas.height = tableTop + rows * rowH + 40 + gap;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  images.forEach((img, i) => {
    const x = gap + (i % 2) * (VIEW_W + gap), y = gap + Math.floor(i / 2) * (VIEW_H + gap);
    ctx.drawImage(img, x, y); ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, VIEW_W - 1, VIEW_H - 1);
  });
  // Title block.
  const ty = 2 * VIEW_H + 3 * gap;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.strokeRect(gap, ty, canvas.width - 2 * gap, 90);
  ctx.fillStyle = '#111'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = 'bold 26px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(part.replace(/_/g, ' '), gap + 16, ty + 12);
  ctx.font = '16px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#333';
  ctx.fillText(`${meta.title}. Project ${meta.projectId}, run ${meta.run + 1}. ${new Date().toISOString().slice(0, 10)}.`, gap + 16, ty + 50);
  ctx.textAlign = 'right';
  ctx.fillText(`Overall ${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm`, canvas.width - gap - 16, ty + 12);
  ctx.fillText(`Units mm. Fit clearance ${dims.constants.fit_clearance_mm}, hole compensation ${dims.constants.hole_compensation_mm}, wall ${dims.constants.wall_mm}. Printed flat face down.`, canvas.width - gap - 16, ty + 50);
  // Readings table.
  ctx.textAlign = 'left'; ctx.font = 'bold 15px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#111';
  ctx.fillText('Readings the part was built from (id, name, mm; est. = estimated from the photos, not measured)', gap + 16, tableTop);
  ctx.font = '13px ui-monospace, monospace';
  const colW = (canvas.width - 2 * gap - 32) / cols;
  dims.dimensions.forEach((d, i) => {
    const x = gap + 16 + Math.floor(i / rows) * colW, y = tableTop + 26 + (i % rows) * rowH;
    ctx.fillStyle = '#333';
    const name = d.name.length > 44 ? `${d.name.slice(0, 43)}…` : d.name;
    ctx.fillText(`${d.id.padEnd(12)} ${name}`, x, y);
    ctx.textAlign = 'right'; ctx.fillStyle = d.estimated ? '#b45309' : '#111';
    ctx.fillText(`${fmt(d.value_mm)}${d.estimated ? ' est.' : ''}`, x + colW - 24, y);
    ctx.textAlign = 'left';
  });
  return canvas.toDataURL('image/png');
}
