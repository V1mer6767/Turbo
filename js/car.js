import * as THREE from "../vendor/three.module.min.js";
import { hasCar, buildGLB } from "./models.js";
import { nearest, clamp, lerp, angDiff } from "./trackmath.js";

export const CARS = [
  { id: "city", name: "Сіті", kind: "sedan", price: 0, vmax: 52, acc: 8.2, brake: 12, mu: 1.4, steer: 1, L: 4.99, W: 1.95, roof: 1.45, color: "#3b82f6", snd: 1.0, desc: "Надійний старт" },
  { id: "sport", name: "Спорт", kind: "coupe", price: 600, vmax: 62, acc: 10.5, brake: 13, mu: 1.55, steer: 1, L: 4.8, W: 1.9, roof: 1.39, color: "#ef4444", snd: 1.15, desc: "Швидкий і слухняний" },
  { id: "muscle", name: "Мускул", kind: "muscle", price: 1500, vmax: 70, acc: 12.5, brake: 13, mu: 1.42, steer: 1, L: 4.53, W: 1.95, roof: 1.2, color: "#f59e0b", snd: .72, desc: "Потужний, любить зноси" },
  { id: "gt", name: "ГТ", kind: "gt", price: 2400, vmax: 76, acc: 14, brake: 14, mu: 1.62, steer: 1, L: 4.66, W: 1.97, roof: 1.28, color: "#dc2626", snd: 1.05, desc: "V12, дальнобійний" },
  { id: "hyper", name: "Гіпер", kind: "hyper", price: 3800, vmax: 82, acc: 15.5, brake: 15, mu: 1.8, steer: 1.05, L: 4.57, W: 1.97, roof: 1.2, color: "#a855f7", snd: 1.3, desc: "Король траси" }
];
export const COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#22c55e", "#a855f7", "#f4f4f5", "#111827", "#14b8a6", "#ec4899"];
const WB = 2.7;

/* ---------------- 3D-модель ---------------- */
function extrude(pts, depth, bevel) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(depth - bevel * 2) / 2); return g;
}

export function createCarModel(spec, color, envI = 1, shadow = true) {
  if (hasCar(spec.id)) return buildGLB(spec, color, envI, shadow);
  const L = spec.L, Wd = spec.W, roof = spec.roof, k = spec.kind;
  const root = new THREE.Group(); root.rotation.order = "YZX";
  const tilt = new THREE.Group(); tilt.rotation.order = "ZXY"; root.add(tilt);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .6, roughness: .32, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: envI });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x172433, metalness: .85, roughness: .06, envMapIntensity: envI * 1.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .7, metalness: .2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: .7, roughness: .4 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 1.4, roughness: .3 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: .95 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: .95, roughness: .25, envMapIntensity: envI });

  const tailY = k === "hatch" ? .98 : k === "muscle" ? .95 : k === "hyper" ? .8 : .86;
  const belt = k === "hatch" ? 1.0 : k === "muscle" ? 1.0 : k === "hyper" ? .84 : .92;
  const hoodY = k === "hatch" ? .86 : k === "muscle" ? .98 : k === "hyper" ? .66 : .78;
  const noseY = k === "hatch" ? .62 : k === "hyper" ? .46 : .6;
  const body = [
    [-L / 2, .32], [-L / 2, tailY], [-L * .36, tailY + .04], [-L * .22, belt], [L * .18, belt], [L * .36, hoodY], [L / 2 - .12, noseY + .05], [L / 2, noseY], [L / 2, .34], [L / 2 - .25, .26], [-L / 2 + .3, .26]
  ];
  const bm = new THREE.Mesh(extrude(body, Wd, .09), paint); bm.castShadow = true; tilt.add(bm);

  // кабіна
  const cr0 = k === "hatch" ? -L * .4 : k === "coupe" ? -L * .24 : -L * .2, cr1 = k === "hatch" ? -L * .33 : -L * .1;
  const cf1 = k === "hatch" ? L * .1 : k === "hyper" ? L * .06 : L * .02, cf0 = k === "hatch" ? L * .2 : L * .17;
  const gh = [[cr0, belt], [cr1, roof], [cf1, roof], [cf0, belt]];
  const gm = new THREE.Mesh(extrude(gh, Wd * .84, .035), glass); gm.castShadow = true; tilt.add(gm);
  const pil = new THREE.Mesh(new THREE.BoxGeometry(.09, roof - belt, Wd * .85), paint); pil.position.set((cr1 + cf1) / 2 - .05, (roof + belt) / 2, 0); tilt.add(pil);
  const rf = [[cr1 - .02, roof - .02], [cr1 + .03, roof + .05], [cf1 - .02, roof + .05], [cf1 + .02, roof - .02]];
  const rfm = new THREE.Mesh(extrude(rf, Wd * .8, .03), paint); tilt.add(rfm);

  // вузли: капот-скуп, спойлер
  if (k === "muscle") { const sc = new THREE.Mesh(new THREE.BoxGeometry(.9, .14, .5), dark); sc.position.set(L * .27, hoodY + .1, 0); tilt.add(sc); }
  if (k === "coupe" || k === "hyper" || k === "muscle") {
    const big = k === "hyper";
    const wing = new THREE.Mesh(new THREE.BoxGeometry(big ? .6 : .4, .05, Wd * (big ? .95 : .8)), k === "muscle" ? paint : dark);
    wing.position.set(-L / 2 + (big ? .1 : .25), tailY + (big ? .62 : .26), 0); wing.castShadow = true; tilt.add(wing);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.08, big ? .5 : .24, .06), dark); p.position.set(-L / 2 + (big ? .1 : .3), tailY + (big ? .32 : .13), s * Wd * .3); tilt.add(p); }
  }
  if (k === "hyper") { const sp = new THREE.Mesh(new THREE.BoxGeometry(.5, .08, Wd * .95), dark); sp.position.set(L / 2 - .1, .3, 0); tilt.add(sp); }
  // смуги
  if (k === "muscle" || k === "coupe") {
    const st = new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: .4, metalness: .2 });
    for (const z of [-.14, .14]) { const s1 = new THREE.Mesh(new THREE.BoxGeometry(L * .38, .012, .12), st); s1.position.set(L * .28, hoodY + .035 + (k === "muscle" ? .0 : -.03), z); tilt.add(s1); }
  }
  // фари і задні ліхтарі
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(.12, .1, Wd * .17), head); hl.position.set(L / 2 - .02, noseY + .12, s * Wd * .33); tilt.add(hl);
  }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(.06, .1, Wd * .78), tail); tl.position.set(-L / 2 + .01, tailY - .1, 0); tilt.add(tl);
  // бампер/дифузор
  const bump = new THREE.Mesh(new THREE.BoxGeometry(.2, .16, Wd * .86), dark); bump.position.set(-L / 2 + .02, .36, 0); tilt.add(bump);

  // колеса
  const wr = k === "hatch" ? .31 : .34, wheels = [], flames = [];
  const tg = new THREE.CylinderGeometry(wr, wr, k === "hyper" ? .3 : .24, 22); tg.rotateX(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(wr * .66, wr * .66, (k === "hyper" ? .3 : .24) + .02, 12); rg.rotateX(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(wr * 1.2, .05, (k === "hyper" ? .3 : .24) + .035);
  const axles = [[L * .3, 1, 1], [L * .3, -1, 1], [-L * .3, 1, 0], [-L * .3, -1, 0]];
  for (const [ax, side, front] of axles) {
    const pivot = new THREE.Group(); pivot.position.set(ax, wr, side * (Wd / 2 - .13));
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tg, tyre); t.castShadow = true; const r = new THREE.Mesh(rg, rim);
    spin.add(t, r);
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(spoke, dark); s.rotation.z = i * Math.PI / 3; spin.add(s); }
    pivot.add(spin); tilt.add(pivot); wheels.push({ pivot, spin, front: !!front, r: wr });
  }
  // полум'я нітро
  const fm = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(.12, 1.2, 8), fm); f.rotation.z = Math.PI / 2; f.position.set(-L / 2 - .6, .38, s * Wd * .27); tilt.add(f); flames.push(f); }
  return { root, tilt, paint, tail, wheels, flames, fm, L, W: Wd, wr };
}
export function setCarColor(m, color) { m.paint.color.set(color); }

/* ---------------- фізика ---------------- */
export class Car {
  constructor(spec, opts = {}) {
    this.spec = spec; this.isPlayer = !!opts.player; this.name = opts.name || "Гонщик"; this.color = opts.color || spec.color;
    this.x = this.z = this.a = this.vx = this.vz = this.y = 0;
    this.steerS = 0; this.nitro = .3; this.boostT = 0; this.idx = 0; this.nr = { idx: 0, lat: 0, dist: 0, s: 0, h: 0 };
    this.lap = 0; this.lapStart = 0; this.bestLap = 0; this.finished = false; this.finishT = 0;
    this.skill = opts.skill || 1; this.lane = opts.lane || 0; this.lane0 = this.lane; this.stuck = 0; this.revT = 0;
    this.aLat = 0; this.aLong = 0; this.slip = 0; this.speed = 0; this.vf = 0; this.braking = false; this.off = false; this.bump = 0;
    this.pitch = 0; this.roll = 0; this.yawVis = 0; this.gear = 1; this.rpm = 0; this.surf = opts.surf || 1; this.progress = 0;
    this.skidPrev = null;
  }
  place(T, idx, lat, H) {
    const k = (idx + T.M) % T.M;
    this.x = T.x[k] + T.nx[k] * lat; this.z = T.z[k] + T.nz[k] * lat; this.a = Math.atan2(T.tz[k], T.tx[k]);
    this.vx = this.vz = 0; this.idx = k; this.y = H(this.x, this.z, k); this.steerS = 0; this.speed = 0; this.vf = 0;
  }
}

export function stepCar(c, inp, dt, T, H) {
  const s = c.spec;
  if (inp.hold) { c.vx = c.vz = 0; c.vf = 0; c.steerS = 0; inp = { steer: 0, gas: false, brake: false, drift: false, nitro: false }; }
  if (!T.free) { nearest(T, c.x, c.z, c.idx, c.nr); c.idx = c.nr.idx; }
  const lat = T.free ? 0 : c.nr.lat, off = T.free ? false : Math.abs(lat) > T.halfW + 1.2;
  c.off = off;
  let fx = Math.cos(c.a), fz = Math.sin(c.a);
  let vf = c.vx * fx + c.vz * fz;
  const vf0 = vf;
  const boost = c.boostT > 0, vmax = s.vmax * (off ? .62 : 1) * (boost ? 1.22 : 1);
  // кермо: плавно
  const rate = Math.abs(inp.steer) > Math.abs(c.steerS) ? 6.5 : 10;
  c.steerS += clamp(inp.steer - c.steerS, -rate * dt, rate * dt);
  const aMax = s.mu * 9.81 * (off ? .62 : 1) * c.surf;
  const drift = inp.drift && Math.abs(vf) > 9;
  const sp = Math.abs(vf);
  const geo = sp * Math.tan(.55 * s.steer) / WB, dyn = aMax * .97 / Math.max(sp, 5);
  let yaw = c.steerS * Math.min(geo, dyn) * (vf < -.5 ? -1 : 1);
  if (drift) yaw *= 1.4;
  c.a += yaw * dt;
  fx = Math.cos(c.a); fz = Math.sin(c.a);
  const rx = -fz, rz = fx;
  vf = c.vx * fx + c.vz * fz; let vr = c.vx * rx + c.vz * rz;
  const vr0 = vr;
  const k = (drift ? 1.3 : 8.5) * (off ? .55 : 1) * (c.surf < 1 ? .85 : 1);
  vr *= Math.exp(-k * dt);
  const keep = vf * vf + (vr0 * vr0 - vr * vr) * (drift ? .75 : .9);
  vf = Math.sign(vf || 1) * Math.sqrt(Math.max(0, keep));
  // двигун і гальма
  c.braking = false;
  if (inp.gas) { const r = clamp(vf / vmax, 0, 1.3); vf += s.acc * (boost ? 1.7 : 1) * (1 - Math.pow(Math.min(r, 1), 2.4)) * dt; }
  if (vf > vmax) vf -= (vf - vmax) * 2.2 * dt;
  if (inp.assist && !drift) { const vLim = Math.sqrt(aMax * 80 / clamp(Math.abs(c.steerS), .25, 1)); if (vf > vLim) vf -= ((vf - vLim) * 1.8 + 2) * dt; }
  if (inp.brake) {
    if (vf > .8) { vf = Math.max(0, vf - s.brake * dt); c.braking = true; }
    else vf = Math.max(vf - 4.2 * dt, -9);
  } else if (!inp.gas) vf -= vf * .16 * dt;
  vf -= (Math.abs(vf) * vf * .00032 + (off ? vf * 1.1 : 0) + vf * .015) * dt;
  if (drift) { vf -= vf * .2 * dt; if (inp.gas) vf += s.acc * .15 * dt; }
  if (inp.hand) { vf = Math.max(0, vf - 6 * dt); }
  c.vx = fx * vf + rx * vr; c.vz = fz * vf + rz * vr;
  c.x += c.vx * dt; c.z += c.vz * dt;
  // нітро
  if (inp.nitro && c.nitro > .02) { c.boostT = .12; c.nitro = Math.max(0, c.nitro - .26 * dt); } else c.boostT = Math.max(0, c.boostT - dt);
  c.nitro = Math.min(1, c.nitro + (.012 + (drift ? Math.abs(vr) * .006 : 0) + (c.slip > 6 ? .02 : 0)) * dt);
  // відбійник
  c.bump = 0;
  if (T.free) c.bump = T.collide(c, fx, fz);
  else nearest(T, c.x, c.z, c.idx, c.nr);
  const L2 = T.free ? 0 : c.nr.lat;
  if (!T.free && Math.abs(L2) > T.barrier) {
    const sg = Math.sign(L2), nx = T.nx[c.nr.idx] * sg, nz = T.nz[c.nr.idx] * sg, over = Math.abs(L2) - T.barrier;
    c.x -= nx * over; c.z -= nz * over;
    const vn = c.vx * nx + c.vz * nz;
    if (vn > 0) { c.vx -= nx * vn * 1.3; c.vz -= nz * vn * 1.3; c.bump = Math.min(1, vn / 25); c.vx *= .86; c.vz *= .86; }
    // розвертаємо ніс уздовж стінки, якщо вдарились лобом
    const tx = T.tx[c.nr.idx], tz = T.tz[c.nr.idx];
    const along = fx * tx + fz * tz;
    const want = Math.atan2(tz * Math.sign(along || 1), tx * Math.sign(along || 1));
    c.a += angDiff(c.a, want) * Math.min(1, dt * 2.5 * Math.min(1, vn / 6 + .2));
  }
  c.slip = Math.abs(vr);
  c.speed = Math.hypot(c.vx, c.vz); c.vf = vf;
  c.aLat = yaw * vf; c.aLong = (vf - vf0) / Math.max(dt, 1e-3);
  c.rpmSnd = rpmOf(c, vf);
  // висоти
  const hC = H(c.x, c.z, c.idx);
  const fxp = c.x + fx * 1.35, fzp = c.z + fz * 1.35, bxp = c.x - fx * 1.35, bzp = c.z - fz * 1.35;
  const hF = H(fxp, fzp, c.idx), hB = H(bxp, bzp, c.idx);
  const hR = H(c.x + rx * .9, c.z + rz * .9, c.idx), hL = H(c.x - rx * .9, c.z - rz * .9, c.idx);
  const tp = Math.atan2(hF - hB, 2.7), tr = Math.atan2(hL - hR, 1.8);
  c.y = lerp(c.y, hC, Math.min(1, dt * 18));
  c.pitch = lerp(c.pitch, tp + clamp(c.aLong * .0035, -.05, .045), Math.min(1, dt * 8));
  c.roll = lerp(c.roll, tr - clamp(c.aLat * .0055, -.07, .07), Math.min(1, dt * 8));
}

function rpmOf(c, vf) {
  const g = 6, v = clamp(Math.abs(vf) / (c.spec.vmax * 1.05), 0, 1) * g, gear = Math.min(g - 1, Math.floor(v));
  c.gear = gear + 1; return .28 + (v - gear) * .72;
}

export function syncModel(c, m, dt) {
  m.root.position.set(c.x, c.y, c.z); m.root.rotation.y = -c.a;
  m.tilt.rotation.z = c.pitch; m.tilt.rotation.x = c.roll;
  const spinA = c.vf * dt;
  for (const w of m.wheels) { w.spin.rotation.z -= spinA / w.r; if (w.front) w.pivot.rotation.y = -c.steerS * .42 * (1 - clamp(c.speed / 120, 0, .7)); }
  m.tail.emissiveIntensity = c.braking ? 3 : .7;
  if (m.glows) { const o = c.braking ? 1 : .32; for (const g of m.glows) { g.material.opacity = o; g.scale.set(c.braking ? 2.4 : 1.5, c.braking ? 1.7 : 1.1, 1); } }
  const f = c.boostT > 0 ? 1 : 0;
  m.fm.opacity = lerp(m.fm.opacity, f * .85, Math.min(1, dt * 14));
  for (const fl of m.flames) fl.scale.set(1 + Math.random() * .4, 1, 1);
}

/* ---------------- ШІ ---------------- */
export function aiInput(c, T, cars, dt, racing) {
  const M = T.M, sp = Math.max(0, c.vf);
  if (!racing) return { hold: true };
  // об'їзд машин попереду
  let avoid = 0;
  const fx = Math.cos(c.a), fz = Math.sin(c.a);
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dz = o.z - c.z, ahead = dx * fx + dz * fz, side = -dx * fz + dz * fx;
    if (ahead > 2 && ahead < 16 + sp * .25 && Math.abs(side) < 2.6 && o.speed < c.speed + 6) avoid = side > 0 ? -1 : 1;
  }
  const maxL = T.halfW - 2.2;
  c.laneT = (c.laneT === undefined ? Math.random() * 5 : c.laneT) - dt;   // кожен їде своєю лінією і час від часу міняє її
  if (c.laneT <= 0) { c.laneT = 4 + Math.random() * 7; c.lane0 = (Math.random() * 2 - 1) * maxL * .85; }
  const target = clamp(c.lane0 + avoid * 3.2, -maxL, maxL);
  c.lane += clamp(target - c.lane, -1.8 * dt, 1.8 * dt);
  const look = 3 + Math.floor(sp / 8), ti = (c.idx + look) % M;
  const tx = T.x[ti] + T.nx[ti] * c.lane, tz = T.z[ti] + T.nz[ti] * c.lane;
  const err = angDiff(c.a, Math.atan2(tz - c.z, tx - c.x));
  const Ld = Math.max(6, Math.hypot(tx - c.x, tz - c.z)), vv = Math.max(sp, 4);
  const per = Math.min(vv * Math.tan(.55 * c.spec.steer) / 2.7, c.spec.mu * 9.81 * .97 / Math.max(vv, 5));
  let steer = clamp((2 * Math.sin(err) / Ld * vv) / per, -1, 1);
  // швидкість з урахуванням майбутніх поворотів
  const aLat = c.spec.mu * 9.81 * .86 * c.skill, aB = c.spec.brake * .62;
  let vt = c.spec.vmax * c.skill, clear = true;
  for (let k = 0; k <= 34; k++) {
    const i = (c.idx + k) % M;
    const kap = Math.max(T.curv[i], T.curv[(i + 1) % M], T.curv[(i + M - 1) % M], 1e-4);
    const vc = Math.sqrt(aLat / kap), d = Math.max(0, k * T.step - 4);
    const allow = Math.sqrt(vc * vc + 2 * aB * d);
    if (allow < vt) vt = allow;
    if (vc < c.spec.vmax * .8) clear = false;
  }
  let gas = sp < vt, brake = sp > vt + 2.5;
  if (c.off) vt = Math.min(vt, 24);
  // застрягання
  if (c.speed < 2.5) c.stuck += dt; else c.stuck = Math.max(0, c.stuck - dt);
  if (c.stuck > 1.4) { c.revT = 1.1; c.stuck = 0; }
  if (c.revT > 0) { c.revT -= dt; return { steer: -steer, gas: false, brake: true }; }
  return { steer, gas, brake, drift: false, nitro: c.nitro > .6 && clear && sp < c.spec.vmax * .93 };
}

/* ---------------- зіткнення машин ---------------- */
export function collide(a, b) {
  let hit = 0;
  for (const oa of [-1.05, 1.05]) for (const ob of [-1.05, 1.05]) {
    const ax = a.x + Math.cos(a.a) * oa, az = a.z + Math.sin(a.a) * oa, bx = b.x + Math.cos(b.a) * ob, bz = b.z + Math.sin(b.a) * ob;
    let dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz); const R = 1.75;
    if (d < R && d > 1e-4) {
      dx /= d; dz /= d; const ov = (R - d) * .5;
      a.x -= dx * ov; a.z -= dz * ov; b.x += dx * ov; b.z += dz * ov;
      const rv = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
      if (rv < 0) { const j = -rv * .6; a.vx -= dx * j; a.vz -= dz * j; b.vx += dx * j; b.vz += dz * j; hit = Math.max(hit, Math.min(1, -rv / 15)); }
    }
  }
  return hit;
}
