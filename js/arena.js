/* Вільні локації для дрифту: велика парковка і нічне місто (плоский рельєф, колізії з перешкодами) */
import * as THREE from "../vendor/three.module.min.js";
import { THEMES, makeSky } from "./world.js";

export const ARENAS = [
  { id: "lot", name: "Велика парковка", sub: "Порожній майданчик, конуси, шини, контейнери", theme: "sunset", half: 350 },
  { id: "city", name: "Нічне місто", sub: "Квартали, перехрестя, неонові вікна", theme: "night", half: 262 },
  { id: "drag", name: "Драг-стріп", sub: "Чверть милі", theme: "sunset", half: 520, hidden: true }
];

const rnd = (a, b) => a + Math.random() * (b - a);
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function asphaltTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#44474d"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = 50 + Math.random() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * .6})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  }, true);
}

export function buildArena(kind, quality) {
  const A = ARENAS.find(a => a.id === kind) || ARENAS[0], th = THEMES[A.theme], half = A.half;
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  scene.fog = new THREE.Fog(th.hor, th.fogNear, th.fogFar); scene.background = new THREE.Color(th.hor);
  const sky = makeSky(th); scene.add(sky);
  const sun = new THREE.DirectionalLight(th.sunCol, th.sunI); sun.position.copy(new THREE.Vector3(...th.sunDir).normalize().multiplyScalar(300)); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGnd, th.hemiI); scene.add(hemi);
  if (quality.shadow) {
    sun.castShadow = true; sun.shadow.mapSize.set(quality.shadow, quality.shadow);
    const c = sun.shadow.camera; c.left = -52; c.right = 52; c.top = 52; c.bottom = -52; c.near = 10; c.far = 700; sun.shadow.bias = -.0004; sun.shadow.normalBias = .5;
  }
  const circles = [], rects = []; // [x,z,r,hard], [cx,cz,hx,hz]
  const shadow = !!quality.shadow;
  const mat = (c, r = .8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

  // земля за межами
  const gtex = asphaltTex();
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: new THREE.Color(th.ground[0] / 255, th.ground[1] / 255, th.ground[2] / 255), roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -.05; outer.receiveShadow = true; root.add(outer);
  gtex.repeat.set(half * 2 / 5, half * 2 / 5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshStandardMaterial({ map: gtex, color: kind === "lot" ? 0x6a6a6e : 0xffffff, roughness: .92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);

  const addBox = (cx, cz, w, h, d, m, hard = true, cast = true) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(cx, h / 2, cz); b.castShadow = shadow && cast; b.receiveShadow = true; root.add(b);
    if (hard) rects.push([cx, cz, w / 2, d / 2]); return b;
  };
  // периметр
  const wallM = mat(0x8c8f96, .9);
  addBox(0, -half - 1, half * 2 + 6, 3, 2, wallM, false); addBox(0, half + 1, half * 2 + 6, 3, 2, wallM, false);
  addBox(-half - 1, 0, 2, 3, half * 2 + 6, wallM, false); addBox(half + 1, 0, 2, 3, half * 2 + 6, wallM, false);

  const instanced = (geo, m, list, y = 0, rotX = 0) => {
    const im = new THREE.InstancedMesh(geo, m, Math.max(1, list.length)), d = new THREE.Object3D();
    list.forEach((p, i) => { d.position.set(p[0], y + (p[2] || 0), p[1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = shadow; im.frustumCulled = false; root.add(im); return im;
  };
  const cones = [], tires = [], poles = [];
  const coneRing = (cx, cz, r, n) => { for (let i = 0; i < n; i++) { const a = i / n * 6.2832; cones.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };

  if (kind === "lot") {
    // розмітка парковки
    const lines = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, w, h); g.strokeStyle = "#e8e8e8"; g.lineWidth = 5;
      for (let i = 0; i <= 20; i++) { g.beginPath(); g.moveTo(i * w / 20, 0); g.lineTo(i * w / 20, h * .42); g.moveTo(i * w / 20, h * .58); g.lineTo(i * w / 20, h); g.stroke(); }
      g.beginPath(); g.moveTo(0, h * .42); g.lineTo(w, h * .42); g.moveTo(0, h * .58); g.lineTo(w, h * .58); g.stroke();
    });
    lines.colorSpace = THREE.SRGBColorSpace;
    for (const [x, z, rot] of [[-210, -240, 0], [-210, 240, 0], [240, -230, 0]]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(220, 110), new THREE.MeshBasicMaterial({ map: lines, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true }));
      pl.rotation.x = -Math.PI / 2; pl.rotation.z = rot; pl.position.set(x, .02, z); root.add(pl);
    }
    // слалом, кільця, вісімка
    for (let i = 0; i < 14; i++) cones.push([-170 + i * 26, -140 + (i % 2 ? 7 : -7)]);
    coneRing(150, 110, 36, 22); coneRing(150, 110, 16, 12);
    coneRing(-120, 95, 28, 18); coneRing(-64, 95, 28, 18);
    coneRing(40, -190, 22, 14);
    // шини: стінки
    for (let i = 0; i < 16; i++) tires.push([210, -60 + i * 3.6]);
    for (let i = 0; i < 14; i++) tires.push([-30 + i * 3.6, 215]);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832; tires.push([-170 + Math.cos(a) * 14, -250 + Math.sin(a) * 14]); }
    // бетонні блоки
    const bm = mat(0x9a9c9f, .95);
    for (let i = 0; i < 10; i++) { const a = rnd(0, 6.28), r = rnd(70, 300); addBox(Math.cos(a) * r, Math.sin(a) * r, 3.2, 1.1, 1.2, bm); }
    // контейнери
    const cm = [mat(0xb43a2c, .7), mat(0x2f5fa8, .7), mat(0xd8a21c, .7), mat(0x3a8a55, .7)];
    for (let i = 0; i < 9; i++) { const x = -300 + (i % 3) * 14, z = -80 + Math.floor(i / 3) * 6.5; addBox(x, z, 12, 2.6, 2.4, cm[i % 4]); }
    for (let i = 0; i < 6; i++) { const x = 90 + (i % 3) * 13, z = 300 - Math.floor(i / 3) * 7; addBox(x, z, 12, 2.6, 2.4, cm[(i + 1) % 4]); }
    // ліхтарі
    for (let x = -300; x <= 300; x += 150) for (let z = -300; z <= 300; z += 150) if (Math.abs(x) + Math.abs(z) > 10) poles.push([x, z]);
    // далекі будівлі
    const bg = mat(0x6d727c, .95);
    for (let i = 0; i < 36; i++) { const a = i / 36 * 6.2832, r = half + rnd(40, 160), h = rnd(18, 60); const b = new THREE.Mesh(new THREE.BoxGeometry(rnd(30, 60), h, rnd(30, 60)), bg); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); root.add(b); }
  } else if (kind === "drag") {
    floor.visible = false;
    const SL = 640, SW = 17, strip = canvasTex(1024, 64, (g, w, h) => {
      g.fillStyle = "#3a3d43"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 45 + Math.random() * 45 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * .5})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
      g.fillStyle = "#e8e8e8"; g.fillRect(0, 2, w, 3); g.fillRect(0, h - 5, w, 3);
      g.fillStyle = "#d8d27a"; for (let x = 0; x < w; x += 40) g.fillRect(x, h / 2 - 1.5, 22, 3);
    });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(SL, SW), new THREE.MeshStandardMaterial({ map: strip, roughness: .9 }));
    sm.rotation.x = -Math.PI / 2; sm.position.set(250, .02, 0); sm.receiveShadow = true; root.add(sm);
    // стартова лінія і фініш (402 м від старту x=-2.5)
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(.7, SW - 1), new THREE.MeshBasicMaterial({ color: 0xffffff })); sl.rotation.x = -Math.PI / 2; sl.position.set(0, .04, 0); root.add(sl);
    const chk = canvasTex(64, 256, (g, w, h) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) & 1 ? "#fff" : "#111"; g.fillRect(x * 16, y * 16, 16, 16); } });
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, SW - 1), new THREE.MeshBasicMaterial({ map: chk })); fl.rotation.x = -Math.PI / 2; fl.rotation.z = Math.PI / 2; fl.position.set(402, .04, 0); root.add(fl);
    // відбійники
    const jm = mat(0x9a9c9f, .95);
    for (const sz of [-1, 1]) addBox(250, sz * (SW / 2 + .4), SL, 1.0, .7, jm);
    addBox(-72, 0, 1, 1.4, SW, jm); addBox(572, 0, 1, 1.4, SW, jm);
    // арка фінішу і табло
    const pm2 = mat(0xcfd2d8, .5, .4);
    for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(.6, 8, .6), pm2); m.position.set(402, 4, sz * (SW / 2 + 1.2)); root.add(m); }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, SW + 3), mat(0xd0262b, .5)); arch.position.set(402, 8.2, 0); root.add(arch);
    // трибуни з одного боку, ліхтарі з обох
    const st = mat(0x555a66, .9), cr = [mat(0xd04a3a), mat(0x3a6fd0), mat(0xe8c14a), mat(0x4aa86a)];
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(34, 3 + i % 2, 10), st); b.position.set(60 + i * 62, 2, 20); b.castShadow = shadow; root.add(b); for (let k = 0; k < 14; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(.7, 1.3, .7), cr[(k + i) & 3]); f.position.set(60 + i * 62 - 15 + k * 2.2, 4.4 + i % 2, 20 - 2 + (k & 1)); root.add(f); } }
    for (let x = -40; x <= 520; x += 70) { poles.push([x, -SW / 2 - 4]); poles.push([x, SW / 2 + 4]); }
    for (let i = 0; i < 30; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(rnd(20, 40), rnd(14, 40), rnd(20, 40)), mat(0x6d727c, .95)); b.position.set(rnd(-120, 640), 0, (i & 1 ? 1 : -1) * rnd(90, 220)); b.position.y = b.geometry.parameters.height / 2; root.add(b); }
  } else {
    // місто: дороги і квартали
    const P = 106, N = 2;
    const roads = canvasTex(2048, 2048, (g, w, h) => {
      g.fillStyle = "#3b3e44"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40000; i++) { const v = 45 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * .5})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
      const s = w / (half * 2); g.strokeStyle = "#d8d27a"; g.lineWidth = 3; g.setLineDash([22, 22]);
      for (let k = -3; k <= 2; k++) { const v = (k + .5) * P; if (Math.abs(v) > half) continue; const c = (v + half) * s; for (const [x0, y0, x1, y1] of [[c, 0, c, h], [0, c, w, c]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } }
    });
    floor.material.map = roads; floor.material.map.repeat.set(1, 1); floor.material.needsUpdate = true;
    // вікна
    const wtex = [0, 1, 2, 3].map(v => {
      const t = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = ["#1b2130", "#232a3c", "#181c28", "#2a2230"][v]; g.fillRect(0, 0, w, h);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const lit = Math.random() < .42; g.fillStyle = lit ? ["#ffd98a", "#9fd4ff", "#fff2c4", "#ffb0d6"][(Math.random() * 4) | 0] : "#0c0f18"; g.fillRect(x * 32 + 6, y * 32 + 7, 20, 18); }
      }, true); return t;
    });
    const wmats = wtex.map(t => new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: .85, roughness: .8 }));
    const roofM = mat(0x2a2d35, .9), swk = mat(0x5b5f68, .95);
    const building = (cx, cz, w, d, h) => {
      const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) { const su = f < 2 ? d / 32 : f < 4 ? 1 : w / 32, sv = f < 4 && f >= 2 ? 1 : h / 32; for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); } }
      const q = ((cx * 7 + cz * 3 + w) | 0) & 3, wm = i => wmats[(i + q) & 3];
      const b = new THREE.Mesh(g, [wm(0), wm(1), roofM, roofM, wm(2), wm(3)]);
      b.position.set(cx, h / 2 + .25, cz); b.castShadow = shadow; b.receiveShadow = true; root.add(b);
    };
    for (let gx = -N; gx <= N; gx++) for (let gz = -N; gz <= N; gz++) {
      const cx = gx * P, cz = gz * P, bs = 80;
      const sw = new THREE.Mesh(new THREE.BoxGeometry(bs + 2, .25, bs + 2), swk); sw.position.set(cx, .125, cz); sw.receiveShadow = true; root.add(sw);
      rects.push([cx, cz, bs / 2 + 1, bs / 2 + 1]);
      const split = Math.random() < .5;
      if (split) { building(cx - 19, cz, 34, 70, rnd(18, 70)); building(cx + 19, cz, 34, 70, rnd(18, 70)); } else building(cx, cz, 70, 70, rnd(25, 85));
    }
    // ліхтарі на перехрестях
    for (let gx = -N; gx <= N + 1; gx++) for (let gz = -N; gz <= N + 1; gz++) for (const [sx, sz] of [[-1, -1], [1, 1]]) { const x = (gx - .5) * P + sx * 10.5, z = (gz - .5) * P + sz * 10.5; if (Math.abs(x) < half && Math.abs(z) < half) poles.push([x, z]); }
    // слалом у центрі
    coneRing(P / 2, P / 2, 7, 10);
    for (let i = 0; i < 12; i++) cones.push([-200 + i * 11, -P / 2 + (i % 2 ? 3 : -3)]);
    // периметр-будинки
    const pm = mat(0x1b1f2b, .95);
    for (let i = 0; i < 44; i++) { const a = i / 44 * 6.2832, r = half + rnd(30, 90), h = rnd(30, 90); const b = new THREE.Mesh(new THREE.BoxGeometry(rnd(30, 55), h, rnd(30, 55)), wmats[i & 3]); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); root.add(b); }
  }
  // конуси, шини, ліхтарі
  const coneM = mat(0xff6a1f, .6);
  if (cones.length) { cones.forEach(p => circles.push([p[0], p[1], .5, 0])); instanced(new THREE.ConeGeometry(.32, .8, 10).translate(0, .4, 0), coneM, cones); }
  if (tires.length) { tires.forEach(p => circles.push([p[0], p[1], .6, 1])); instanced(new THREE.CylinderGeometry(.55, .55, 1.1, 12).translate(0, .55, 0), mat(0x141416, .95), tires); }
  if (poles.length) {
    poles.forEach(p => circles.push([p[0], p[1], .4, 1]));
    instanced(new THREE.CylinderGeometry(.18, .26, 11, 8).translate(0, 5.5, 0), mat(0x55585f, .6, .5), poles);
    const glow = new THREE.MeshBasicMaterial({ color: kind === "city" ? 0xffe2a0 : 0xfff2d0 });
    instanced(new THREE.SphereGeometry(.7, 10, 8), glow, poles, 11.2);
  }
  const T = { free: true, M: 1, step: 6, halfW: 1e6, barrier: 1e9, x: new Float32Array(1), z: new Float32Array(1), h: new Float32Array(1), tx: new Float32Array([1]), tz: new Float32Array(1), nx: new Float32Array(1), nz: new Float32Array([1]), curv: new Float32Array(1), half };
  // зіткнення: 3 кола на машину
  const CR = 1.0, offs = [-1.55, 0, 1.55];
  T.collide = (c, fx, fz) => {
    let bump = 0;
    for (const o of offs) {
      for (let pass = 0; pass < 2; pass++) {
        const px = c.x + fx * o, pz = c.z + fz * o;
        let nx = 0, nz = 0, pen = 0, soft = false;
        for (const q of circles) {
          const dx = px - q[0], dz = pz - q[1]; if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
          const d = Math.hypot(dx, dz), R = CR + q[2];
          if (d < R && R - d > pen) { pen = R - d; nx = dx / (d || 1); nz = dz / (d || 1); soft = !q[3]; }
        }
        for (const q of rects) {
          const dx = px - q[0], dz = pz - q[1]; if (Math.abs(dx) > q[2] + 4 || Math.abs(dz) > q[3] + 4) continue;
          const cx = Math.max(-q[2], Math.min(q[2], dx)), cz = Math.max(-q[3], Math.min(q[3], dz));
          let ex = dx - cx, ez = dz - cz, d = Math.hypot(ex, ez);
          if (d < CR && d > 1e-4) { if (CR - d > pen) { pen = CR - d; nx = ex / d; nz = ez / d; soft = false; } }
          else if (d <= 1e-4) { const ox = q[2] - Math.abs(dx), oz = q[3] - Math.abs(dz); if (ox < oz) { nx = Math.sign(dx) || 1; nz = 0; pen = ox + CR; } else { nx = 0; nz = Math.sign(dz) || 1; pen = oz + CR; } soft = false; }
        }
        const lim = half - 1.6;
        if (Math.abs(px) > lim) { const s = Math.sign(px); const p2 = Math.abs(px) - lim; if (p2 > pen) { pen = p2; nx = -s; nz = 0; soft = false; } }
        if (Math.abs(pz) > lim) { const s = Math.sign(pz); const p2 = Math.abs(pz) - lim; if (p2 > pen) { pen = p2; nx = 0; nz = -s; soft = false; } }
        if (pen <= 0) break;
        c.x += nx * pen; c.z += nz * pen;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) {
          if (soft) { c.vx *= .985; c.vz *= .985; bump = Math.max(bump, Math.min(.12, -vn / 60)); }
          else { c.vx -= nx * vn * 1.45; c.vz -= nz * vn * 1.45; c.vx *= .86; c.vz *= .86; bump = Math.max(bump, Math.min(1, -vn / 22)); }
        }
      }
    }
    return bump;
  };
  const H = () => 0;
  return { scene, T, th, sun, hemi, sky, H, bbox: { minX: -half, maxX: half, minZ: -half, maxZ: half, cx: 0, cz: 0 }, root, arena: A };
}
