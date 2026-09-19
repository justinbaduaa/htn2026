import * as THREE from 'three';
import type { CadGeometry, CadPart } from '../shared/cadGeometry';
import { fmt, featureRows } from '../shared/annotations';
import { annotationsFor, belongsTo, buildAnnotations, DIM_COLOR_LIGHT, frameOrtho, partMesh, placeLabel, labelVisible, viewsFor, type LoadedPart } from './scene';

export type ViewImage = { key: string; title: string; dataUrl: string };
export type PartDrawing = { part: string; size: [number, number, number]; views: ViewImage[]; sheet: string; features: string[]; notes: string[] };
export type SheetMeta = { title: string; projectId: string; run: number };

const VIEW_W = 1000, VIEW_H = 720;
const FONT = '13px ui-sans-serif, system-ui, sans-serif';

/**
 * Engineering views of every printed part: top, front, right, and isometric, plus bottom, back, or left
 * when features face that way. Orthographic, on white, with black edges and the same dimension
 * annotations as the viewer. Each view is a PNG; the sheet puts them on one page with a title block
 * and a schedule of measured CAD features.
 * Rendered offscreen; the renderer is disposed before returning.
 */
export async function renderDrawings(parts: LoadedPart[], geometry: CadGeometry, meta: SheetMeta): Promise<PartDrawing[]> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(VIEW_W, VIEW_H);
  const out: PartDrawing[] = [];
  try {
    for (const part of parts) {
      const measured = geometry.parts.find(p => p.name === part.name);
      if (!measured) throw new Error(`No STEP measurements for ${part.name}`);
      const set = annotationsFor(geometry, part);
      const views: ViewImage[] = [];
      for (const view of viewsFor(set)) {
        const dir = new THREE.Vector3(...view.dir).normalize();
        const visible = { drawn: set.drawn.filter(a => belongsTo(a, view)) };
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
        scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 1.6));
        const light = new THREE.DirectionalLight('#ffffff', 1.2); light.position.set(1, -1.5, 2.5); scene.add(light);
        const model = partMesh(part, 'drawing'); scene.add(model);
        const solids: THREE.Object3D[] = []; model.traverse(o => { if (o instanceof THREE.Mesh) solids.push(o); });
        const built = buildAnnotations(visible, DIM_COLOR_LIGHT);
        scene.add(built.group);
        // Frame the part plus every annotation point so dimension lines are never cropped.
        const box = part.box.clone();
        box.union(new THREE.Box3().setFromObject(built.group));
        const camera = frameOrtho(box, dir, new THREE.Vector3(...view.up), VIEW_W / VIEW_H);
        renderer.render(scene, camera);
        const canvas = document.createElement('canvas'); canvas.width = VIEW_W; canvas.height = VIEW_H;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(renderer.domElement, 0, 0);
        ctx.font = FONT; ctx.textAlign = 'center';
        const occupied: { x: number; y: number; w: number; h: number }[] = [];
        for (const l of built.labels) {
          if (!l.text || !labelVisible(l.position, camera, solids)) continue;
          const p = placeLabel(l, camera, VIEW_W, VIEW_H);
          const w = ctx.measureText(l.text).width + 6;
          const rect = { x: p.x - w/2, y: p.y - 18, w, h: 20 };
          if (occupied.some(b => rect.x < b.x+b.w+5 && rect.x+rect.w+5 > b.x && rect.y < b.y+b.h+4 && rect.y+rect.h+4 > b.y)) continue;
          occupied.push(rect);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle * Math.PI / 180);
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-w / 2, p.centered ? -8 : p.below ? 1 : -16, w, 16);
          ctx.textBaseline = p.centered ? 'middle' : p.below ? 'top' : 'bottom';
          ctx.fillStyle = DIM_COLOR_LIGHT; ctx.fillText(l.text, 0, p.centered ? 0 : p.below ? 1 : -1);
          ctx.restore();
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#111'; ctx.font = 'bold 16px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${view.title} view`, 14, 12);
        ctx.font = FONT; ctx.fillStyle = '#555'; ctx.fillText('mm, orthographic', 14, 34);
        views.push({ key: view.key, title: view.title, dataUrl: canvas.toDataURL('image/png') });
        scene.traverse(o => { if (o instanceof THREE.LineSegments || o instanceof THREE.Mesh) { (o.material as THREE.Material).dispose(); if (o !== undefined && o.geometry !== part.geometry) o.geometry.dispose(); } });
      }
      const size = measured.bounds.max.map((v, i) => v - measured.bounds.min[i]!) as [number, number, number];
      out.push({ part: part.name, size, views, sheet: await composeSheet(views, part.name, size, measured, meta), features: featureRows(measured), notes: measured.notes });
    }
  } finally { renderer.dispose(); parts.forEach(part => part.geometry.dispose()); }
  return out;
}

/** One page: the views two per row, a title block, and the measured CAD feature schedule. */
async function composeSheet(views: ViewImage[], part: string, size: [number, number, number], measured: CadPart, meta: SheetMeta): Promise<string> {
  const images = await Promise.all(views.map(v => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = v.dataUrl; })));
  const viewRows = Math.ceil(views.length / 2);
  const gap = 20, rowH = 20, tableTop = viewRows * VIEW_H + (viewRows + 1) * gap + 110;
  const schedule = featureRows(measured);
  const rows = schedule.length + measured.notes.length + 2;
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
  const ty = viewRows * VIEW_H + (viewRows + 1) * gap;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.strokeRect(gap, ty, canvas.width - 2 * gap, 90);
  ctx.fillStyle = '#111'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = 'bold 26px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(part.replace(/_/g, ' '), gap + 16, ty + 12);
  ctx.font = '16px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#333';
  ctx.fillText(`${meta.title}. Project ${meta.projectId}, run ${meta.run + 1}. ${new Date().toISOString().slice(0, 10)}.`, gap + 16, ty + 50);
  ctx.textAlign = 'right';
  ctx.fillText(`Overall ${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm`, canvas.width - gap - 16, ty + 12);
  ctx.fillText('Units mm. Measured from exported STEP. Nominal geometry; no manufacturing tolerances specified.', canvas.width - gap - 16, ty + 50);
  ctx.textAlign = 'left'; ctx.font = 'bold 15px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#111';
  ctx.fillText('STEP feature schedule — XYZ from part minimum corner; levels are face positions. Profile envelopes are reference sizes.', gap + 16, tableTop);
  ctx.font = '14px ui-monospace, monospace';
  [...schedule, ...measured.notes].forEach((row, i) => ctx.fillText(row, gap + 16, tableTop + 28 + i * rowH));
  return canvas.toDataURL('image/png');
}
