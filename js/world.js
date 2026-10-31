import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/jsm/BufferGeometryUtils.js";
import { buildCenterline, nearest, groundH, hills, smooth, lerp, clamp } from "./trackmath.js";

export const THEMES = {
  day: { top: 0x2c6cc0, hor: 0xcfe3f3, bot: 0x7d9a6e, sunDir: [.45, .72, .35], sunCol: 0xfff1d0, sunI: 2.8, hemiSky: 0xcfe6ff, hemiGnd: 0x4a6b3a, hemiI: .85, fogNear: 250, fogFar: 1500,
    ground: [76, 130, 62], gravel: [140, 136, 124], hill: 26, tree: "pine", treeCol: 0x2d6a37, mount: 0x58718a, env: 1, stars: 0, clouds: 1 },
  sunset: { top: 0x28345e, hor: 0xffa05e, bot: 0x5a3a2a, sunDir: [.85, .13, .3], sunCol: 0xffa868, sunI: 2.5, hemiSky: 0xffc9a0, hemiGnd: 0x6b4a30, hemiI: .7, fogNear: 220, fogFar: 1400,
    ground: [186, 144, 92], gravel: [150, 120, 90], hill: 34, tree: "rock", treeCol: 0x8a5e3e, mount: 0x7a4a3c, env: .9, stars: .2, clouds: 1 },
  snow: { top: 0x7e9bbc, hor: 0xe8eff6, bot: 0xb8c6d4, sunDir: [-.4, .45, .5], sunCol: 0xf2f6ff, sunI: 2.2, hemiSky: 0xe4eeff, hemiGnd: 0x9fb2c4, hemiI: 1, fogNear: 120, fogFar: 1000,
    ground: [236, 242, 248], gravel: [150, 155, 162], hill: 30, tree: "pine", treeCol: 0x37574f, mount: 0x95a8bc, env: 1, stars: 0, clouds: 1 },
  night: { top: 0x02040c, hor: 0x16213d, bot: 0x05080f, sunDir: [-.3, .6, -.5], sunCol: 0x93a8e0, sunI: .45, hemiSky: 0x4a5f92, hemiGnd: 0x161c2a, hemiI: .85, fogNear: 100, fogFar: 900,
    ground: [38, 58, 42], gravel: [70, 70, 74], hill: 20, tree: "pine", treeCol: 0x14301d, mount: 0x0d1424, env: .6, stars: 1, clouds: 0, lamps: true }
};

function canvasTex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

function roadTexture() {
  return canvasTex(512, 880, (g, w, h) => {
    g.fillStyle = "#3c3f45"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) { const v = 40 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * .5})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    // колії від коліс
    for (const cx of [.3, .7]) { const gr = g.createLinearGradient((cx - .09) * w, 0, (cx + .09) * w, 0); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(.5, "rgba(10,10,12,.28)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect((cx - .09) * w, 0, .18 * w, h); }
    g.strokeStyle = "rgba(15,15,18,.5)"; g.lineWidth = 1;
    for (let i = 0; i < 14; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rnd(-14, 14); y += rnd(8, 30); g.lineTo(x, y); } g.stroke(); }
    // розмітка
    g.fillStyle = "rgba(235,235,230,.92)";
    g.fillRect(w * .028, 0, w * .02, h); g.fillRect(w * .952, 0, w * .02, h);
    const per = h / 2; for (let k = 0; k < 2; k++) g.fillRect(w * .495, k * per, w * .012, per * .26);
  }, true);
}
function kerbTexture() {
  return canvasTex(64, 128, (g, w, h) => { g.fillStyle = "#e8e8e8"; g.fillRect(0, 0, w, h); g.fillStyle = "#cc2b2b"; g.fillRect(0, 0, w, h / 2); }, true);
}
function barrierTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = "#d9d9d9"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#c92a2a"; g.fillRect(w / 2, 0, w / 2, h);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, h - 10, w, 10);
    g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(0, 0, w, 6);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .08})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, true);
}
function groundTexture(base) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const k = (Math.random() - .5) * 34, r = 14 + Math.random() * 46; const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); const x = Math.random() * w, y = Math.random() * h;
      gr.addColorStop(0, `rgba(${clamp(base[0] + k, 0, 255)},${clamp(base[1] + k * 1.2, 0, 255)},${clamp(base[2] + k * .7, 0, 255)},.5)`); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.save(); g.translate(x, y); g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); g.restore(); }
    for (let i = 0; i < 16000; i++) {
      const k = (Math.random() - .5) * 26; g.fillStyle = `rgba(${clamp(base[0] + k, 0, 255)},${clamp(base[1] + k * 1.1, 0, 255)},${clamp(base[2] + k * .8, 0, 255)},.35)`;
      const sz = 1 + Math.random() * 2.5; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, sz, 0, 7); g.fill();
    }
    for (let i = 0; i < 1200; i++) { g.strokeStyle = `rgba(${clamp(base[0] + 25, 0, 255)},${clamp(base[1] + 30, 0, 255)},${clamp(base[2] + 12, 0, 255)},.35)`; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + rnd(-3, 3), y - rnd(3, 9)); g.stroke(); }
  }, true);
}
function glowTexture() {
  return canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,240,200,1)"); gr.addColorStop(.25, "rgba(255,220,150,.45)"); gr.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
}
function cloudTexture() {
  return canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) { const x = 50 + Math.random() * 156, y = 50 + Math.random() * 30, r = 18 + Math.random() * 28; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  });
}

export function makeSky(th) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(th.top) }, hor: { value: new THREE.Color(th.hor) }, bot: { value: new THREE.Color(th.bot) }, sun: { value: new THREE.Vector3(...th.sunDir).normalize() }, sunCol: { value: new THREE.Color(th.sunCol) }, stars: { value: th.stars } },
    vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z=gl_Position.w; }",
    fragmentShader: `varying vec3 vD; uniform vec3 top,hor,bot,sun,sunCol; uniform float stars;
      float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){ vec3 d=normalize(vD); float h=d.y;
        vec3 c = h>0. ? mix(hor,top,pow(h,.55)) : mix(hor,bot,pow(-h,.45));
        float sd=max(dot(d,normalize(sun)),0.);
        c += sunCol*(pow(sd,900.)*6. + pow(sd,40.)*.35 + pow(sd,6.)*.12);
        if(stars>0. && h>0.){ vec3 q=floor(d*220.); float s=step(.9965,hash(q)); c += vec3(s)*stars*smoothstep(.02,.3,h); }
        gl_FragColor=vec4(c,1.); }`
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat); m.renderOrder = -10; m.frustumCulled = false;
  return m;
}

/* Створює всю сцену траси */
export function buildWorld(def, quality) {
  const th = THEMES[def.theme], T = buildCenterline(def);
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  scene.fog = new THREE.Fog(th.hor, th.fogNear, th.fogFar);
  scene.background = new THREE.Color(th.hor);

  const sky = makeSky(th); scene.add(sky);
  const sunDir = new THREE.Vector3(...th.sunDir).normalize();
  const sun = new THREE.DirectionalLight(th.sunCol, th.sunI);
  sun.position.copy(sunDir).multiplyScalar(300); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGnd, th.hemiI); scene.add(hemi);
  if (quality.shadow) {
    sun.castShadow = true; sun.shadow.mapSize.set(quality.shadow, quality.shadow);
    const c = sun.shadow.camera; c.left = -52; c.right = 52; c.top = 52; c.bottom = -52; c.near = 10; c.far = 700;
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .5;
  }

  const tmp = {};
  const H = (x, z, hint = -1) => { nearest(T, x, z, hint, tmp); return groundH(T, x, z, tmp, th.hill); };

  /* --- рельєф --- */
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < T.M; i++) { minX = Math.min(minX, T.x[i]); maxX = Math.max(maxX, T.x[i]); minZ = Math.min(minZ, T.z[i]); maxZ = Math.max(maxZ, T.z[i]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = 330;
  const sx = (maxX - minX) + ext * 2, sz = (maxZ - minZ) + ext * 2, cell = quality.terrainCell;
  const nx = Math.ceil(sx / cell), nz = Math.ceil(sz / cell);
  const tg = new THREE.PlaneGeometry(sx, sz, nx, nz); tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position, cols = new Float32Array(pos.count * 3), uv = tg.attributes.uv;
  const gcol = th.ground, gv = th.gravel;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    nearest(T, x, z, -1, tmp);
    let y = groundH(T, x, z, tmp, th.hill);
    const dd = tmp.dist - T.halfW;
    if (dd < 2.5) y -= .22;
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, x / 14, z / 14);
    const n = .9 + .1 * Math.sin(x * .05) * Math.cos(z * .043) + .06 * Math.sin(x * .17 + z * .13) + .07 * Math.sin(x * .011 + 1.3) * Math.sin(z * .013) + .05 * Math.sin(x * .031 - z * .027);
    const g = smooth(T.halfW + 3, T.halfW + 8, tmp.dist); // гравій біля узбіччя
    const hv = clamp((y - tmp.h) / 40, -.3, .5);
    for (let k = 0; k < 3; k++) cols[i * 3 + k] = lerp(gv[k], gcol[k], g) / 255 * n * (1 + hv * .3) * (th.tree === "rock" ? 1 : 1);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const gtex = groundTexture([215, 215, 215]);
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: gtex, vertexColors: true, roughness: 1, metalness: 0 }));
  terrain.receiveShadow = true; root.add(terrain);

  /* --- смуга-стрічка вздовж траси --- */
  function ribbon(l0, l1, y0, mat, vscale, opts = {}) {
    const M = T.M, p = [], uvs = [], idx = [];
    for (let i = 0; i <= M; i++) {
      const k = i % M;
      for (const l of [l0, l1]) { p.push(T.x[k] + T.nx[k] * l, T.h[k] + y0, T.z[k] + T.nz[k] * l); }
      uvs.push(0, i * T.step / vscale, 1, i * T.step / vscale);
    }
    for (let i = 0; i < M; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // дорога має дивитись нормаллю вгору — якщо ні, міняємо порядок трикутників
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
  }
  const hw = T.halfW;
  const rt = roadTexture(); rt.repeat.set(1, 1); rt.anisotropy = 8;
  const road = ribbon(-hw, hw, .02, new THREE.MeshStandardMaterial({ map: rt, roughness: th.lamps ? .55 : th.ground[0] > 200 ? .75 : .88, metalness: 0, envMapIntensity: th.lamps ? 1.6 : 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 24);
  root.add(road);
  const kt = kerbTexture(); kt.repeat.set(1, 1);
  const kmat = new THREE.MeshStandardMaterial({ map: kt, roughness: .7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  root.add(ribbon(hw, hw + 1.1, .035, kmat, 2), ribbon(-hw - 1.1, -hw, .035, kmat, 2));

  /* --- відбійники --- */
  const bt = barrierTexture(); bt.repeat.set(1, 1);
  const bmat = new THREE.MeshStandardMaterial({ map: bt, roughness: .75, side: THREE.DoubleSide });
  function wall(lat) {
    const M = T.M, p = [], uvs = [], idx = [];
    for (let i = 0; i <= M; i++) {
      const k = i % M, x = T.x[k] + T.nx[k] * lat, z = T.z[k] + T.nz[k] * lat;
      const y = H(x, z, k);
      p.push(x, y - .2, z, x, y + .95, z); uvs.push(i * T.step / 4, 0, i * T.step / 4, 1);
    }
    for (let i = 0; i < M; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, bmat); m.castShadow = !!quality.shadow; m.receiveShadow = true; return m;
  }
  const bl = hw + 5.5;
  root.add(wall(bl), wall(-bl));
  T.barrier = bl - .3;

  /* --- стартова лінія і арка --- */
  const k0 = 0, sx0 = T.x[k0], sz0 = T.z[k0], sy0 = T.h[k0], ang = Math.atan2(T.tz[k0], T.tx[k0]);
  const chk = canvasTex(64, 256, (g, w, h) => { const q = 16; for (let y = 0; y < h / q; y++) for (let x = 0; x < w / q; x++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x * q, y * q, q, q); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(3, def.w), new THREE.MeshStandardMaterial({ map: chk, roughness: .8, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
  line.rotation.x = -Math.PI / 2;
  const lg = new THREE.Group(); lg.position.set(sx0, sy0 + .045, sz0); lg.rotation.y = -ang; lg.add(line);
  root.add(lg);
  const gantry = new THREE.Group(); gantry.position.set(sx0, sy0, sz0); gantry.rotation.y = -ang;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: .5, metalness: .6 });
  const beamLen = def.w + 8;
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), steel); p.position.set(0, 4, s * (beamLen / 2)); p.castShadow = !!quality.shadow; gantry.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, beamLen), steel); beam.position.set(0, 8, 0); beam.castShadow = !!quality.shadow; gantry.add(beam);
  const ban = canvasTex(512, 64, (g, w, h) => { g.fillStyle = "#c92a2a"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.font = "bold 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("СТАРТ · ФІНІШ", w / 2, h / 2 + 2); });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(def.w + 4, 1.4), new THREE.MeshBasicMaterial({ map: ban })); b.position.set(s * .65, 8, 0); b.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; gantry.add(b); }
  root.add(gantry);

  /* --- трибуни --- */
  const crowd = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = "#555a66"; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 16; g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, y0 + 13, w, 3);
      for (let x = 0; x < w; x += 8) { const l = 46 + Math.random() * 12; g.fillStyle = `hsl(${(Math.random() * 6 | 0) * 60 + 10},22%,${l}%)`; g.fillRect(x + 1, y0 + 4, 6, 9); }
    }
  }, true);
  crowd.anisotropy = 8;
  crowd.repeat.set(6, 1);
  for (const [k, side] of [[T.M - 14, 1], [10, -1], [Math.floor(T.M * .5), 1]]) {
    const st = new THREE.Group(); const L = 60;
    for (let r = 0; r < 4; r++) { const b = new THREE.Mesh(new THREE.BoxGeometry(L, 1.2, 3), new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 })); b.position.set(0, .6 + r * 1.2, r * 3); b.castShadow = !!quality.shadow; st.add(b); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 2, .3, 13), new THREE.MeshStandardMaterial({ color: 0xcfd3da, roughness: .6 })); roof.position.set(0, 7, 4.5); st.add(roof);
    for (const px of [-L / 2, L / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.4, 7, .4), steel); p.position.set(px, 3.5, 9); st.add(p); }
    const lat = side * (hw + 18);
    st.position.set(T.x[k] + T.nx[k] * lat, T.h[k] - .2, T.z[k] + T.nz[k] * lat);
    st.updateMatrixWorld();
    const rp = new THREE.Vector3(T.x[k], T.h[k], T.z[k]); st.lookAt(st.position.clone().multiplyScalar(2).sub(rp).setY(st.position.y));
    root.add(st);
  }

  /* --- дерева / скелі --- */
  const treeN = quality.trees, pine = th.tree === "pine";
  let tg1;
  if (pine) {
    const parts = [[3.1, 4.2, 0], [2.4, 3.8, 2.4], [1.7, 3.4, 4.6]].map(([r, hh, y]) => new THREE.ConeGeometry(r, hh, 8).translate(0, y + hh / 2, 0));
    tg1 = mergeGeometries(parts);
  } else tg1 = new THREE.DodecahedronGeometry(2.4, 1);
  const tmat = new THREE.MeshStandardMaterial({ color: th.treeCol, roughness: .95, flatShading: true });
  const inst = new THREE.InstancedMesh(tg1, tmat, treeN);
  const trunkG = new THREE.CylinderGeometry(.35, .5, 2.2, 5), trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), treeN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const bushN = Math.floor(treeN * .55), bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: th.treeCol, roughness: 1, flatShading: true }), bushN);
  let placed = 0, tries = 0;
  while (placed < treeN && tries < treeN * 30) {
    tries++;
    const x = cx + (Math.random() - .5) * (sx - 40), z = cz + (Math.random() - .5) * (sz - 40);
    nearest(T, x, z, -1, tmp);
    if (tmp.dist < hw + 14 + Math.random() * 20) continue;
    const y = groundH(T, x, z, tmp, th.hill), s = .8 + Math.random() * 1.2;
    e.set(pine ? 0 : Math.random() * 3, Math.random() * 6, pine ? 0 : Math.random() * 3); q.setFromEuler(e);
    sc.set(s, pine ? s * (.9 + Math.random() * .6) : s * .7, s);
    v3.set(x, y + (pine ? 1.4 * sc.y : .9 * s + 1.2), z); m4.compose(v3, q, sc); inst.setMatrixAt(placed, m4);
    const v = .72 + Math.random() * .5; col.setRGB(v * (.92 + Math.random() * .16), v, v * (.9 + Math.random() * .14)); inst.setColorAt(placed, col);
    if (pine) { v3.set(x, y + 1.1 * s, z); m4.compose(v3, new THREE.Quaternion(), sc.set(s, s, s)); trunk.setMatrixAt(placed, m4); }
    else { v3.set(x, y + .9 * s, z); m4.compose(v3, new THREE.Quaternion(), sc.set(s * .9, s * 1.6, s * .9)); trunk.setMatrixAt(placed, m4); }
    placed++;
  }
  inst.count = trunk.count = placed; inst.castShadow = !!quality.shadow && quality.treeShadow; inst.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
  root.add(inst, trunk);
  // кущі й камені ближче до траси
  let bp = 0; tries = 0;
  while (bp < bushN && tries < bushN * 40) {
    tries++;
    const k = (Math.random() * T.M) | 0, side = Math.random() < .5 ? -1 : 1, lat = side * (hw + 9 + Math.random() * 26);
    const x = T.x[k] + T.nx[k] * lat, z = T.z[k] + T.nz[k] * lat; nearest(T, x, z, k, tmp); if (tmp.dist < hw + 8) continue;
    const y = groundH(T, x, z, tmp, th.hill), s = .5 + Math.random() * 1.3;
    e.set(Math.random() * 3, Math.random() * 6, Math.random() * 3); q.setFromEuler(e); v3.set(x, y + s * .35, z); sc.set(s * 1.3, s * .7, s * 1.1); m4.compose(v3, q, sc); bush.setMatrixAt(bp, m4);
    const v = .65 + Math.random() * .55; col.setRGB(v, v * (.95 + Math.random() * .2), v * .9); bush.setColorAt(bp, col); bp++;
  }
  bush.count = bp; bush.instanceMatrix.needsUpdate = true; if (bush.instanceColor) bush.instanceColor.needsUpdate = true; root.add(bush);

  /* --- рекламні щити вздовж траси --- */
  {
    const names = ["TURBO", "NITRO", "DRIFT", "SPEED"], cols = ["#d92b2b", "#1f6fd1", "#f2b705", "#1ea85a"];
    names.forEach((nm, bi) => {
      const tex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = cols[bi]; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(255,255,255,.92)"; g.font = "italic 900 40px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(nm, w / 2, h / 2 + 2); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, h - 6, w, 6); });
      const lst = []; for (let k = bi * 9 + 5; k < T.M; k += 36) for (const sd of [-1, 1]) if (((k / 9) + (sd > 0 ? 1 : 0)) % 2 < 2) lst.push([k, sd]);
      const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, 1.7, 6.4), [0, 0, 0, 0, 0, 0].map((_, i) => i === 0 ? new THREE.MeshStandardMaterial({ map: tex, roughness: .6, emissive: th.lamps ? 0xffffff : 0x000000, emissiveMap: tex, emissiveIntensity: .5 }) : new THREE.MeshStandardMaterial({ color: 0x222222 })), lst.length);
      const qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      lst.forEach(([k, sd], n) => { const lat = sd * (bl + 1.6), x = T.x[k] + T.nx[k] * lat, z = T.z[k] + T.nz[k] * lat, y = H(x, z, k); qq.setFromAxisAngle(up, -Math.atan2(T.tz[k], T.tx[k]) + Math.PI / 2 + (sd > 0 ? Math.PI : 0)); m4.compose(v3.set(x, y + 1.15, z), qq, sc.set(1, 1, 1)); bm.setMatrixAt(n, m4); });
      bm.castShadow = false; root.add(bm);
    });
  }

  /* --- гори на горизонті --- */
  const mm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: false });
  const rad = Math.hypot(sx, sz) / 2 + 700, base = new THREE.Color(th.mount).lerp(new THREE.Color(th.hor), .35), peak = th.tree === "pine" && th.ground[0] > 200 ? new THREE.Color(0xf4f8ff) : new THREE.Color(0xe9eef5).lerp(new THREE.Color(th.hor), .25);
  const snowy = th.hill !== 20 && th.ground[0] > 200 || th.top === 0x2c6cc0;
  for (let i = 0; i < 34; i++) {
    const a = i / 34 * Math.PI * 2 + Math.random() * .2, r = rad + Math.random() * 600;
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, cs = new Float32Array(p.count * 3), ph = Math.random() * 10;
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const nz = 1 + .22 * Math.sin(x * 5 + ph) * Math.cos(z * 4.3 + ph) + .12 * Math.sin(x * 11 + z * 9 + ph) + (y > .3 ? .18 * Math.sin(x * 7 - z * 6) : 0);
      p.setXYZ(k, x * nz, y > 0 ? y * (1 + .25 * Math.abs(Math.sin(x * 6 + ph * 2))) : y, z * nz);
      const hh = clamp(y * 1.2, 0, 1), sn = snowy ? smooth(.52, .8, hh + .07 * Math.sin(x * 14 + z * 12)) : 0;
      const c = base.clone().multiplyScalar(.82 + hh * .3 + .1 * Math.sin(x * 9 + z * 7)).lerp(peak, sn);
      cs[k * 3] = c.r; cs[k * 3 + 1] = c.g; cs[k * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cs, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mm), w = 380 + Math.random() * 460, h = 170 + Math.random() * 300;
    m.scale.set(w, h, w); m.position.set(cx + Math.cos(a) * r, h * .22 - 40, cz + Math.sin(a) * r); m.rotation.y = Math.random() * 6; root.add(m);
  }

  /* --- хмари --- */
  if (th.clouds) {
    const ct = cloudTexture(), cm = new THREE.SpriteMaterial({ map: ct, fog: false, depthWrite: false, opacity: .9, color: th.sunCol });
    for (let i = 0; i < 22; i++) { const s = new THREE.Sprite(cm); const a = Math.random() * 6.28, r = 500 + Math.random() * 2200; s.position.set(cx + Math.cos(a) * r, 380 + Math.random() * 300, cz + Math.sin(a) * r); const w = 500 + Math.random() * 600; s.scale.set(w, w * .45, 1); root.add(s); }
  }

  /* --- ліхтарі вночі --- */
  const lampGlows = [];
  if (th.lamps) {
    const gt = glowTexture(), gm = new THREE.SpriteMaterial({ map: gt, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(.12, .16, 9, 6), steel, Math.ceil(T.M / 7) * 2);
    let n = 0;
    for (let i = 0; i < T.M; i += 7) for (const s of [-1, 1]) {
      const lat = s * (hw + 7.5), x = T.x[i] + T.nx[i] * lat, z = T.z[i] + T.nz[i] * lat, y = H(x, z, i);
      m4.makeTranslation(x, y + 4.5, z); pole.setMatrixAt(n++, m4);
      const sp = new THREE.Sprite(gm); sp.position.set(x - T.nx[i] * s * .5, y + 9.2, z - T.nz[i] * s * .5); sp.scale.set(12, 12, 1); root.add(sp);
    }
    pole.count = n; root.add(pole);
  }

  /* --- карта оточення для відблисків --- */
  return { scene, T, th, sun, hemi, sky, H, bbox: { minX, maxX, minZ, maxZ, cx, cz }, root };
}
