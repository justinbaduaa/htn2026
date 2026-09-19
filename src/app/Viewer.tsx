import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CadGeometry } from '../shared/cadGeometry';
import { forViewer, type Annotation } from '../shared/annotations';
import { annotationsFor, buildAnnotations, layoutOffsets, loadParts, partMesh, project as projectPoint, readableFrom, labelVisible, VIEWS, type Label, type LoadedPart } from './scene';
import { createViewerControls } from './viewerControls';

type Entry = { label: Label; annotation: Annotation; group: THREE.Group };
type Scene = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  navigation: ReturnType<typeof createViewerControls>; overlay: THREE.Group;
  entries: Entry[]; solids: THREE.Object3D[]; bounds: THREE.Box3;
};
const HEIGHT = 520;
const DIM_COLOR = '#a83d39';

function disposeObject(root: THREE.Object3D) {
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
    }
  });
}

export function Viewer({ parts, geometry }: { parts: { name: string; url: string }[]; geometry: CadGeometry | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedPart[]>([]);
  const [dimPart, setDimPart] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [mode, setMode] = useState<'orbit' | 'pan'>('orbit');
  const key = parts.map(p => p.url).join('|');

  const render = () => {
    const s = sceneRef.current; if (!s) return;
    s.camera.updateMatrixWorld();
    const layer = labelLayer.current;
    const w = s.renderer.domElement.clientWidth, h = s.renderer.domElement.clientHeight;
    const direction = s.camera.position.clone().sub(s.navigation.controls.target).normalize();
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const [i, entry] of s.entries.entries()) {
      const el = layer?.children[i] as HTMLElement | undefined; if (!el) continue;
      const p = projectPoint(entry.label.position, s.camera, w, h);
      const width = el.offsetWidth, height = el.offsetHeight;
      const box = { x: p.x - width / 2, y: p.y - height - 4, w: width, h: height };
      const visible = p.visible && readableFrom(entry.annotation, direction)
        && (entry.annotation.id.startsWith('part_') || labelVisible(entry.label.position, s.camera, s.solids))
        && box.x >= 4 && box.y >= 4 && box.x + width <= w - 4 && box.y + height <= h - 4
        && !occupied.some(b => box.x < b.x + b.w + 8 && box.x + box.w + 8 > b.x && box.y < b.y + b.h + 5 && box.y + box.h + 5 > b.y);
      el.style.visibility = visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${box.x}px, ${box.y}px)`;
      entry.group.visible = visible;
      if (visible) occupied.push(box);
    }
    s.renderer.render(s.scene, s.camera);
  };

  const fit = (view?: typeof VIEWS[number]) => {
    const s = sceneRef.current; if (!s || s.bounds.isEmpty()) return;
    const { camera, navigation: { controls } } = s;
    const box = s.bounds.clone();
    if (s.entries.length) box.union(new THREE.Box3().setFromObject(s.overlay));
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const center = box.getCenter(new THREE.Vector3());
    const direction = view ? new THREE.Vector3(...view.dir).normalize() : camera.position.clone().sub(controls.target).normalize();
    if (view) camera.up.set(...view.up);
    const angle = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.position.copy(center).addScaledVector(direction, Math.min(radius / Math.sin(angle) * 1.15, controls.maxDistance));
    controls.target.copy(center); controls.update(); render();
  };

  useEffect(() => {
    const el = ref.current!;
    setError(null);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError('3D preview is unavailable in this browser. You can still download the model files below.'); return; }
    renderer.setSize(Math.max(el.clientWidth, 1), HEIGHT);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e7edf2');
    const camera = new THREE.PerspectiveCamera(40, Math.max(el.clientWidth, 1) / HEIGHT, 0.1, 10000);
    camera.up.set(0, 0, 1); camera.position.set(100, -100, 140);
    camera.lookAt(0, 0, 0);
    const navigation = createViewerControls(camera, renderer.domElement);
    scene.add(new THREE.HemisphereLight('#ffffff', '#697887', 2));
    const light = new THREE.DirectionalLight('#ffffff', 2); light.position.set(1, -1, 2); scene.add(light);
    const overlay = new THREE.Group(); scene.add(overlay);
    const state: Scene = { renderer, scene, camera, navigation, overlay, entries: [], solids: [], bounds: new THREE.Box3() };
    sceneRef.current = state;
    navigation.controls.addEventListener('change', render);
    const start = () => { el.classList.add('is-interacting'); };
    const end = () => { el.classList.remove('is-interacting'); };
    navigation.controls.addEventListener('start', start);
    navigation.controls.addEventListener('end', end);
    const doubleClick = () => fit();
    renderer.domElement.addEventListener('dblclick', doubleClick);
    let frame = 0;
    const update = () => {
      frame = requestAnimationFrame(update);
      if (el.clientWidth > 0 && el.getClientRects().length > 0) navigation.controls.update();
    };
    update(); render();
    const resize = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width <= 0) return; // A hidden editor must not collapse the camera frustum.
      camera.aspect = width / HEIGHT; camera.updateProjectionMatrix();
      renderer.setSize(width, HEIGHT); navigation.controls.handleResize(); render();
    });
    resize.observe(el);
    let cancelled = false;
    loadParts(parts).then(loadedParts => {
      if (cancelled) { loadedParts.forEach(p => p.geometry.dispose()); return; }
      const offsets = layoutOffsets(loadedParts);
      const group = new THREE.Group(); scene.add(group);
      loadedParts.forEach((p, i) => { const mesh = partMesh(p, 'viewer'); mesh.position.x = offsets[i]!; group.add(mesh); });
      state.bounds.setFromObject(group);
      state.solids = group.children;
      const radius = Math.max(state.bounds.getSize(new THREE.Vector3()).length() / 2, 1);
      navigation.controls.minDistance = radius * 0.15;
      navigation.controls.maxDistance = radius * 40;
      camera.near = radius / 1000; camera.far = radius * 100; camera.updateProjectionMatrix();
      setLoaded(loadedParts);
      fit(VIEWS.find(v => v.key === 'iso'));
    }).catch(e => { if (!cancelled) setError(`Could not load the preview: ${e.message}`); });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); resize.disconnect();
      renderer.domElement.removeEventListener('dblclick', doubleClick);
      navigation.dispose(); disposeObject(scene); renderer.dispose();
      el.removeChild(renderer.domElement); sceneRef.current = null; setLoaded([]);
    };
  }, [key]);

  useEffect(() => { sceneRef.current?.navigation.setMode(mode); }, [mode, key]);

  useEffect(() => {
    const s = sceneRef.current; if (!s) return;
    disposeObject(s.overlay); s.overlay.clear(); s.entries = [];
    const layer = labelLayer.current; layer?.replaceChildren();
    const offsets = layoutOffsets(loaded);
    const chosen = loaded.map((part, i) => ({ part, offset: offsets[i]! })).filter(x => dimPart === 'all' || x.part.name === dimPart);
    if (geometry) for (const { part, offset } of chosen) {
      const set = annotationsFor(geometry, part);
      for (const annotation of forViewer(set.drawn, details)) {
        const built = buildAnnotations({ drawn: [annotation] }, DIM_COLOR, !annotation.id.startsWith('part_'));
        built.group.position.x = offset; s.overlay.add(built.group);
        for (const label of built.labels) {
          if (!label.text) continue;   // an unlabelled circle in an identical-hole group still draws, it just has no text
          s.entries.push({ annotation, group: built.group, label: { ...label, position: label.position.clone().add(new THREE.Vector3(offset, 0, 0)) } });
          const div = document.createElement('div'); div.textContent = label.text;
          div.className = 'model-dimension-label'; layer?.appendChild(div);
        }
      }
    }
    // Annotation toggles never alter the user's camera or pan position.
    render();
  }, [loaded, geometry, dimPart, details]);

  return <div className="flex flex-col gap-2">
    <div className="cad-viewer">
      <div className="cad-toolbar" aria-label="Model navigation">
        <div className="cad-toolbar-group">
          <button type="button" aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')}>Orbit</button>
          <button type="button" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}>Pan</button>
          <button type="button" disabled={!loaded.length} onClick={() => fit()}>Fit</button>
          <button type="button" disabled={!loaded.length} onClick={() => fit(VIEWS.find(v => v.key === 'iso'))}>Reset view</button>
        </div>
        <div className="cad-toolbar-group">{VIEWS.filter(v => v.key !== 'iso' && !v.optional).map(view => <button key={view.key} type="button" disabled={!loaded.length} onClick={() => fit(view)}>{view.title}</button>)}</div>
      </div>
      <div className="cad-toolbar cad-dimension-toolbar" aria-label="Model dimensions">
        <span>Dimensions</span>
        {[...parts.map(p => ({ key: p.name, label: p.name.replace(/_/g, ' ') })), ...(parts.length > 1 ? [{ key: 'all', label: 'All parts' }] : [])].map(o => <button key={o.key} type="button" aria-pressed={dimPart === o.key} onClick={() => setDimPart(v => v === o.key ? null : o.key)} disabled={!geometry || !loaded.length}>{o.label}</button>)}
        {dimPart && <><button type="button" aria-pressed={details} onClick={() => setDetails(v => !v)}>All measurements</button><button type="button" onClick={() => setDimPart(null)}>Hide dimensions</button></>}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className={`cad-canvas mode-${mode}`}>
        <div ref={ref} className="cad-render-surface" />
        <div ref={labelLayer} className="cad-label-layer" />
      </div>
      <div className="cad-navigation-hint">Drag to {mode === 'pan' ? 'pan' : 'orbit'} · Shift-drag / middle / right-drag to pan · Scroll to zoom · Double-click to fit</div>
    </div>
    {dimPart && <p className="text-xs text-neutral-400">{details ? 'Hidden, overlapping, and edge-on labels are omitted. Measured feature details are in the engineering schedule.' : 'STEP dimensions in mm. Enable All measurements for measured features.'}</p>}
  </div>;
}
