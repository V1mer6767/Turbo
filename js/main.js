import * as THREE from "../vendor/three.module.min.js";
import { TRACK_DEFS, nearest, clamp, lerp, angDiff } from "./trackmath.js";
import { buildWorld, makeSky } from "./world.js";
import { buildArena, ARENAS } from "./arena.js";
import { CARS, COLORS, Car, createCarModel, setCarColor, stepCar, syncModel, aiInput, collide } from "./car.js";
import * as A from "./audio.js";
import { ensureCar, hasCar, MODEL_FILE } from "./models.js";

const BUILD = 24;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------------- збереження ---------------- */
const SK = "turbo_v1";
let S = { driftBest: 0, driftTotal: 0, coins: 0, owned: ["city"], car: "city", colors: {}, best: {}, bestLap: {}, sound: true, auto: true, quality: "mid", diff: 1, laps: 3, assist: true, last: 0, tilt: false, tiltInv: /iPhone|iPad|iPod/.test(navigator.userAgent) };
try { Object.assign(S, JSON.parse(localStorage.getItem(SK) || "{}")); } catch (e) {}
const save = () => { try { localStorage.setItem(SK, JSON.stringify(S)); } catch (e) {} };
const QUAL = {
  low: { pr: 1, shadow: 0, trees: 450, terrainCell: 10, treeShadow: false },
  mid: { pr: 1.15, shadow: 1024, trees: 1000, terrainCell: 8, treeShadow: false },
  high: { pr: 2, shadow: 2048, trees: 1700, terrainCell: 6, treeShadow: true }
};
const qual = () => QUAL[S.quality] || QUAL.mid;

/* ---------------- рендер ---------------- */
const canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, .3, 5200);
const pmrem = new THREE.PMREMGenerator(renderer);
let prScale = 1;
const coarse = matchMedia("(pointer:coarse)").matches;
function applySize() {
  const rot = innerHeight > innerWidth && coarse, bs = document.body.style;
  document.body.classList.toggle("rot", rot);
  const w = rot ? innerHeight : innerWidth, h = rot ? innerWidth : innerHeight;
  if (rot) { bs.width = w + "px"; bs.height = h + "px"; bs.transform = `translateX(${innerWidth}px) rotate(90deg)`; } else { bs.width = bs.height = bs.transform = ""; }
  const pr = Math.min(devicePixelRatio || 1, qual().pr) * prScale;
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (partMat) partMat.uniforms.uK.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}
addEventListener("resize", applySize); addEventListener("orientationchange", () => setTimeout(applySize, 120));
/* на телефоні: на весь екран і горизонтально; без виділення тексту */
let fsTried = false;
document.addEventListener("click", () => {
  if (fsTried || !coarse) return; fsTried = true;
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {})).catch(() => {});
});
for (const ev of ["selectstart", "contextmenu", "dragstart", "gesturestart", "copy", "cut"]) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", e => { if (!e.target.closest || !e.target.closest(".cards,.setList,.resList")) e.preventDefault(); }, { passive: false });

/* ---------------- стан ---------------- */
let W = null, T = null, scene = null, curTrack = -1, envRT = null;
let cars = [], player = null, state = "loading", raceT = 0, countT = 0, countShown = -1, laps = 3, finishTimer = 0, camMode = 0, demoT = 0;
let fpsHold = 0, fxS = -1, fxN = false, freeKind = null, prevModel = null, garageT = 0, bot = false, wrongT = 0, resultsData = null;
let skidMesh = null, skHead = 0, skCount = 0, skDirty = false, partPts = null, partMat = null;
const SKN = 2600, PN = 180;
const STEP = 1 / 90;
const track = () => TRACK_DEFS[curTrack];

/* ---------------- керування ---------------- */
const btn = { left: 0, right: 0, gas: 0, brake: 0, drift: 0, nitro: 0 }, keys = {};
const ctlEls = $$("#ctl [data-k]");
ctlEls.forEach(el => {
  const k = el.dataset.k;
  el.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") return; A.audioInit(); btn[k] = 1; el.classList.add("on"); try { el.setPointerCapture(e.pointerId); } catch (_) {} });
  const up = e => { if (e.pointerType !== "mouse") return; btn[k] = 0; el.classList.remove("on"); };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("contextmenu", e => e.preventDefault());
});
/* дотики: стан кнопок завжди перераховується зі списку всіх активних дотиків — не залипає і не губиться */
function touchCtl(e) {
  const ctl = $("#ctl"); if (ctl.hidden) return;
  const pad = 14, on = {};
  for (const t of e.touches) for (const el of ctlEls) {
    const r = el.getBoundingClientRect();
    if (t.clientX >= r.left - pad && t.clientX <= r.right + pad && t.clientY >= r.top - pad && t.clientY <= r.bottom + pad) on[el.dataset.k] = 1;
  }
  let any = false;
  for (const el of ctlEls) { const k = el.dataset.k, v = on[k] ? 1 : 0; if (btn[k] !== v) { btn[k] = v; el.classList.toggle("on", !!v); } if (v) any = true; }
  if (any) A.audioInit();
}
["touchstart", "touchmove", "touchend", "touchcancel"].forEach(n => addEventListener(n, touchCtl, { passive: true, capture: true }));
addEventListener("blur", () => { for (const el of ctlEls) { btn[el.dataset.k] = 0; el.classList.remove("on"); } });
addEventListener("keydown", e => {
  keys[e.code] = 1; A.audioInit();
  if (e.code === "Escape" || e.code === "KeyP") togglePause();
  if (e.code === "KeyC") cycleCam();
});
addEventListener("keyup", e => { keys[e.code] = 0; });
let tiltV = 0, tiltOn = false, tiltZero = null;
function enableTilt() {
  const go = () => { if (tiltOn) return; tiltOn = true; addEventListener("devicemotion", ev => {
    const a = ev.accelerationIncludingGravity; if (!a) return;
    const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    const sr = a.x * Math.cos(ang) - a.y * Math.sin(ang), su = a.x * Math.sin(ang) + a.y * Math.cos(ang);
    let phi = Math.atan2(sr, su); if (S.tiltInv) phi = -phi;
    tiltV = -phi;
  }); };
  if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) DeviceMotionEvent.requestPermission().then(r => { if (r === "granted") go(); }).catch(() => {});
  else go();
}
function playerInput() {
  const L = btn.left || keys.ArrowLeft || keys.KeyA, R = btn.right || keys.ArrowRight || keys.KeyD;
  let steer = (R ? 1 : 0) - (L ? 1 : 0);
  if (S.tilt && tiltOn) { const v = Math.abs(tiltV) < .05 ? 0 : tiltV; steer = clamp(v / .6, -1, 1); if (L || R) steer = (R ? 1 : 0) - (L ? 1 : 0); }
  const brake = !!(btn.brake || keys.ArrowDown || keys.KeyS);
  const gas = S.auto ? !brake : !!(btn.gas || keys.ArrowUp || keys.KeyW);
  return { steer, gas: gas || !!(keys.ArrowUp || keys.KeyW), brake, assist: S.assist, drift: !!(btn.drift || keys.Space), nitro: !!(btn.nitro || keys.ShiftLeft || keys.ShiftRight) };
}

/* ---------------- екрани ---------------- */
const SCREENS = ["sLoad", "sMain", "sTracks", "sFree", "sGarage", "sSet", "sPause", "sRes"];
function show(id) { SCREENS.forEach(s => $("#" + s).hidden = s !== id); }
function hideAll() { SCREENS.forEach(s => $("#" + s).hidden = true); }
$$("[data-back]").forEach(b => b.addEventListener("click", () => toMenu(b.dataset.back)));
const fmtT = ms => { if (!isFinite(ms) || ms <= 0) return "—"; const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2); };
function updCoins() { $("#mCoins").textContent = S.coins; $$(".cN").forEach(e => e.textContent = S.coins); }
function banner(t, ms = 1800) { const b = $("#banner"); b.textContent = t; b.hidden = false; clearTimeout(banner.t); banner.t = setTimeout(() => (b.hidden = true), ms); }

async function toMenu(id = "sMain") {
  if (freeKind && id !== "sFree") { await leaveFree(); }
  if (state === "garage" && id !== "sGarage") leaveGarage();
  if (id === "sMain" && (state !== "menu")) enterMenu();
  show(id); updCoins();
  if (id === "sTracks") buildTrackList();
  if (id === "sFree") buildFreeList();
  if (id === "sSet") buildSettings();
}
function enterMenu() {
  $("#hud").hidden = true; $("#ctl").hidden = true; $("#count").hidden = true;
  spawn("demo"); state = "menu";
}
$("#mPlay").onclick = () => { A.audioInit(); toMenu("sTracks"); };
$("#mFree").onclick = () => { A.audioInit(); toMenu("sFree"); };
$("#mGarage").onclick = () => { A.audioInit(); enterGarage(); };
$("#mSet").onclick = () => toMenu("sSet");

function buildTrackList() {
  const el = $("#trackList"); el.innerHTML = "";
  const grads = { day: "linear-gradient(180deg,#5aa0e0,#cfe3f3 55%,#4f8a45 56%)", sunset: "linear-gradient(180deg,#28345e,#ff9a58 55%,#b98a56 56%)", snow: "linear-gradient(180deg,#8fa9c6,#e8eff6 55%,#f0f5fa 56%)", night: "linear-gradient(180deg,#02040c,#16213d 55%,#1a2a1f 56%)" };
  TRACK_DEFS.forEach((d, i) => {
    const b = document.createElement("button"); b.className = "card";
    const t = S.best[d.id];
    b.innerHTML = `<div class="pic" style="background:${grads[d.theme]}"></div><div class="t"><h3>${d.name}</h3><p>${d.sub}</p><div class="row"><span class="stars">${"★".repeat(d.diff)}${"☆".repeat(4 - d.diff)}</span><span>${t ? "🏁 " + fmtT(t) : "ще не їхав"}</span></div></div>`;
    b.onclick = () => startRace(i);
    el.appendChild(b);
  });
}

function buildFreeList() {
  const el = $("#freeList"); el.innerHTML = "";
  const grads = { lot: "linear-gradient(180deg,#28345e,#ff9a58 55%,#6d6f74 56%)", city: "linear-gradient(180deg,#02040c,#243a6a 45%,#ffd98a 46%,#1b2130 70%)" };
  ARENAS.forEach(a => {
    const b = document.createElement("button"); b.className = "card";
    b.innerHTML = `<div class="pic" style="background:${grads[a.id]}"></div><div class="t"><h3>${a.name}</h3><p>${a.sub}</p><div class="row"><span>Дрифт = очки і монети</span><span>🏆 ${S.driftBest || 0}</span></div></div>`;
    b.onclick = () => startFree(a.id);
    el.appendChild(b);
  });
}

function buildSettings() {
  const rows = [
    ["Графіка", "Нижча = плавніше на слабкому телефоні", "quality", [["low", "Низька"], ["mid", "Середня"], ["high", "Висока"]]],
    ["Суперники", "Швидкість водіїв", "diff", [[.92, "Легко"], [1, "Норма"], [1.07, "Складно"]]],
    ["Кіл у гонці", "", "laps", [[2, "2"], [3, "3"], [5, "5"]]],
    ["Газ", "Авто — просто кермуй і гальмуй", "auto", [[true, "Авто"], [false, "Кнопка"]]],
    ["Допомога в поворотах", "Сама збавляє швидкість при крутому керуванні", "assist", [[true, "Так"], [false, "Ні"]]],
    ["Звук", "", "sound", [[true, "Увімк"], [false, "Вимк"]]],
    ["Кермо нахилом", "Експериментально: нахиляй телефон", "tilt", [[false, "Ні"], [true, "Так"]]],
    ["Інвертувати нахил", "Якщо повертає в інший бік", "tiltInv", [[false, "Ні"], [true, "Так"]]]
  ];
  const el = $("#setList"); el.innerHTML = "";
  for (const [name, hint, key, opts] of rows) {
    const r = document.createElement("div"); r.className = "set";
    r.innerHTML = `<div>${name}${hint ? `<small>${hint}</small>` : ""}</div><div class="opts"></div>`;
    const o = r.querySelector(".opts");
    for (const [v, l] of opts) {
      const b = document.createElement("button"); b.textContent = l; if (S[key] === v) b.classList.add("on");
      b.onclick = () => {
        S[key] = v; save(); buildSettings();
        if (key === "sound") A.setSound(v);
        if (key === "quality") { applySize(); curTrack !== -1 && reload(); }
        if (key === "auto") document.body.classList.toggle("auto", v);
        if (key === "tilt") { document.body.classList.toggle("tilt", v); if (v) enableTilt(); }
      };
      o.appendChild(b);
    }
    el.appendChild(r);
  }
  if (document.documentElement.requestFullscreen) {
    const f = document.createElement("div"); f.className = "set";
    f.innerHTML = `<div>На весь екран<small>Ховає панелі браузера</small></div><div class="opts"><button id="stFs">Увімкнути</button></div>`;
    el.appendChild(f);
    $("#stFs").onclick = () => { document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {})).catch(() => {}); };
  }
  const r = document.createElement("div"); r.className = "set";
  r.innerHTML = `<div>Оновити гру<small>Підтягнути нову версію (збереження лишаться)</small></div><div class="opts"><button id="stRef">Оновити</button></div>`;
  el.appendChild(r); $("#stRef").onclick = hardRefresh;
}
async function checkUpdate() {
  try {
    const r = await fetch("version.json?" + Date.now(), { cache: "no-store" }); if (!r.ok) return;
    const j = await r.json();
    if (j.build > BUILD) { if (!sessionStorage.getItem("updTry" + j.build)) { sessionStorage.setItem("updTry" + j.build, "1"); hardRefresh(); } else $("#ver").textContent = "v" + BUILD + " → є v" + j.build + " (Налаштування → Оновити)"; }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && state === "menu") checkUpdate(); });
async function hardRefresh() {
  try {
    if ("serviceWorker" in navigator) (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
    if (window.caches) (await caches.keys()).forEach(k => caches.delete(k));
  } catch (e) {}
  location.reload();
}
async function reload() { const t = curTrack < 0 ? clamp(S.last | 0, 0, TRACK_DEFS.length - 1) : curTrack; curTrack = -1; await loadTrack(t); enterMenu(); }

/* ---------------- завантаження траси ---------------- */
function disposeWorld() {
  if (!scene) return;
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); }
  });
  if (envRT) envRT.dispose();
  cars = []; player = null; prevModel = null;
}
async function loadTrack(ti) {
  $("#loadTxt").textContent = "Будуємо трасу…"; show("sLoad");
  await new Promise(r => setTimeout(r, 40));
  disposeWorld(); freeKind = null; miniBg = null;
  const def = TRACK_DEFS[ti], q = qual();
  renderer.shadowMap.enabled = !!q.shadow;
  W = buildWorld(def, q); T = W.T; scene = W.scene; curTrack = ti; S.last = ti; save();
  W.sun.userData = { dx: W.sun.position.x, dy: W.sun.position.y, dz: W.sun.position.z };
  const es = new THREE.Scene(); es.add(makeSky(W.th));
  envRT = pmrem.fromScene(es, 0, 1, 6000); scene.environment = envRT.texture;
  initEffects();
  applySize();
}
function initEffects() {
  // сліди шин
  const g = new THREE.BufferGeometry(), pos = new Float32Array(SKN * 12), idx = new Uint32Array(SKN * 6);
  for (let q = 0; q < SKN; q++) { const i = q * 4; idx.set([i, i + 1, i + 2, i + 1, i + 3, i + 2], q * 6); }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
  skidMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: true }));
  skidMesh.frustumCulled = false; skidMesh.renderOrder = 2; scene.add(skidMesh); skHead = skCount = 0;
  // частинки (дим, пил)
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PN * 3), 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(PN), 1).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(PN), 1).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute("aCol", new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
  partMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uK: { value: 600 } },
    vertexShader: "attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC; uniform float uK; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=aSize*uK/max(-mv.z,.5); vA=aAlpha; vC=aCol; }",
    fragmentShader: "varying float vA; varying vec3 vC; void main(){ vec2 d=gl_PointCoord-.5; float r=length(d)*2.; float a=smoothstep(1.,.2,r)*vA; if(a<.01) discard; gl_FragColor=vec4(vC,a); }"
  });
  partPts = new THREE.Points(pg, partMat); partPts.frustumCulled = false; partPts.renderOrder = 3; scene.add(partPts);
  P.n = 0; P.life.fill(0);
  partMat.uniforms.uK.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}
const P = { life: new Float32Array(PN), max: new Float32Array(PN), vel: new Float32Array(PN * 3), s0: new Float32Array(PN), s1: new Float32Array(PN), a0: new Float32Array(PN), n: 0 };
function emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a) {
  const i = P.n = (P.n + 1) % PN, pa = partPts.geometry.attributes;
  pa.position.setXYZ(i, x, y, z); P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz; P.life[i] = P.max[i] = life; P.s0[i] = s0; P.s1[i] = s1; P.a0[i] = a;
  pa.aCol.setXYZ(i, r, g, b);
}
function updParticles(dt) {
  if (!partPts) return; const pa = partPts.geometry.attributes;
  for (let i = 0; i < PN; i++) {
    if (P.life[i] <= 0) { pa.aAlpha.array[i] = 0; continue; }
    P.life[i] -= dt; const t = 1 - P.life[i] / P.max[i];
    pa.position.array[i * 3] += P.vel[i * 3] * dt; pa.position.array[i * 3 + 1] += P.vel[i * 3 + 1] * dt; pa.position.array[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
    P.vel[i * 3] *= 1 - dt * 1.2; P.vel[i * 3 + 2] *= 1 - dt * 1.2;
    pa.aSize.array[i] = lerp(P.s0[i], P.s1[i], t); pa.aAlpha.array[i] = P.a0[i] * (1 - t) * Math.min(1, t * 8);
  }
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aCol.needsUpdate = true;
}
function skidSeg(x0, y0, z0, x1, y1, z1) {
  let dx = x1 - x0, dz = z1 - z0; const l = Math.hypot(dx, dz); if (l < .05 || l > 6) return;
  dx /= l; dz /= l; const px = -dz * .13, pz = dx * .13, p = skidMesh.geometry.attributes.position.array, i = (skHead % SKN) * 12;
  p.set([x0 - px, y0, z0 - pz, x0 + px, y0, z0 + pz, x1 - px, y1, z1 - pz, x1 + px, y1, z1 + pz], i);
  skHead++; skCount = Math.min(SKN, skCount + 1); skDirty = true;
}

/* ---------------- машини ---------------- */
let blobTex = null, glowTex = null;
function fxTex() {
  if (blobTex) return;
  const mk = (n, f) => { const k = document.createElement("canvas"); k.width = k.height = n; f(k.getContext("2d"), n); const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t; };
  blobTex = mk(64, (g, n) => { const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(.55, "rgba(0,0,0,.4)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, n, n); });
  glowTex = mk(64, (g, n) => { const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.2, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, n, n); });
}
function addModel(c, th, light) {
  const m = createCarModel(c.spec, c.color, th.env, c === player); c.model = m; scene.add(m.root);
  fxTex();
  const bl = new THREE.Mesh(new THREE.PlaneGeometry(c.spec.L * 1.25, c.spec.W * 1.45), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }));
  bl.rotation.x = -Math.PI / 2; bl.position.y = .05; bl.renderOrder = 1; m.root.add(bl);
  m.glows = [];
  const L = c.spec.L, Wd = c.spec.W, hy = (m.fm && m.fm.tailY) || .8;
  for (const sd of [-1, 1]) {
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: .3, fog: false });
    const sp = new THREE.Sprite(gm); sp.renderOrder = 5; sp.scale.set(.9, .6, 1); sp.position.set(-L / 2 - .08, .82, sd * Wd * .34); m.tilt.add(sp); m.glows.push(sp);
    if (th.lamps) { const hm = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1cf, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: .5, fog: false }); const hp = new THREE.Sprite(hm); hp.scale.set(1.1, .8, 1); hp.renderOrder = 5; m.headG = m.headG || []; m.headG.push(hp); hp.position.set(L / 2 + .1, .72, sd * Wd * .32); m.tilt.add(hp); }
  }
  if (light) { const sp = new THREE.SpotLight(0xfff0d0, 700, 120, .5, .6, 1.4); sp.position.set(c.spec.L / 2, .8, 0); sp.target.position.set(40, -.5, 0); m.tilt.add(sp, sp.target); }
}
function gridPos(k) { return { idx: -(3 + Math.floor(k / 2) * 2), lat: (k % 2 ? 1 : -1) * 3.1 }; }
function spawn(mode) {
  for (const c of cars) scene.remove(c.model.root);
  if (prevModel) { scene.remove(prevModel.root); prevModel = null; }
  cars = []; player = null;
  const def = track(), th = W.th, n = 6, surf = def.theme === "snow" ? .84 : 1, mul = S.diff;
  for (let k = 0; k < n; k++) {
    const isP = mode === "race" && k === n - 1;
    let c;
    if (isP) {
      const sp = CARS.find(x => x.id === S.car) || CARS[0];
      c = new Car(sp, { player: true, name: "Ти", color: S.colors[sp.id] || sp.color, surf }); player = c;
    } else {
      const pool = mode === "race" ? CARS.slice(0, Math.max(1, CARS.findIndex(x => x.id === S.car) + 1)) : (CARS.filter(x => hasCar(x.id)).length ? CARS.filter(x => hasCar(x.id)) : CARS), base = pool[(Math.random() * pool.length) | 0], vm = def.aiMax * mul * rnd(.95, 1.03);
      const P = CARS.find(x => x.id === S.car) || CARS[0], f = .84 + (mul - .92) * .6;
      const sp = { ...base, vmax: Math.min(vm, P.vmax * f * rnd(.97, 1.01)), acc: Math.min(8.5 + def.diff * 1.8 + (mul - 1) * 8, P.acc * (f - .05)), mu: Math.min(1.3 + def.diff * .06, P.mu * (f + .02)), brake: Math.min(12.5, P.brake) };
      const col = COLORS[(Math.random() * COLORS.length) | 0];
      c = new Car(sp, { name: ["Макс", "Олекс", "Дана", "Тарас", "Ліза", "Юрко", "Ігор", "Софа"][(Math.random() * 8) | 0], color: col, skill: rnd(.9, .98), lane: rnd(-3, 3), surf });
      c.skillBase = c.skill; c.pA = rnd(.05, .085); c.pP = rnd(13, 26); c.pph = rnd(0, 6.28); c.qA = rnd(.02, .035); c.qP = rnd(5, 9); c.qph = rnd(0, 6.28);
    }
    const g = gridPos(k); c.place(T, Math.round(g.idx), g.lat, W.H); c.pi = c.idx; c.lap = 0; c.lapStart = 0; c.cheat = 0;
    if (mode === "demo") { c.lap = 1; }
    c.grid = k;
    addModel(c, th, isP && th.lamps);
    cars.push(c);
  }
  if (mode === "demo") cars.forEach((c, i) => { const j = Math.round(i * T.M / 6); c.place(T, j, rnd(-2, 2), W.H); c.pi = c.idx; c.vx = Math.cos(c.a) * 25; c.vz = Math.sin(c.a) * 25; c.vf = 25; });
  syncAll(0.016);
}
function syncAll(dt) {
  if (player && player.model.glows && camera) { const fx = Math.cos(player.a), fz = Math.sin(player.a), front = (camera.position.x - player.x) * fx + (camera.position.z - player.z) * fz > 0 || camMode === 1; for (const g of player.model.glows) g.visible = !front; if (player.model.headG) for (const g of player.model.headG) g.visible = front && camMode !== 1; } for (const c of cars) { syncModel(c, c.model, dt); } if (player) player.model.root.visible = true; }

/* ---------------- вільний режим (дрифт) ---------------- */
const dr = { cur: 0, t: 0, idle: 0, mult: 1, session: 0, earned: 0, hit: 0 };
function drReset() { dr.cur = 0; dr.t = 0; dr.idle = 0; dr.mult = 1; dr.session = 0; dr.earned = 0; dr.hit = 0; }
async function startFree(kind) {
  A.audioInit();
  state = "loading"; show("sLoad"); $("#loadTxt").textContent = "Будуємо локацію…"; await new Promise(r => setTimeout(r, 40));
  disposeWorld(); const q = qual(); renderer.shadowMap.enabled = !!q.shadow;
  W = buildArena(kind, q); T = W.T; scene = W.scene; curTrack = -1; freeKind = kind; miniBg = null;
  W.sun.userData = { dx: W.sun.position.x, dy: W.sun.position.y, dz: W.sun.position.z };
  const es = new THREE.Scene(); es.add(makeSky(W.th));
  envRT = pmrem.fromScene(es, 0, 1, 6000); scene.environment = envRT.texture;
  initEffects(); applySize();
  $("#loadTxt").textContent = "Завантаження машини…"; await ensureCar(S.car);
  spawnFree(); drReset(); camNear();
  try { renderer.compile(scene, camera); renderer.render(scene, camera); } catch (e) {}
  hideAll(); $("#hud").hidden = false; $("#ctl").hidden = false; $("#count").hidden = true;
  document.body.classList.add("free"); document.body.classList.toggle("auto", S.auto); document.body.classList.toggle("tilt", S.tilt);
  state = "free"; snapCamera(); applySize();
  banner("Тисни ДРИФТ і крути кермо — чим довше слайд, тим більше очок", 3200);
}
function spawnFree() {
  for (const c of cars) scene.remove(c.model.root);
  const sp = CARS.find(x => x.id === S.car) || CARS[0];
  const c = new Car(sp, { player: true, name: "Ти", color: S.colors[sp.id] || sp.color, surf: 1 }); player = c; cars = [c];
  const city = freeKind === "city";
  c.x = city ? -53 : -30; c.z = city ? 53 : 0; c.a = 0; c.y = 0; c.idx = 0; c.pi = 0; c.lap = 1; c.grid = 0;
  addModel(c, W.th, W.th.lamps); syncAll(.016);
}
function bankDrift(why) {
  if (dr.cur < 30) { dr.cur = 0; dr.t = 0; dr.mult = 1; return; }
  const pts = Math.round(dr.cur), coins = Math.max(1, Math.floor(pts / 40));
  dr.session += pts; dr.earned += coins; S.coins += coins; S.driftTotal += pts;
  if (pts > S.driftBest) { S.driftBest = pts; banner("Новий рекорд дрифту: " + pts + "! +" + coins + " 🪙", 2200); } else banner("Дрифт +" + pts + " · +" + coins + " 🪙", 1500);
  save(); updCoins(); dr.cur = 0; dr.t = 0; dr.mult = 1;
}
function driftLogic(dt) {
  const p = player; if (!p) return;
  const ratio = p.slip / Math.max(p.speed, 1), on = p.speed > 9 && p.slip > 3 && ratio > .17 && !p.braking;
  if (p.bump > .35 && dr.cur > 0) { dr.cur = 0; dr.t = 0; dr.mult = 1; dr.idle = 0; banner("Зіткнення — серія згоріла", 1100); return; }
  if (on) {
    dr.idle = 0; dr.t += dt; dr.mult = Math.min(6, 1 + Math.floor(dr.t / 1.8));
    dr.cur += dt * (p.speed * 0.9 + p.slip * 3) * Math.min(1.6, ratio * 3) * dr.mult * .5;
  } else if (dr.cur > 0) { dr.idle += dt; if (dr.idle > 1.1) { bankDrift(); dr.idle = 0; } }
}
async function leaveFree() {
  if (!freeKind) return;
  bankDrift(); freeKind = null; document.body.classList.remove("free");
  await loadTrack(clamp(S.last | 0, 0, TRACK_DEFS.length - 1));
  state = "loading";
}

/* ---------------- гонка ---------------- */
async function startRace(ti) {
  A.audioInit(); if (freeKind) { bankDrift(); document.body.classList.remove("free"); }
  if (ti !== curTrack || freeKind) await loadTrack(ti);
  state = "loading"; show("sLoad"); $("#loadTxt").textContent = "Завантаження машин…"; await new Promise(r => setTimeout(r, 30));
  await Promise.all(CARS.slice(0, CARS.findIndex(x => x.id === S.car) + 1).map(c => ensureCar(c.id)));
  laps = S.laps; spawn("race"); camNear(); try { renderer.compile(scene, camera); renderer.render(scene, camera); } catch (e) {} raceT = 0; countT = 4; countShown = -1; finishTimer = 0; wrongT = 0;
  hideAll(); $("#hud").hidden = false; $("#ctl").hidden = false; $("#count").hidden = true; state = "count";
  document.body.classList.toggle("auto", S.auto); document.body.classList.toggle("tilt", S.tilt);
  snapCamera(); applySize();
}
function lapLogic(c) {
  const M = T.M, i = c.idx, prev = c.pi;
  if (prev > M * .8 && i < M * .2) { c.lap++; onLap(c); }
  else if (prev < M * .2 && i > M * .8) c.lap = Math.max(0, c.lap - 1);
  c.pi = i;
}
function onLap(c) {
  if (c.lap >= 2 && !c.finished) {
    const lt = (raceT - c.lapStart) * 1000;
    if (!c.bestLap || lt < c.bestLap) c.bestLap = lt;
    if (c === player) { banner("Коло " + (c.lap - 1) + ": " + fmtT(lt), 2200); A.beep(880, .12, .12); }
  }
  c.lapStart = raceT;
  if (c.lap > laps && !c.finished) {
    c.finished = true; c.finishT = raceT;
    if (c === player) { state = "finish"; finishTimer = 2.4; banner("ФІНІШ!", 2400); A.beep(990, .5, .2); flash(); }
  }
}
function flash() { const f = $("#flash"); f.style.opacity = .5; setTimeout(() => (f.style.opacity = 0), 120); }
function order() {
  const M = T.M;
  for (const c of cars) c.progress = c.lap * M + (c.lap === 0 && c.idx > M / 2 ? c.idx - M : c.idx) + clamp(c.nr.s / T.step, -.5, .5);
  return [...cars].sort((a, b) => (a.finished && b.finished) ? a.finishT - b.finishT : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress);
}
let ordCache = [];
function physStep(dt) {
  for (const c of cars) { const q = c._p || (c._p = {}); q.x = c.x; q.y = c.y; q.z = c.z; q.a = c.a; q.pitch = c.pitch; q.roll = c.roll; }
  const racing = state === "race" || state === "finish" || state === "menu" || state === "free";
  const pin = playerInput();
  for (const c of cars) {
    let inp;
    if (c === player && !c.finished && !bot) inp = pin;
    else inp = aiInput(c, T, cars, dt, racing);
    if (c === player && !racing) inp = { hold: true };
    c.thr = inp.gas;
    stepCar(c, inp, dt, T, W.H);
  }
  let hit = 0;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j]; if (Math.abs(a.x - b.x) > 6 || Math.abs(a.z - b.z) > 6) continue;
    const h = collide(a, b); if (h > 0 && (a === player || b === player)) hit = Math.max(hit, h);
  }
  if (hit > .08) { A.thud(hit); camShake = Math.max(camShake, hit * .5); }
  if (player && player.bump > .05) { A.thud(player.bump); camShake = Math.max(camShake, player.bump * .6); }
  if (state === "free") driftLogic(dt);
  else if (state === "race" || state === "finish") { raceT += dt; for (const c of cars) lapLogic(c); }
  else if (state === "menu") for (const c of cars) c.pi = c.idx;
}
let camShake = 0;
function rubber(dt) {
  if (!player) return; ordCache = order();
  for (const c of cars) if (c !== player && c.skillBase) {
    const d = (c.progress - player.progress) * T.step;
    const rb = d > 260 ? .9 : d > 120 ? .95 : d < -200 ? 1.02 : 1;
    const tt = raceT, pace = 1 + c.pA * Math.sin(tt / c.pP * 6.283 + c.pph) + c.qA * Math.sin(tt / c.qP * 6.283 + c.qph);   // то швидше, то повільніше
    c.skill = c.skillBase * rb * pace;
  }
}
function racePlace(c) { return ordCache.indexOf(c) + 1; }

/* ---------------- камера ---------------- */
let camYaw = 0, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camFov = 62;
function snapCamera() {
  if (!player) return;
  camYaw = player.a; const b = 7.6;
  camPos.set(player.x - Math.cos(camYaw) * b, player.y + 2.6, player.z - Math.sin(camYaw) * b);
  camera.position.copy(camPos); camLook.set(player.x, player.y + 1.2, player.z); camera.lookAt(camLook);
}
const EYE = { city: [-.1, -.2, .82], sport: [-.1, -.2, .83], muscle: [-.1, -.2, .82], gt: [-.5, -.2, .88], hyper: [-.1, -.2, .84] };
function camNear() { document.body.classList.toggle("cock", camMode === 1); camera.near = camMode === 1 ? .2 : .3; fpsHold = performance.now() + 3000; fpsAcc = fpsN = 0; camera.updateProjectionMatrix(); if (player) { const pm = player.model, ins = camMode === 1 && pm.hasInt; pm.body.visible = !ins; pm.wheels.forEach(w => (w.pivot.visible = !ins)); pm.root.visible = true; } }
function cycleCam() {
  camMode = (camMode + 1) % 4; if (player) player.model.root.visible = true;
  if (camMode === 3 && player) { orbA = player.a + Math.PI; orbP = .35; orbSnap = true; banner("Огляд 360°: крути пальцем екран, двома пальцями — наближення", 2600); }
  lookYaw = lookPitch = 0; camNear();
}
/* вільний огляд: перетягуй пальцем по екрану (поза кнопками) */
let lookYaw = 0, lookPitch = 0, lookRel = 0, orbA = 0, orbP = .35, orbD = 9, orbSnap = false;
const lk = { id: null, x: 0, y: 0, pd: 0 };
const inGameState = () => state === "race" || state === "count" || state === "free" || state === "finish";
function dragLook(dx, dy) {
  if (document.body.classList.contains("rot")) { const t = dx; dx = dy; dy = -t; }
  if (camMode === 3) { orbA -= dx * .0065; orbP = clamp(orbP + dy * .005, -.02, 1.4); }
  else { lookYaw -= dx * .0065; lookPitch = clamp(lookPitch + dy * .005, -.1, 1.2); }
}
function tdist(e) { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
canvas.addEventListener("touchstart", e => {
  if (!inGameState()) return;
  if (e.touches.length >= 2 && camMode === 3) { lk.pd = tdist(e); return; }
  if (lk.id === null) { const t = e.changedTouches[0]; lk.id = t.identifier; lk.x = t.clientX; lk.y = t.clientY; lookRel = 1e9; }
}, { passive: true });
canvas.addEventListener("touchmove", e => {
  if (!inGameState()) return;
  if (e.touches.length >= 2 && camMode === 3 && lk.pd) { const d = tdist(e); orbD = clamp(orbD * lk.pd / Math.max(d, 20), 4.5, 24); lk.pd = d; return; }
  for (const t of e.changedTouches) if (t.identifier === lk.id) { dragLook(t.clientX - lk.x, t.clientY - lk.y); lk.x = t.clientX; lk.y = t.clientY; }
}, { passive: true });
const lkEnd = e => { for (const t of e.changedTouches) if (t.identifier === lk.id) { lk.id = null; lookRel = performance.now(); } if (e.touches.length < 2) lk.pd = 0; };
canvas.addEventListener("touchend", lkEnd, { passive: true }); canvas.addEventListener("touchcancel", lkEnd, { passive: true });
let mdrag = false;
canvas.addEventListener("pointerdown", e => { if (e.pointerType === "mouse" && inGameState()) { mdrag = true; lk.x = e.clientX; lk.y = e.clientY; lookRel = 1e9; } });
addEventListener("pointermove", e => { if (mdrag && e.pointerType === "mouse") { dragLook(e.clientX - lk.x, e.clientY - lk.y); lk.x = e.clientX; lk.y = e.clientY; } });
addEventListener("pointerup", e => { if (mdrag) { mdrag = false; lookRel = performance.now(); } });
canvas.addEventListener("wheel", e => { if (camMode === 3) orbD = clamp(orbD + e.deltaY * .01, 4.5, 24); }, { passive: true });
function onTap(el, fn) { let t = 0; const go = e => { const n = performance.now(); if (n - t < 350) return; t = n; fn(e); }; el.addEventListener("pointerup", go); el.addEventListener("click", go); }
onTap($("#bCam"), cycleCam);
function updateCamera(dt) {
  const t = performance.now() / 1000;
  if (state === "menu" || state === "garage") {
    const tgt = state === "garage" && prevModel ? prevModel.root.position : (cars[0] ? { x: cars[0].x, y: cars[0].y, z: cars[0].z } : { x: 0, y: 0, z: 0 });
    const ang = state === "garage" ? garageT * .45 : t * .12, rad = state === "garage" ? 6.6 : 16, hgt = state === "garage" ? 1.7 : 4.5;
    const wx = tgt.x + Math.cos(ang) * rad, wz = tgt.z + Math.sin(ang) * rad;
    camera.position.set(wx, Math.max(tgt.y + hgt, W.H(wx, wz, -1) + 1.5), wz); camera.lookAt(tgt.x, tgt.y + (state === "garage" ? -.75 : 1), tgt.z);
    camFov = lerp(camFov, state === "garage" ? 38 : 55, Math.min(1, dt * 4)); camera.fov = camFov; camera.updateProjectionMatrix(); return;
  }
  const p = player; if (!p) return;
  const sp = p.speed, boost = p.boostT > 0;
  if (camMode === 3) {
    if (orbSnap) { orbSnap = false; camPos.set(p.x + Math.cos(orbA) * orbD, p.y + 3, p.z + Math.sin(orbA) * orbD); }
    const cp = Math.cos(orbP), dx = p.x + Math.cos(orbA) * cp * orbD, dz = p.z + Math.sin(orbA) * cp * orbD, dy = Math.max(p.y + .5 + Math.sin(orbP) * orbD, .5);
    const k = 1 - Math.exp(-dt * 14); camPos.x += (dx - camPos.x) * k; camPos.y += (dy - camPos.y) * k; camPos.z += (dz - camPos.z) * k;
    camera.position.copy(camPos); camLook.set(p.x, p.y + .8, p.z); camera.lookAt(camLook);
    camFov = lerp(camFov, 52, Math.min(1, dt * 5));
  } else if (camMode === 1) {
    const fx = Math.cos(p.a), fz = Math.sin(p.a), m = p.model, eye = EYE[p.spec.id] || [0, 0];
    if (m.hasInt) {
      const ex = eye[0], ez = eye[1] * m.W, ey = m.H * (eye[2] || .8), rx = -fz, rz = fx;
      camera.position.set(p.x + fx * ex + rx * ez, p.y + ey + Math.abs(Math.sin(t * 40)) * .004 * sp / 60, p.z + fz * ex + rz * ez);
    } else camera.position.set(p.x + fx * (p.spec.L / 2 - .1), p.y + .78 + Math.abs(Math.sin(t * 40)) * .005 * sp / 60, p.z + fz * (p.spec.L / 2 - .1));
    camera.rotation.order = "YXZ"; camera.rotation.set(-p.pitch * .6 - (m.hasInt ? .03 : 0), -p.a - Math.PI / 2 - lookYaw * .8 + p.steerS * .05, -p.roll * .5);
    camFov = lerp(camFov, 74 + sp * .16 + (boost ? 8 : 0), Math.min(1, dt * 5));
  } else {
    let dirA = p.a; if (sp > 7) { const va = Math.atan2(p.vz, p.vx); dirA = p.a + angDiff(p.a, va) * .35; }
    camYaw += angDiff(camYaw, dirA) * Math.min(1, dt * 4.2);
    if (lk.id === null && !mdrag && performance.now() - lookRel > 1500) { const d = Math.exp(-dt * 3); lookYaw *= d; lookPitch *= d; }
    const back0 = (camMode === 2 ? 11 : 7.4) + sp * .02, up0 = (camMode === 2 ? 3.8 : 2.45) + sp * .005, ly = camYaw + lookYaw, cpL = Math.cos(lookPitch);
    const back = back0 * cpL, up = up0 + Math.sin(lookPitch) * back0;
    const cx = Math.cos(ly), cz = Math.sin(ly), lam = Math.max(0, 1 - Math.hypot(lookYaw, lookPitch) * 1.6);
    const dx = p.x - cx * back, dz = p.z - cz * back, dy = Math.max(p.y + up, W.H(dx, dz, p.idx) + 1);
    const k = 1 - Math.exp(-dt * 11);
    camPos.x += (dx - camPos.x) * k; camPos.y += (dy - camPos.y) * k; camPos.z += (dz - camPos.z) * k;
    camera.position.copy(camPos);
    if (camShake > 0) { camera.position.x += (Math.random() - .5) * camShake; camera.position.y += (Math.random() - .5) * camShake; camShake = Math.max(0, camShake - dt * 2.4); }
    camLook.set(p.x + Math.cos(camYaw) * 6 * lam, p.y + 1.15, p.z + Math.sin(camYaw) * 6 * lam); camera.lookAt(camLook);
    camFov = lerp(camFov, 60 + sp * .28 + (boost ? 9 : 0), Math.min(1, dt * 5));
  }
  if (Math.abs(camera.fov - camFov) > .05) { camera.fov = camFov; camera.updateProjectionMatrix(); partMat && (partMat.uniforms.uK.value = renderer.domElement.height / (2 * Math.tan(camFov * Math.PI / 360))); }
}

/* ---------------- візуальні ефекти і HUD ---------------- */
function effects(dt) {
  const th = W.th, g = th.ground;
  for (const c of cars) {
    const fx = Math.cos(c.a), fz = Math.sin(c.a), rx = -fz, rz = fx, L = c.spec.L, Wd = c.spec.W;
    const act = c.speed > 6 && (c.slip > 5.5 || (c.braking && c.aLong < -9 && c.speed > 28));
    const sm = c.thr && c.vf < 7 && c.aLong > 3 && c.speed < 15;
    if (act || sm) {
      let any = false; c.skidPrev = c.skidPrev || [null, null];
      [-1, 1].forEach((s, i) => {
        const wx = c.x - fx * L * .3 + rx * s * (Wd / 2 - .13), wz = c.z - fz * L * .3 + rz * s * (Wd / 2 - .13), wy = W.H(wx, wz, c.idx) + .075;
        if (!c.off && c.skidPrev[i]) skidSeg(c.skidPrev[i][0], c.skidPrev[i][1], c.skidPrev[i][2], wx, wy, wz);
        c.skidPrev[i] = [wx, wy, wz];
        if (Math.random() < .55) emit(wx, wy + .2, wz, rnd(-.8, .8) + c.vx * .1, rnd(.6, 1.6), rnd(-.8, .8) + c.vz * .1, rnd(.8, 1.4), 1.0, 3.4, .86, .86, .88, .42);
      });
    } else c.skidPrev = null;
    if (c.off && c.speed > 10 && Math.random() < .5) {
      const wx = c.x - fx * L * .3 + rx * rnd(-1, 1), wz = c.z - fz * L * .3 + rz * rnd(-1, 1);
      emit(wx, c.y + .2, wz, rnd(-1.5, 1.5) - c.vx * .06, rnd(.5, 2), rnd(-1.5, 1.5) - c.vz * .06, rnd(.7, 1.3), .9, 3.2, g[0] / 255 * .9, g[1] / 255 * .85, g[2] / 255 * .8, .45);
    }
    if (c.boostT > 0 && Math.random() < .6) emit(c.x - fx * (L / 2 + .9), c.y + .45, c.z - fz * (L / 2 + .9), -c.vx * .3, rnd(0, .5), -c.vz * .3, .4, .8, 1.6, .5, .75, 1, .6);
  }
  if (skDirty) { skidMesh.geometry.attributes.position.needsUpdate = true; skidMesh.geometry.setDrawRange(0, skCount * 6); skDirty = false; }
  updParticles(dt);
}
const mini = $("#mini"), mg = mini.getContext("2d"); let miniBg = null, miniS = null;
function buildMini() {
  const bb = W.bbox, w = bb.maxX - bb.minX, h = bb.maxZ - bb.minZ, S0 = 250 / Math.max(w, h);
  miniS = { s: S0, ox: 140 - (bb.minX + w / 2) * S0, oz: 140 - (bb.minZ + h / 2) * S0 };
  miniBg = document.createElement("canvas"); miniBg.width = miniBg.height = 280; const g = miniBg.getContext("2d");
  g.lineJoin = "round"; g.lineCap = "round";
  const path = () => { g.beginPath(); for (let i = 0; i <= T.M; i++) { const k = i % T.M, x = T.x[k] * miniS.s + miniS.ox, z = T.z[k] * miniS.s + miniS.oz; i ? g.lineTo(x, z) : g.moveTo(x, z); } };
  g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 16; path(); g.stroke();
  g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 9; path(); g.stroke();
  g.fillStyle = "#ff3d3d"; g.fillRect(T.x[0] * miniS.s + miniS.ox - 9, T.z[0] * miniS.s + miniS.oz - 3, 18, 6);
}
let hudT = 0, lastCurve = -1;
function hudFree() {
  const p = player; if (!p) return;
  $("#hSpeed b").textContent = Math.round(p.speed * 3.6); $("#hGear").textContent = p.vf < -.5 ? "R" : p.gear;
  const nb = $("#hNitro"); nb.firstElementChild.style.width = Math.round(p.nitro * 100) + "%"; nb.classList.toggle("on", p.boostT > 0);
  const d = $("#hDrift"); d.classList.toggle("act", dr.cur > 0 && dr.idle < .05);
  d.innerHTML = `<small>ДРИФТ</small><b>${Math.round(dr.cur)}</b>${dr.cur > 0 ? `<em>×${dr.mult}</em>` : ""}<div class="tot">Всього: ${dr.session} · 🪙 +${dr.earned} · рекорд ${S.driftBest}</div>`;
}
function hud(dt) {
  const p = player; if (!p) return;
  hudT += dt;
  const sp = Math.round(p.speed * 3.6); $("#hSpeed b").textContent = sp; $("#hGear").textContent = p.vf < -.5 ? "R" : p.gear;
  const nb = $("#hNitro"); nb.firstElementChild.style.width = Math.round(p.nitro * 100) + "%"; nb.classList.toggle("on", p.boostT > 0);
  $("#hPos").innerHTML = `<b>${racePlace(p) || 6}</b><span>/${cars.length}</span>`;
  $("#hLap").textContent = "Коло " + Math.min(Math.max(p.lap, 1), laps) + "/" + laps;
  $("#hTime").textContent = fmtT(raceT * 1000).replace(/^0:/, "0:");
  if (hudT > .06) {
    hudT = 0; if (!miniBg) buildMini();
    mg.clearRect(0, 0, 280, 280); mg.drawImage(miniBg, 0, 0);
    for (const c of cars) { mg.fillStyle = c === p ? "#ffc247" : "#ff5a5a"; mg.beginPath(); mg.arc(c.x * miniS.s + miniS.ox, c.z * miniS.s + miniS.oz, c === p ? 9 : 6, 0, 7); mg.fill(); if (c === p) { mg.strokeStyle = "#000"; mg.lineWidth = 3; mg.stroke(); } }
  }
}

/* ---------------- гараж ---------------- */
let gSel = null;
function enterGarage() {
  state = "garage"; garageT = 0; gSel = S.car; show("sGarage"); $("#hud").hidden = true; $("#ctl").hidden = true;
  for (const c of cars) c.model.root.visible = false;
  garageModel(); garageUI(); updCoins();
}
function leaveGarage() { if (prevModel) { scene.remove(prevModel.root); prevModel = null; } for (const c of cars) c.model.root.visible = true; }
function garageModel() {
  if (prevModel) scene.remove(prevModel.root);
  const sp = CARS.find(x => x.id === gSel);
  const mk = () => {
    if (prevModel) scene.remove(prevModel.root);
    prevModel = createCarModel(sp, S.colors[sp.id] || sp.color, W.th.env); scene.add(prevModel.root);
    { const gl = new THREE.PointLight(0xffffff, 90, 30, 2); gl.position.set(2, 5, 3); prevModel.root.add(gl); }
    const k = 14, x = T.x[k], z = T.z[k], y = T.h[k]; prevModel.root.position.set(x, y, z); prevModel.root.rotation.y = -Math.atan2(T.tz[k], T.tx[k]);
  };
  if (hasCar(sp.id) || !MODEL_FILE[sp.id]) mk();
  else { if (prevModel) prevModel.root.visible = false; ensureCar(sp.id).then(() => { if (gSel === sp.id && state === "garage") mk(); }); }
}
function garageUI() {
  const sp = CARS.find(x => x.id === gSel), owned = S.owned.includes(sp.id);
  $("#gName").textContent = sp.name + " · " + sp.desc;
  const tabs = $("#carTabs"); tabs.innerHTML = "";
  CARS.forEach(c => { const b = document.createElement("button"); b.className = "tab" + (c.id === gSel ? " on" : ""); b.innerHTML = `${c.name}<small>${S.owned.includes(c.id) ? (S.car === c.id ? "ваша" : "є") : "🪙 " + c.price}</small>`; b.onclick = () => { gSel = c.id; garageModel(); garageUI(); }; tabs.appendChild(b); });
  const bar = (n, v) => `<div class="stat"><b>${n}</b><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
  $("#gStats").innerHTML = bar("Швидкість", (sp.vmax - 40) / 50) + bar("Розгін", (sp.acc - 6) / 11) + bar("Зчеплення", (sp.mu - .8) / .6);
  const sw = $("#swatches"); sw.innerHTML = "";
  if (owned) COLORS.forEach(c => { const b = document.createElement("button"); b.className = "sw" + ((S.colors[sp.id] || sp.color) === c ? " on" : ""); b.style.background = c; b.onclick = () => { S.colors[sp.id] = c; save(); if (prevModel) setCarColor(prevModel, c); garageUI(); }; sw.appendChild(b); });
  const act = $("#gAct");
  if (owned) { act.textContent = S.car === sp.id ? "Обрана ✓" : "Обрати"; act.disabled = S.car === sp.id; }
  else { act.textContent = "Купити за 🪙 " + sp.price; act.disabled = S.coins < sp.price; }
}
$("#gAct").onclick = () => {
  const sp = CARS.find(x => x.id === gSel);
  if (S.owned.includes(sp.id)) S.car = sp.id; else if (S.coins >= sp.price) { S.coins -= sp.price; S.owned.push(sp.id); S.car = sp.id; }
  save(); garageUI(); updCoins();
};

/* ---------------- пауза, результати ---------------- */
function togglePause() {
  if (state === "race" || state === "count" || state === "free") { prevState = state; state = "paused"; show("sPause"); }
  else if (state === "paused") resume();
}
let prevState = "race";
function resume() { state = prevState; hideAll(); }
onTap($("#bPause"), () => { if (state === "race" || state === "count" || state === "free") { prevState = state; state = "paused"; show("sPause"); } });
$("#pResume").onclick = resume;
$("#pRestart").onclick = () => { if (freeKind) { const k = freeKind; bankDrift(); startFree(k); } else startRace(curTrack); };
$("#pMenu").onclick = () => toMenu("sMain");
$("#rAgain").onclick = () => startRace(curTrack);
$("#rMenu").onclick = () => toMenu("sMain");
function showResults() {
  const ord = order(), place = ord.indexOf(player) + 1, pay = [250, 160, 100, 60, 35, 20][place - 1] || 20;
  const id = track().id, t = player.finishT * 1000; let rec = false, lapRec = false;
  if (!S.best[id] || t < S.best[id]) { S.best[id] = Math.round(t); rec = true; }
  if (player.bestLap && (!S.bestLap[id] || player.bestLap < S.bestLap[id])) { S.bestLap[id] = Math.round(player.bestLap); lapRec = true; }
  S.coins += pay; save();
  $("#rTitle").textContent = place === 1 ? "🏆 Перше місце!" : place + " місце";
  $("#rList").innerHTML = ord.map((c, i) => `<div class="resRow ${c === player ? "me" : ""}"><b>${i + 1}</b><span>${c.name}</span><em>${c.finished ? fmtT(c.finishT * 1000) : "не фінішував"}</em></div>`).join("");
  $("#rInfo").innerHTML = `Нагорода: <b>+${pay} 🪙</b> · найкраще коло: ${fmtT(player.bestLap)}${rec ? "<br><b>Новий рекорд траси!</b>" : ""}${lapRec && !rec ? "<br><b>Новий рекорд кола!</b>" : ""}`;
  state = "results"; $("#hud").hidden = true; $("#ctl").hidden = true; show("sRes");
}

/* ---------------- головний цикл ---------------- */
let last = performance.now(), acc = 0, rubT = 0, fpsAcc = 0, fpsN = 0, fpsCool = 0;
function simulate(dt) {
  if (state === "paused" || !cars.length) return;
  if (state === "count") {
    countT -= dt; const n = Math.ceil(countT - 1);
    if (n !== countShown) {
      countShown = n; const el = $("#count");
      if (n >= 1) { el.textContent = n; el.hidden = false; el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; A.beep(520, .18); }
      else if (n === 0) { el.textContent = "ПОЇХАЛИ!"; el.hidden = false; el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; A.beep(1040, .5, .22); state = "race"; raceT = 0; setTimeout(() => ($("#count").hidden = true), 900); }
    }
  }
  if (state === "finish") { finishTimer -= dt; if (finishTimer <= 0) showResults(); }
  acc += dt; let n = 0;
  while (acc >= STEP && n++ < 8) { physStep(STEP); acc -= STEP; }
  if (n >= 8) acc = 0;
  rubT += dt; if (rubT > .4) { rubT = 0; if (state !== "free") rubber(); }
  // неправильний напрямок
  if (player && (state === "race")) {
    const tg = Math.atan2(T.tz[player.idx], T.tx[player.idx]);
    if (player.vf > 6 && Math.abs(angDiff(player.a, tg)) > 2.1) { wrongT += dt; if (wrongT > 1.2) { banner("Не туди! Розвернись", 1000); wrongT = .6; } } else wrongT = 0;
  }
}
const TAU = Math.PI * 2;
function applyInterp(al) {
  al = clamp(al, 0, 1);
  for (const c of cars) {
    const q = c._p; if (!q) continue;
    c._r = { x: c.x, y: c.y, z: c.z, a: c.a, pitch: c.pitch, roll: c.roll };
    c.x = q.x + (c.x - q.x) * al; c.y = q.y + (c.y - q.y) * al; c.z = q.z + (c.z - q.z) * al;
    const d = ((c._r.a - q.a + Math.PI) % TAU + TAU) % TAU - Math.PI; c.a = q.a + d * al;
    c.pitch = q.pitch + (c.pitch - q.pitch) * al; c.roll = q.roll + (c.roll - q.roll) * al;
  }
}
function restoreInterp() { for (const c of cars) { const r = c._r; if (r) { c.x = r.x; c.y = r.y; c.z = r.z; c.a = r.a; c.pitch = r.pitch; c.roll = r.roll; c._r = null; } } }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!W) { return; }
  if (state === "garage") garageT += dt;
  simulate(dt);
  let interp = false;
  if (cars.length && state !== "paused") {
    syncAll(dt); effects(dt);
    if (state === "race" || state === "count" || state === "finish" || state === "menu" || state === "free") { applyInterp(acc / STEP); interp = true; syncAll(0); }
  }
  if (state === "menu") { /* демо-заїзд */ }
  updateCamera(dt);
  if (W && player && T) { /* сонце і тіні слідують за гравцем */
    const f = state === "garage" && prevModel ? prevModel.root.position : player;
    W.sun.target.position.set(f.x, f.y, f.z); W.sun.position.set(f.x + W.sun.userData.dx, f.y + W.sun.userData.dy, f.z + W.sun.userData.dz); W.sun.target.updateMatrixWorld();
  } else if (W && cars[0]) {
    const f = state === "garage" && prevModel ? prevModel.root.position : cars[0];
    W.sun.target.position.set(f.x, f.y, f.z); W.sun.position.set(f.x + W.sun.userData.dx, f.y + W.sun.userData.dy, f.z + W.sun.userData.dz); W.sun.target.updateMatrixWorld();
  }
  if (player && (state === "race" || state === "count" || state === "finish")) hud(dt); else if (state === "free") hudFree();
  { const on = player && (state === "race" || state === "free" || state === "finish"), v = on ? clamp((player.speed * 3.6 - 130) / 170, 0, 1) * .75 + (player.boostT > 0 ? .35 : 0) : 0, r = Math.round(Math.min(1, v) * 20) / 20;
    if (r !== fxS) { fxS = r; $("#fxSpd").style.opacity = r; } const nt = on && player.boostT > 0; if (nt !== fxN) { fxN = nt; document.body.classList.toggle("nit", nt); } }
  A.audioFrame(player, state === "race" || state === "finish" || state === "free" ? true : (state === "count" ? "idle" : false));
  renderer.render(scene, camera);
  if (interp) restoreInterp();
  // динамічна роздільність
  if (state === "race" || state === "free") {
    if (performance.now() < fpsHold) { fpsAcc = fpsN = 0; }
    else { fpsAcc += dt; fpsN++; if (fpsN >= 40) { const avg = fpsAcc / fpsN; fpsAcc = fpsN = 0; if (fpsCool > 0) fpsCool--; else if (avg > 1 / 45 && prScale > .6) { prScale *= .88; applySize(); fpsCool = 3; } else if (avg < 1 / 57 && prScale < 1) { prScale = Math.min(1, prScale / .88); applySize(); fpsCool = 3; } } }
  }

}

document.addEventListener("visibilitychange", () => { if (document.hidden && (state === "race" || state === "free")) { prevState = state; state = "paused"; show("sPause"); } });

/* ---------------- запуск ---------------- */
async function boot() {
  applySize(); document.body.classList.toggle("auto", S.auto); document.body.classList.toggle("tilt", S.tilt);
  if (S.tilt) enableTilt();
  $("#ver").textContent = "v" + BUILD; checkUpdate();
  A.setSound(S.sound);
  await loadTrack(clamp(S.last | 0, 0, TRACK_DEFS.length - 1));
  $("#loadTxt").textContent = "Завантаження машин…"; await ensureCar(S.car);
  spawn("demo"); state = "menu"; updCoins(); show("sMain");
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && state === "menu") location.reload(); });
  }
}
requestAnimationFrame(frame);
boot().then(async () => { for (const id of Object.keys(MODEL_FILE)) await ensureCar(id); });

/* ---- налагодження/тест ---- */
window.__g = {
  get state() { return state; }, get player() { return player; }, get cars() { return cars; }, get T() { return T; }, get scene() { return scene; },
  advance(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { if (state === "count") { countT -= STEP; if (countT <= 1) { state = "race"; raceT = 0; } } physStep(STEP); if (i % 30 === 0) rubber(); if (state === "finish") { finishTimer -= STEP; if (finishTimer <= 0) { showResults(); break; } } } syncAll(.016); },
  setBot(v) { bot = v; }, snap() { snapCamera(); camera.fov = camFov = 60; camera.updateProjectionMatrix(); }, startRace, startFree, loadTrack, setCam(m) { camMode = m; }, get raceT() { return raceT; }, enterGarage, place: () => racePlace(player)
};
