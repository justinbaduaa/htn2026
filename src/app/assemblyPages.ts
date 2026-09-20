import * as THREE from 'three';
import type { AssemblyPlan, Step } from './assembly';
import { frameOrtho, partMesh, type LoadedPart } from './scene';

export type AssemblyPage = { key: string; title: string; dataUrl: string };
export type AssemblyMeta = { title: string };

export const PAGE_W = 1000, PAGE_H = 1320;
const STAGE_W = 1000, STAGE_H = 940, STAGE_Y = 150;
const ISO = new THREE.Vector3(1, -1, 0.9).normalize();
const UP = new THREE.Vector3(0, 0, 1);
const INK = '#111111';
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Light fill, black edges: the same line-drawing look as the engineering views. */
function lineArt(geometry: THREE.BufferGeometry, fill = '#f4f4f4', edgeAngle = 25): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: fill, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), new THREE.LineBasicMaterial({ color: INK })));
  return g;
}

function screwMesh(plan: AssemblyPlan): THREE.Group {
  const { thread, headDiameter, headHeight, screwLength } = plan.hardware;
  const g = new THREE.Group();
  // Origin at the underside of the head; the shaft hangs down -Z.
  const head = lineArt(new THREE.CylinderGeometry(headDiameter / 2, headDiameter / 2, headHeight, 32), '#e2e2e2', 40);
  head.rotation.x = Math.PI / 2; head.position.z = headHeight / 2; g.add(head);
  const shaft = lineArt(new THREE.CylinderGeometry(thread / 2, thread / 2, screwLength, 24), '#e2e2e2', 40);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = -screwLength / 2; g.add(shaft);
  // Drive slot on the head, drawn as two short lines.
  const r = headDiameter * 0.36, z = headHeight + 0.05;
  const slot = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-r, 0, z), new THREE.Vector3(r, 0, z), new THREE.Vector3(0, -r, z), new THREE.Vector3(0, r, z)]);
  g.add(new THREE.LineSegments(slot, new THREE.LineBasicMaterial({ color: INK })));
  return g;
}

function nutMesh(plan: AssemblyPlan): THREE.Group {
  const { nutAcrossFlats, nutThickness, thread } = plan.hardware;
  const g = new THREE.Group();
  // Origin at the nut's underside; a hex prism rising +Z with a drawn bore.
  const hex = lineArt(new THREE.CylinderGeometry(nutAcrossFlats / Math.sqrt(3), nutAcrossFlats / Math.sqrt(3), nutThickness, 6), '#e2e2e2', 10);
  hex.rotation.x = Math.PI / 2; hex.rotation.y = Math.PI / 6; hex.position.z = nutThickness / 2; g.add(hex);
  const ring = new THREE.EdgesGeometry(new THREE.CircleGeometry(thread / 2, 32), 1);
  const top = new THREE.LineSegments(ring, new THREE.LineBasicMaterial({ color: INK })); top.position.z = nutThickness + 0.05; g.add(top);
  return g;
}

type Item = { object: THREE.Object3D; anchor: THREE.Vector3; lift: THREE.Vector3; from?: THREE.Vector3 };   // from: where the arrow starts, in the exploded position; defaults to anchor + lift
type Scene = { root: THREE.Group; scene: THREE.Scene; items: Item[]; flipped: boolean };

/**
 * Builds the assembly in the base part's frame. Components later than `upto` are left out, the ones in the
 * current step are exploded along their lift and returned as items so arrows can be drawn to their seats.
 */
function buildScene(parts: LoadedPart[], plan: AssemblyPlan, step: Step | null): Scene {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
  scene.add(new THREE.HemisphereLight('#ffffff', '#9a9a9a', 1.7));
  const light = new THREE.DirectionalLight('#ffffff', 1.0); light.position.set(1.5, -2, 3); scene.add(light);
  const root = new THREE.Group(); scene.add(root);
  const items: Item[] = [];
  const order: Step['kind'][] = ['insert-object', 'place-top', 'screws', 'flip', 'nuts', 'tighten'];
  const stage = step ? order.indexOf(step.kind) : order.length;
  const present = (kind: Step['kind']) => stage > order.indexOf(kind);
  const current = (kind: Step['kind']) => step?.kind === kind;
  const lift = Math.max(30, plan.height * 1.1);
  const byName = new Map(parts.map(p => [p.name, p]));

  const placed = (name: string, flip: 'none' | 'x' | 'y', z: number) => {
    const part = byName.get(name); if (!part) throw new Error(`Missing mesh for ${name}`);
    const mesh = partMesh(part, 'drawing');
    const c = part.box.getCenter(new THREE.Vector3());
    const dz = z - part.box.min.z;
    if (flip === 'x') { mesh.rotation.x = Math.PI; mesh.position.set(0, 2 * c.y, 2 * c.z + dz); }
    else if (flip === 'y') { mesh.rotation.y = Math.PI; mesh.position.set(2 * c.x, 0, 2 * c.z + dz); }
    else mesh.position.set(0, 0, dz);
    return { mesh, part, centre: new THREE.Vector3(c.x, flip === 'x' ? 2 * c.y - c.y : c.y, z) };
  };

  const base = placed(plan.base.part, 'none', 0); root.add(base.mesh);
  const baseCentre = base.part.box.getCenter(new THREE.Vector3());
  const up = new THREE.Vector3(0, 0, lift);

  if (plan.object && (present('insert-object') || current('insert-object'))) {
    const [w, h, t] = plan.object.size;
    const slab = lineArt(new THREE.BoxGeometry(w, h, t), '#d9d9d9', 25);
    slab.position.set(w / 2, h / 2, plan.object.z + t / 2);
    root.add(slab);
    if (current('insert-object')) items.push({ object: slab, anchor: new THREE.Vector3(w / 2, h / 2, plan.object.z), lift: up });
  }
  if (plan.top.part !== plan.base.part && (present('place-top') || current('place-top'))) {
    const top = placed(plan.top.part, plan.top.flip, plan.top.z); root.add(top.mesh);
    if (current('place-top')) items.push({ object: top.mesh, anchor: new THREE.Vector3(baseCentre.x, baseCentre.y, plan.top.z), lift: up });
  }
  if (present('screws') || current('screws')) {
    const seat = plan.height - plan.counterboreDepth;
    for (const s of plan.screws) {
      const screw = screwMesh(plan); screw.position.set(s.x, s.y, seat); root.add(screw);
      if (current('screws')) {
        const rise = plan.hardware.screwLength + 34;
        items.push({ object: screw, anchor: new THREE.Vector3(s.x, s.y, plan.height), lift: new THREE.Vector3(0, 0, rise), from: new THREE.Vector3(s.x, s.y, seat + rise - plan.hardware.screwLength) });
      }
    }
  }
  const flipped = plan.hardware.hasNuts && (current('flip') || current('nuts'));
  if (plan.hardware.hasNuts && (present('nuts') || current('nuts'))) {
    for (const s of plan.screws) {
      const nut = nutMesh(plan); nut.position.set(s.x, s.y, 0); root.add(nut);
      // Exploded away from the base's outside face, which is uppermost once the assembly is turned over.
      if (current('nuts')) items.push({ object: nut, anchor: new THREE.Vector3(s.x, s.y, 0), lift: new THREE.Vector3(0, 0, -(plan.hardware.nutThickness + 18)), from: new THREE.Vector3(s.x, s.y, -18) });
    }
  }
  for (const item of items) item.object.position.add(item.lift);
  if (flipped) { root.rotation.x = Math.PI; root.position.set(0, 2 * baseCentre.y, plan.height); }
  root.updateMatrixWorld(true);
  return { root, scene, items, flipped };
}

function disposeScene(scene: THREE.Scene, keep: Set<THREE.BufferGeometry>) {
  scene.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      if (!keep.has(o.geometry)) o.geometry.dispose();
    }
  });
}

type Ctx = CanvasRenderingContext2D;
const px = (v: THREE.Vector3, camera: THREE.Camera, w: number, h: number) => { const n = v.clone().project(camera); return { x: (n.x + 1) / 2 * w, y: (1 - n.y) / 2 * h }; };

/** A thick IKEA arrow: white halo, black shaft, filled head landing just short of the target. */
function arrow(ctx: Ctx, from: { x: number; y: number }, to: { x: number; y: number }, gap = 10) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy); if (len < 20) return;
  const ux = dx / len, uy = dy / len;
  const start = { x: from.x + ux * gap, y: from.y + uy * gap }, end = { x: to.x - ux * gap, y: to.y - uy * gap };
  const head = 22, half = 12;
  const tail = { x: end.x - ux * head, y: end.y - uy * head };
  for (const [color, width] of [['#ffffff', 11], [INK, 5]] as const) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(tail.x, tail.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(tail.x - uy * half, tail.y + ux * half); ctx.lineTo(tail.x + uy * half, tail.y - ux * half); ctx.closePath();
    if (color === '#ffffff') { ctx.lineWidth = 6; ctx.stroke(); } ctx.fill();
  }
}

/** A curved "turn over" arrow around a point. */
function turnArrow(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  const a = Math.PI * 1.85, tip = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  const tx = -Math.sin(a), ty = Math.cos(a);   // tangent direction of travel
  ctx.beginPath(); ctx.moveTo(tip.x + tx * 22, tip.y + ty * 22);
  ctx.lineTo(tip.x - ty * 12, tip.y + tx * 12); ctx.lineTo(tip.x + ty * 12, tip.y - tx * 12); ctx.closePath(); ctx.fill();
}

function wrap(ctx: Ctx, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' '); let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, y); line = word; y += lineHeight; } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

function stepBadge(ctx: Ctx, n: number, x: number, y: number) {
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `bold 52px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 2);
}

function frame(ctx: Ctx) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(24, 24, PAGE_W - 48, PAGE_H - 48);
}

function footer(ctx: Ctx, meta: AssemblyMeta, page: number, total: number) {
  ctx.fillStyle = '#666'; ctx.font = `16px ${FONT}`; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText(`${meta.title} · assembly instructions`, 48, PAGE_H - 44);
  ctx.textAlign = 'right'; ctx.fillText(`${page} / ${total}`, PAGE_W - 48, PAGE_H - 44);
}

/** Renders `scene` framed on `box` into a canvas of the given size and returns the camera used. */
function renderStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene, box: THREE.Box3, w: number, h: number, dir = ISO, margin = 0.3) {
  renderer.setSize(w, h);
  const camera = frameOrtho(box, dir, UP, w / h, margin);
  renderer.render(scene, camera);
  return camera;
}

/** Hardware callout: count, a rendered icon, and the size. */
function callout(ctx: Ctx, icon: HTMLCanvasElement | null, count: number, label: string, x: number, y: number) {
  const w = 350, h = 120;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.font = `bold 44px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${count}×`, x + 20, y + h / 2);
  if (icon) ctx.drawImage(icon, x + 100, y + 8, 104, 104);
  ctx.font = `bold 22px ${FONT}`; ctx.fillText(label, x + 208, y + h / 2);
}

export async function renderAssemblyPages(parts: LoadedPart[], plan: AssemblyPlan, meta: AssemblyMeta): Promise<AssemblyPage[]> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  const keep = new Set(parts.map(p => p.geometry));
  const pages: AssemblyPage[] = [];
  const total = plan.steps.length + 1;
  const snapshot = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(renderer.domElement, 0, 0); return c; };
  try {
    // Hardware icons, rendered once.
    const iconOf = (build: () => THREE.Object3D, dir: THREE.Vector3) => {
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
      scene.add(new THREE.HemisphereLight('#ffffff', '#9a9a9a', 1.7));
      const light = new THREE.DirectionalLight('#ffffff', 1.0); light.position.set(1.5, -2, 3); scene.add(light);
      const o = build(); scene.add(o); o.updateMatrixWorld(true);
      renderStage(renderer, scene, new THREE.Box3().setFromObject(o), 240, 240, dir, 0.25);
      const c = snapshot(240, 240); disposeScene(scene, keep); return c;
    };
    const screwIcon = iconOf(() => screwMesh(plan), new THREE.Vector3(1, -0.4, 0.35).normalize());
    const nutIcon = plan.hardware.hasNuts ? iconOf(() => nutMesh(plan), new THREE.Vector3(1, -1, 1.1).normalize()) : null;
    const screwLabel = `M${plan.hardware.thread} × ${plan.hardware.screwLength} mm`;
    const nutLabel = `M${plan.hardware.thread} nut`;

    // Page 1: what is in the box.
    {
      const canvas = document.createElement('canvas'); canvas.width = PAGE_W; canvas.height = PAGE_H;
      const ctx = canvas.getContext('2d')!; frame(ctx);
      ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold 44px ${FONT}`; ctx.fillText(meta.title, 60, 60);
      ctx.font = `22px ${FONT}`; ctx.fillStyle = '#444'; ctx.fillText(`Assembly instructions · ${plan.steps.length} steps · parts and hardware below`, 60, 118);
      const placements = plan.top.part === plan.base.part ? [plan.base] : [plan.top, plan.base];
      const cellW = 420, cellH = 330, x0 = 60, y0 = 180;
      const cells: { draw: (x: number, y: number) => void }[] = [];
      for (const p of placements) {
        const part = parts.find(l => l.name === p.part)!;
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
        scene.add(new THREE.HemisphereLight('#ffffff', '#9a9a9a', 1.7));
        const light = new THREE.DirectionalLight('#ffffff', 1.0); light.position.set(1.5, -2, 3); scene.add(light);
        const mesh = partMesh(part, 'drawing'); scene.add(mesh); mesh.updateMatrixWorld(true);
        renderStage(renderer, scene, part.box.clone(), cellW, 250, ISO, 0.2);
        const shot = snapshot(cellW, 250); disposeScene(scene, keep);
        const size = part.box.getSize(new THREE.Vector3());
        cells.push({ draw: (x, y) => {
          ctx.drawImage(shot, x, y);
          ctx.fillStyle = INK; ctx.font = `bold 30px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`${p.letter}  ×1`, x, y + 258);
          ctx.font = `20px ${FONT}`; ctx.fillStyle = '#444'; wrap(ctx, `${p.part.replace(/_/g, ' ')} · ${size.x.toFixed(0)} × ${size.y.toFixed(0)} × ${size.z.toFixed(1)} mm`, x, y + 296, cellW, 24);
        } });
      }
      if (plan.object) {
        const [w, h, t] = plan.object.size;
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
        scene.add(new THREE.HemisphereLight('#ffffff', '#9a9a9a', 1.7));
        const slab = lineArt(new THREE.BoxGeometry(w, h, t), '#d9d9d9', 25); slab.position.set(w / 2, h / 2, t / 2); scene.add(slab); slab.updateMatrixWorld(true);
        // Draw the mounting holes on the slab so it reads as the board.
        const holes = new THREE.Group();
        for (const s of plan.screws) { const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(plan.hardware.thread / 2 + 0.4, 24), 1), new THREE.LineBasicMaterial({ color: INK })); ring.position.set(s.x, s.y, t + 0.05); holes.add(ring); }
        scene.add(holes); holes.updateMatrixWorld(true);
        renderStage(renderer, scene, new THREE.Box3().setFromObject(slab), cellW, 250, ISO, 0.2);
        const shot = snapshot(cellW, 250); disposeScene(scene, keep);
        const o = plan.object;
        cells.push({ draw: (x, y) => {
          ctx.drawImage(shot, x, y);
          ctx.fillStyle = INK; ctx.font = `bold 30px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`${o.letter}  ×1`, x, y + 258);
          ctx.font = `20px ${FONT}`; ctx.fillStyle = '#444'; wrap(ctx, `${o.name} (yours, not printed)`, x, y + 296, cellW, 24);
        } });
      }
      cells.forEach((c, i) => c.draw(x0 + (i % 2) * (cellW + 40), y0 + Math.floor(i / 2) * cellH));
      let hy = y0 + Math.ceil(cells.length / 2) * cellH + 20;
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, hy - 10); ctx.lineTo(PAGE_W - 60, hy - 10); ctx.stroke();
      callout(ctx, screwIcon, plan.screws.length, screwLabel, 60, hy + 10);
      if (nutIcon) callout(ctx, nutIcon, plan.screws.length, nutLabel, 450, hy + 10);
      hy += 150;
      ctx.fillStyle = INK; ctx.font = `bold 24px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('You also need', 60, hy);
      ctx.font = `20px ${FONT}`; ctx.fillStyle = '#444';
      ctx.fillText(`A screwdriver for the M${plan.hardware.thread} screws.${plan.hardware.hasNuts ? ' Fingers hold the nuts; no spanner needed.' : ''}`, 60, hy + 36);
      ctx.fillText(`Screw length: at least ${plan.hardware.screwLength} mm. Longer is fine if it does not bottom out.`, 60, hy + 66);
      footer(ctx, meta, 1, total);
      pages.push({ key: 'parts', title: 'Parts', dataUrl: canvas.toDataURL('image/png') });
    }

    // One page per step.
    for (const step of plan.steps) {
      const built = buildScene(parts, plan, step);
      const box = new THREE.Box3().setFromObject(built.root);
      const camera = renderStage(renderer, built.scene, box, STAGE_W, STAGE_H, ISO, step.kind === 'flip' ? 0.6 : 0.3);
      const canvas = document.createElement('canvas'); canvas.width = PAGE_W; canvas.height = PAGE_H;
      const ctx = canvas.getContext('2d')!; frame(ctx);
      ctx.drawImage(renderer.domElement, 0, STAGE_Y);
      // Arrows from each exploded component to its seat.
      const world = (v: THREE.Vector3) => v.clone().applyMatrix4(built.root.matrixWorld);
      for (const item of built.items) {
        const from = px(world(item.from ?? item.anchor.clone().add(item.lift)), camera, STAGE_W, STAGE_H), to = px(world(item.anchor), camera, STAGE_W, STAGE_H);
        arrow(ctx, { x: from.x, y: from.y + STAGE_Y }, { x: to.x, y: to.y + STAGE_Y }, item.from ? 6 : 14);
      }
      if (step.kind === 'flip') {
        const c = px(world(box.getCenter(new THREE.Vector3())), camera, STAGE_W, STAGE_H);
        turnArrow(ctx, c.x, c.y + STAGE_Y - 40, 210);
      }
      if (step.kind === 'tighten') {
        // Rotation arrows over each screw head.
        const seat = plan.height - plan.counterboreDepth + plan.hardware.headHeight;
        for (const s of plan.screws) {
          const p = px(world(new THREE.Vector3(s.x, s.y, seat)), camera, STAGE_W, STAGE_H);
          ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y + STAGE_Y, 26, Math.PI * 0.2, Math.PI * 1.6); ctx.stroke();
          const a = Math.PI * 1.6, tx = -Math.sin(a), ty = Math.cos(a), tip = { x: p.x + 26 * Math.cos(a), y: p.y + STAGE_Y + 26 * Math.sin(a) };
          ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(tip.x + tx * 14, tip.y + ty * 14); ctx.lineTo(tip.x - ty * 8, tip.y + tx * 8); ctx.lineTo(tip.x + ty * 8, tip.y - tx * 8); ctx.closePath(); ctx.fill();
        }
        // Done mark.
        ctx.strokeStyle = INK; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(PAGE_W - 170, 96); ctx.lineTo(PAGE_W - 135, 132); ctx.lineTo(PAGE_W - 72, 60); ctx.stroke();
      }
      stepBadge(ctx, step.n, 96, 96);
      if (step.kind === 'screws') callout(ctx, screwIcon, step.count, screwLabel, PAGE_W - 410, 44);
      if (step.kind === 'nuts') callout(ctx, nutIcon, step.count, nutLabel, PAGE_W - 410, 44);
      ctx.fillStyle = INK; ctx.font = `26px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      wrap(ctx, step.caption, 60, STAGE_Y + STAGE_H + 24, PAGE_W - 120, 36);
      footer(ctx, meta, step.n + 1, total);
      pages.push({ key: `step-${step.n}`, title: `Step ${step.n}`, dataUrl: canvas.toDataURL('image/png') });
      disposeScene(built.scene, keep);
    }
  } finally { renderer.dispose(); }
  return pages;
}
