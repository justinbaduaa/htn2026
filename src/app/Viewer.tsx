import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DimsFile } from '../shared/types';
import type { Listed } from '../shared/annotations';
import { annotationsFor, buildAnnotations, DIM_COLOR_DARK, layoutOffsets, loadParts, partMesh, placeLabel, type Label, type LoadedPart } from './scene';

type Scene = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; overlay: THREE.Group; labels: Label[] };
const HEIGHT = 520;

/** Camera distance that fits a sphere of `radius` in the narrower of the vertical and horizontal fields of view. */
function fitDistance(camera: THREE.PerspectiveCamera, radius: number) {
  const v = THREE.MathUtils.degToRad(camera.fov / 2);
  const h = Math.atan(Math.tan(v) * camera.aspect);
  return radius / Math.sin(Math.min(v, h)) * 1.05;
}

/**
 * Interactive view of every printed part, laid out side by side along X. Renders on demand only.
 * "Dimensions" draws the readings the model was given (holes, outline, openings, heights) and each
 * part's own size on the model, with HTML labels projected over the canvas, and frames what is drawn.
 * One part at a time keeps the labels readable; "all" annotates every part. Readings with no place on
 * the geometry are listed underneath so nothing is silently hidden.
 */
export function Viewer({ parts, dims }: { parts: { name: string; url: string }[]; dims: DimsFile | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [loaded, setLoaded] = useState<LoadedPart[]>([]);
  const [dimPart, setDimPart] = useState<string | null>(null);   // a part name, 'all', or null for off
  const [listed, setListed] = useState<Listed[]>([]);
  const key = parts.map(p => p.url).join('|');

  const render = () => {
    const s = sceneRef.current; if (!s) return;
    s.renderer.render(s.scene, s.camera);
    const layer = labelLayer.current; if (!layer) return;
    const w = s.renderer.domElement.clientWidth, h = s.renderer.domElement.clientHeight;
    for (const [i, label] of s.labels.entries()) {
      const el = layer.children[i] as HTMLElement | undefined; if (!el) continue;
      const p = placeLabel(label, s.camera, w, h);
      el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.angle}deg) translate(-50%, ${p.below ? '0' : '-100%'})`;
      el.style.display = p.visible ? 'block' : 'none';
    }
  };

  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, HEIGHT); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0a0a');
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / HEIGHT, 1, 4000);
    scene.add(new THREE.HemisphereLight('#ffffff', '#333333', 1.2));
    const dir = new THREE.DirectionalLight('#ffffff', 1.5); dir.position.set(1, -1, 2); scene.add(dir);
    const controls = new OrbitControls(camera, renderer.domElement);
    const overlay = new THREE.Group(); scene.add(overlay);
    sceneRef.current = { renderer, scene, camera, controls, overlay, labels: [] };
    controls.addEventListener('change', render);
    let cancelled = false;
    loadParts(parts).then(loadedParts => {
      if (cancelled) return;
      const offsets = layoutOffsets(loadedParts);
      const group = new THREE.Group(); scene.add(group);
      loadedParts.forEach((p, i) => { const m = partMesh(p, 'viewer'); m.position.x = offsets[i]!; group.add(m); });
      const box = new THREE.Box3().setFromObject(group); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      camera.up.set(0, 0, 1);
      // Fit the bounding sphere in the vertical field of view, seen from the front-right and well above so the top face reads.
      camera.position.copy(center).add(new THREE.Vector3(1, -1, 1.4).normalize().multiplyScalar(fitDistance(camera, size.length() / 2)));
      controls.target.copy(center); controls.update();
      setLoaded(loadedParts);
      render();
    });
    return () => { cancelled = true; controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); sceneRef.current = null; setLoaded([]); };
  }, [key]);

  // Dimension overlay: rebuilt when the parts load, the dims arrive, or the toggle flips.
  useEffect(() => {
    const s = sceneRef.current; if (!s) return;
    s.overlay.clear(); s.labels = [];
    const layer = labelLayer.current; if (layer) layer.replaceChildren();
    const offsets = layoutOffsets(loaded);
    const chosen = loaded.map((p, i) => ({ part: p, offset: offsets[i]! })).filter(x => dimPart === 'all' || x.part.name === dimPart);
    if (dims && chosen.length > 0) {
      const box = new THREE.Box3();
      for (const { part, offset } of chosen) {
        const set = annotationsFor(dims, part);
        const built = buildAnnotations(set, DIM_COLOR_DARK);
        built.group.position.x = offset;
        s.overlay.add(built.group);
        for (const l of built.labels) s.labels.push({ ...l, position: l.position.clone().add(new THREE.Vector3(offset, 0, 0)) });
        setListed(set.listed);   // the same readings for every part, so any part's list will do
        box.union(part.box.clone().translate(new THREE.Vector3(offset, 0, 0)));
      }
      // Frame the annotated parts plus room for their dimension lines, keeping the current viewing direction.
      box.expandByVector(new THREE.Vector3(22, 22, 8));
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const dir = s.camera.position.clone().sub(s.controls.target).normalize();
      s.camera.position.copy(center).add(dir.multiplyScalar(fitDistance(s.camera, size.length() / 2)));
      s.controls.target.copy(center); s.controls.update();
      if (layer) for (const l of s.labels) {
        const div = document.createElement('div');
        div.textContent = l.text;
        div.className = 'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded bg-black/75 px-1 text-[11px] leading-4';
        div.style.color = DIM_COLOR_DARK;
        layer.appendChild(div);
      }
    } else setListed([]);
    render();
  }, [loaded, dims, dimPart]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div ref={ref} className="w-full" />
        <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" />
        <div className="absolute right-2 top-2 flex items-center gap-1 text-xs">
          <span className="mr-1 text-neutral-400">Dimensions</span>
          {[...parts.map(p => ({ key: p.name, label: p.name.replace(/_/g, ' ') })), ...(parts.length > 1 ? [{ key: 'all', label: 'all' }] : [])].map(o => (
            <button key={o.key} type="button" onClick={() => setDimPart(v => v === o.key ? null : o.key)} disabled={!dims || loaded.length === 0}
              className={`px-2 py-1 disabled:opacity-40 ${dimPart === o.key ? 'bg-amber-400 text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>
              {o.label}
            </button>
          ))}
          {dimPart && <button type="button" onClick={() => setDimPart(null)} className="px-2 py-1 text-neutral-400 hover:text-white">off</button>}
        </div>
      </div>
      {dimPart && listed.length > 0 && (
        <p className="text-xs text-neutral-400">
          Not drawn (no place on the geometry): {listed.map(l => `${l.name} ${l.value_mm} mm${l.estimated ? ' (est.)' : ''}`).join('; ')}.
        </p>
      )}
    </div>
  );
}
