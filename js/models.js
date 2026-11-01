// Реалістичні 3D-моделі машин (glTF), оброблені: колеса окремо, фарба перефарбовується.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/jsm/GLTFLoader.js";

export const MODEL_FILE = { city: "m5", sport: "m4", muscle: "mc570", gt: "f812", hyper: "f488" };
const loader = new GLTFLoader(), tpl = {}, pend = {};

function prepare(g) {
  const meta = g.scene.userData.car || {};
  let hasTail = false;
  g.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.name === "tail") hasTail = true; if (m.name === "glass") { m.depthWrite = false; m.transparent = true; } } } });
  return { scene: g.scene, meta, hasTail };
}
// лобове/бокове скло в салоні: прозоре, без "мутного" затемнення
function clearGlass(m) { m.alphaTest = 0; m.transparent = true; m.opacity = .08; m.depthWrite = false; m.transmission = 0; m.roughness = .02; if (m.color) m.color.setRGB(.02, .03, .04); if ("clearcoat" in m) m.clearcoat = 0; m.name = "glass_i"; m.needsUpdate = true; }
// обрізання зайвого вгорі салону (стеля/шматки стійок), де модель з джерела «битa»
const TRIM = {};
function trimY(scene, cut) {
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry.index) return;
    for (let p = o; p; p = p.parent) if (p.name === "steer") return;
    const pos = o.geometry.attributes.position, ix = o.geometry.index.array, keep = [];
    for (let t = 0; t < ix.length; t += 3) { const y = (pos.getY(ix[t]) + pos.getY(ix[t + 1]) + pos.getY(ix[t + 2])) / 3; if (y <= cut) keep.push(ix[t], ix[t + 1], ix[t + 2]); }
    o.geometry.setIndex(keep);
  });
}
export function hasCar(id) { return !!tpl[id]; }
export function ensureCar(id) {
  if (tpl[id]) return Promise.resolve(true);
  if (!MODEL_FILE[id]) return Promise.resolve(false);
  return pend[id] || (pend[id] = new Promise(res => {
    const intP = new Promise(r => loader.load("models/" + MODEL_FILE[id] + (id === "city" ? "_i5" : "_i3") + ".glb", g => { g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = true; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (/glass|glas|window|wind/i.test(m.name)) clearGlass(m); } }); if (TRIM[id]) trimY(g.scene, TRIM[id]); r(g.scene); }, undefined, () => r(null)));
    loader.load("models/" + MODEL_FILE[id] + ".glb", g => { intP.then(is => { try { tpl[id] = prepare(g); tpl[id].int = is; res(true); } catch (e) { console.warn(e); res(false); } }); }, undefined, e => { console.warn("model", id, e); pend[id] = null; res(false); });
  }));
}

export function buildGLB(spec, color, envI, shadow = true) {
  const t = tpl[spec.id], meta = t.meta, L = meta.length, Wd = meta.width, H = meta.height;
  const root = new THREE.Group(); root.rotation.order = "YZX";
  const tilt = new THREE.Group(); tilt.rotation.order = "ZXY"; root.add(tilt);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .45, roughness: .28, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: envI });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: .7, roughness: .4 });
  const fix = (o, shadow) => o.traverse(c => {
    if (!c.isMesh) return;
    const swap = m => { if (m.name === "paint") return paint; if (m.name === "tail") return tail; m.envMapIntensity = envI; return m; };
    c.material = Array.isArray(c.material) ? c.material.map(swap) : swap(c.material);
    c.castShadow = shadow && !(c.material.transparent); c.receiveShadow = false;
    if (c.material.name === "glass" || c.material.name === "glass_i") c.renderOrder = 2;
  });
  let steerObj = null, steerAx = null;
  const body = t.scene.getObjectByName("body").clone(true); fix(body, shadow); tilt.add(body);
  if (shadow && t.int) { const nb = t.int.getObjectByName("body"); if (nb) { const ic = nb.clone(true); fix(ic, false); tilt.add(ic); const sn = t.int.getObjectByName("steer"), sm = t.int.userData.car && t.int.userData.car.steer; if (sn && sm) { steerObj = sn.clone(true); fix(steerObj, false); tilt.add(steerObj); steerAx = new THREE.Vector3(sm.nx, sm.ny, 0).normalize(); } const cl = new THREE.PointLight(0xfff0e0, 14, 5, 2); cl.position.set(-.1, H * .78, 0); tilt.add(cl); } }
  const wheels = []; let rs = 0;
  for (const q of ["fl", "fr", "rl", "rr"]) {
    const n = t.scene.getObjectByName("wheel_" + q), w = meta.wheels && meta.wheels[q]; if (!n || !w) continue;
    const pivot = new THREE.Group(); pivot.position.copy(n.position);
    const spin = new THREE.Group(), c = n.clone(true); c.position.set(0, 0, 0); fix(c, shadow); spin.add(c); pivot.add(spin); tilt.add(pivot);
    wheels.push({ pivot, spin, front: q[0] === "f", r: w.r }); rs += w.r;
  }
  if (!t.hasTail) {
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(.05, .06, Wd * .26), tail); b.position.set(-L / 2 + .015, H * .5, s * Wd * .27); tilt.add(b); }
  }
  const fm = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), flames = [];
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(.12, 1.2, 8), fm); f.rotation.z = Math.PI / 2; f.position.set(-L / 2 - .6, .38, s * Wd * .27); tilt.add(f); flames.push(f); }
  return { root, tilt, body, steerObj, steerAx, paint, H, hasInt: !!(shadow && t.int), tail, wheels, flames, fm, L, W: Wd, wr: rs / Math.max(1, wheels.length) };
}
