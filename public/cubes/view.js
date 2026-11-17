// Conta Cubos: Three.js stage. Orthographic camera, flat yellow cubes with bold black edges,
// slow azimuth spin (12 s per turn) and an elevation that breathes between 28° and 56° (9 s cycle).
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

THREE.ColorManagement.enabled = false; // keep the exact hex colours: shading only has to separate top from sides

export const CUBE_COLOR = 0xF4B80C;
export const BG_COLOR = 0xFFF6DF;
export const SPIN_MS = 45000, TILT_MS = 60000, EL_MIN = 36, EL_MAX = 46;
const FACES = [ // [normal, 4 corners] of a unit cube at the origin; bottoms are never visible
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], top: true },
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], d: [0, 1] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], d: [0, -1] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], d: [1, 0] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], d: [-1, 0] },
];

export class CubeStage {
  constructor(el, { spin = true } = {}) {
    this.el = el; this.spin = spin; this.t0 = performance.now(); this.anims = []; this.layers = []; this.size = { n: 5, m: 5, H: 3 };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(BG_COLOR, 1);
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.75));
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.3);
    this.scene.add(this.sun, this.sun.target);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.lineMats = [];
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize); this.ro.observe(el);
    this.running = false; this.fit = 1.15; this.override = null;
    this.resize();
  }

  /** Replace the diagram. grid[r][c] = column height. All layers are visible unless `layers` is given. */
  setGrid(grid, { layers = Infinity } = {}) {
    for (const g of this.layers) this.disposeGroup(g);
    this.layers = []; this.anims = []; this.root.clear(); this.lineMats = [];
    const n = grid.length, m = grid[0].length, H = Math.max(1, ...grid.flat());
    this.size = { n, m, H };
    const mat = new THREE.MeshLambertMaterial({ color: CUBE_COLOR, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    for (let k = 1; k <= H; k++) {
      const pos = [], nor = [], idx = [], seg = [];
      const has = (r, c) => r >= 0 && c >= 0 && r < n && c < m && grid[r][c] >= k;
      for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) {
        if (!has(r, c)) continue;
        for (const f of FACES) {
          if (!f.top && has(r + f.d[0], c + f.d[1])) continue; // hidden side between two cubes of the same layer
          const base = pos.length / 3;
          const pts = f.v.map(([x, y, z]) => [c + x, k - 1 + y, r + z]);
          for (const p of pts) { pos.push(...p); nor.push(...f.n); }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          for (let i = 0; i < 4; i++) seg.push(...pts[i], ...pts[(i + 1) % 4]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      const lg = new LineSegmentsGeometry(); lg.setPositions(seg);
      const lm = new LineMaterial({ color: 0x000000, linewidth: 2.5 }); this.lineMats.push(lm);
      const lines = new LineSegments2(lg, lm);
      const group = new THREE.Group(); group.add(mesh, lines);
      group.visible = k <= layers; group.userData.k = k;
      this.root.add(group); this.layers.push(group);
    }
    this.root.position.set(-m / 2, -H / 2, -n / 2); // the vertical axis through the middle of the grid is the origin
    this.resize();
    this.render();
  }
  disposeGroup(g) { g.traverse((o) => { o.geometry?.dispose?.(); if (o.material && o.material.dispose && o.material.type !== 'MeshLambertMaterial') o.material.dispose(); }); }

  /** Show layers 1..k. With `animate`, the newest layer drops in. */
  showLayers(k, animate = false) {
    for (const g of this.layers) {
      const on = g.userData.k <= k;
      if (on && !g.visible && animate) { g.visible = true; g.position.y = 4; this.anims.push({ g, from: performance.now(), ms: 420 }); } else if (!on) { g.visible = false; g.position.y = 0; }
      else g.visible = on;
    }
  }

  angles(now = performance.now()) {
    if (this.override) return this.override;
    const t = now - this.t0;
    const az = this.spin ? ((t / SPIN_MS) * 360) % 360 : 35;
    const el = EL_MIN + ((EL_MAX - EL_MIN) / 2) * (1 + Math.sin(((t / TILT_MS) * 2 * Math.PI) - Math.PI / 2));
    return { az, el };
  }
  resize() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    for (const m of this.lineMats) { m.resolution.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio()); m.linewidth = Math.max(1.6, Math.min(4.5, h / 220)) * this.renderer.getPixelRatio(); }
    this.aspect = w / h;
    if (!this.running) this.render();
  }
  render(now = performance.now()) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i], p = Math.min(1, (now - a.from) / a.ms), e = 1 - (1 - p) ** 3;
      a.g.position.y = 4 * (1 - e);
      if (p >= 1) this.anims.splice(i, 1);
    }
    const { az, el } = this.angles(now);
    const A = (az * Math.PI) / 180, E = (el * Math.PI) / 180, d = 80;
    const dir = new THREE.Vector3(Math.cos(E) * Math.sin(A), Math.sin(E), Math.cos(E) * Math.cos(A));
    this.camera.position.copy(dir).multiplyScalar(d);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(0, 0, 0);
    const { n, m, H } = this.size;
    const R = 0.5 * Math.sqrt(n * n + m * m + H * H) * this.fit;
    const hh = this.aspect >= 1 ? R : R / this.aspect;
    this.camera.left = -hh * this.aspect; this.camera.right = hh * this.aspect; this.camera.top = hh; this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
    // light follows the camera so only a little shade separates tops from sides, whatever the angle
    const LA = A - 0.6, LE = (64 * Math.PI) / 180;
    this.sun.position.set(Math.cos(LE) * Math.sin(LA) * 50, Math.sin(LE) * 50, Math.cos(LE) * Math.cos(LA) * 50);
    this.renderer.render(this.scene, this.camera);
  }
  start() {
    if (this.running) return; this.running = true;
    const loop = (now) => { if (!this.running) return; this.render(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  dispose() { this.stop(); this.ro.disconnect(); for (const g of this.layers) this.disposeGroup(g); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
