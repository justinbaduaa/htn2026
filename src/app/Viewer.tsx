import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Loads each STL URL as a mesh, laid out side by side along X. Renders on demand only (no animation loop). */
export function Viewer({ urls }: { urls: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = urls.join('|');
  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, 420); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0a0a');
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / 420, 1, 2000);
    scene.add(new THREE.HemisphereLight('#ffffff', '#333333', 1.2));
    const dir = new THREE.DirectionalLight('#ffffff', 1.5); dir.position.set(1, -1, 2); scene.add(dir);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const loader = new STLLoader();
    let offset = 0;
    const group = new THREE.Group(); scene.add(group);
    Promise.all(urls.map(u => loader.loadAsync(u))).then(geometries => {
      for (const g of geometries) {
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#d4d4d4', roughness: 0.7 }));
        mesh.position.x = offset - b.min.x; offset += b.max.x - b.min.x + 10;
        group.add(mesh);
      }
      const box = new THREE.Box3().setFromObject(group); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + size.length(), center.y - size.length(), center.z + size.length() * 0.8);
      controls.target.copy(center); controls.update(); render();
    });
    return () => { controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [key]);
  return <div ref={ref} className="w-full" />;
}
