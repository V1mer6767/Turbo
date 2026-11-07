/* Графіка: постобробка (MSAA + AO + bloom + лінза), дощ, мокра дорога, фари */
import * as THREE from "../vendor/three.module.min.js";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../vendor/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { BokehPass } from "../vendor/jsm/postprocessing/BokehPass.js";
import { GTAOPass } from "../vendor/jsm/postprocessing/GTAOPass.js";

/* пресети: pr — множник роздільності, post — постобробка, ms — MSAA, bloom, ao, mb — розмиття руху, ca — хроматична аберація, rain — к-сть крапель */
export const QUAL = {
  low: { pr: 1, shadow: 0, trees: 450, terrainCell: 10, treeShadow: false, aniso: 2, post: 0, rain: 500, shake: 0 },
  mid: { pr: 1.15, shadow: 1024, trees: 1000, terrainCell: 8, treeShadow: false, aniso: 4, post: 0, rain: 1100, shake: .6 },
  high: { pr: 1.6, shadow: 2048, trees: 1700, terrainCell: 6, treeShadow: true, aniso: 8, post: 1, ms: 0, bloom: .28, ao: 0, mb: .5, ca: .5, rain: 2000, shake: 1, grade: 1 },
  ultra: { pr: 2, shadow: 3072, trees: 2200, terrainCell: 5, treeShadow: true, aniso: 16, post: 1, ms: 4, bloom: .36, ao: 0, mb: .9, ca: .8, rain: 3000, shake: 1, grade: 1 },
  extreme: { pr: 2, shadow: 4096, trees: 2600, terrainCell: 4, treeShadow: true, aniso: 16, post: 1, ms: 4, bloom: .5, ao: 1, mb: 1.3, ca: 1.1, rain: 4200, shake: 1.2, dof: 1, grade: 1 }
};
export const QUAL_LIST = [["low", "Low"], ["mid", "Medium"], ["high", "High"], ["ultra", "Ultra"], ["extreme", "Extreme"]];

const LensShader = {
  defines: { SAMPLES: 8 },
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 }, uMB: { value: 1 }, uCA: { value: 1 }, uT: { value: 0 }, uAsp: { value: 1.7 }, uVig: { value: .32 }, uGrade: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uSpeed,uMB,uCA,uT,uAsp,uVig,uGrade;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c=vec2(.5,.52); vec2 d=vUv-c; float r=length(d*vec2(uAsp,1.));
      float edge=smoothstep(.12,.85,r);
      float bl=uSpeed*uMB*.055*edge;            // розмиття руху від центру: тільки на швидкості, на краях
      float ca=(.0016+uSpeed*.0016)*uCA*edge;    // хроматична аберація на краях
      vec3 col=vec3(0.);
      for(int i=0;i<SAMPLES;i++){ float k=float(i)/float(SAMPLES-1); vec2 o=d*bl*k;
        col.r+=texture2D(tDiffuse,vUv-o+d*ca).r; col.g+=texture2D(tDiffuse,vUv-o).g; col.b+=texture2D(tDiffuse,vUv-o-d*ca).b; }
      col/=float(SAMPLES);
      col*=1.-uVig*smoothstep(.5,1.25,r);        // віньєтка
      float lum=dot(col,vec3(.2126,.7152,.0722));
      col=mix(vec3(lum),col,1.+.1*uGrade);                       // колір-грейдинг: легка насиченість
      col*=mix(vec3(1.),vec3(1.035,1.,.955),.6*uGrade*smoothstep(.2,1.,lum)); // тепліші світла
      col*=mix(vec3(1.),vec3(.96,1.,1.04),.6*uGrade*(1.-smoothstep(0.,.35,lum))); // холодніші тіні
      col+=(hash(vUv*1234.5+uT)-.5)*.012;         // легке зерно плівки
      gl_FragColor=vec4(col,1.);
    }`
};

export class Post {
  constructor(renderer) { this.r = renderer; this.c = null; this.key = ""; this.lens = null; this.cfgName = ""; }
  dispose() { if (this.c) { try { this.c.renderTarget1.dispose(); this.c.renderTarget2.dispose(); this.c.passes.forEach(p => p.dispose && p.dispose()); } catch (e) {} } this.c = null; this.lens = null; this.key = ""; }
  /* повертає true, якщо малюємо через композер */
  render(name, scene, camera, dt, speed01, t, dof) {
    name = QUAL[name] ? name : (name === "cinematic" ? "extreme" : "mid"); const q = QUAL[name];
    if (!q.post) { if (this.c) this.dispose(); return false; }
    const r = this.r, w = r.domElement.clientWidth || r.domElement.width, h = r.domElement.clientHeight || r.domElement.height, pr = r.getPixelRatio();
    const key = name + "|" + w + "x" + h + "|" + pr.toFixed(3);
    if (!this.c || this.key !== key || this.scene !== scene) this.build(name, q, scene, camera, w, h, pr, key);
    else if (this.rp.camera !== camera) { this.rp.camera = camera; }
    const U = this.lens.uniforms; U.uSpeed.value = speed01; U.uT.value = t % 100; U.uAsp.value = w / h;
    if (this.dofPass) { this.dofPass.enabled = dof > 0; if (dof > 0) { this.dofPass.uniforms.focus.value = dof; } }
    this.c.render(dt);
    return true;
  }
  build(name, q, scene, camera, w, h, pr, key) {
    this.dispose();
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.ms || 0 });
    const c = new EffectComposer(this.r, rt); c.setPixelRatio(pr); c.setSize(w, h);
    this.rp = new RenderPass(scene, camera); c.addPass(this.rp);
    if (q.ao) {
      try {
        const ao = new GTAOPass(scene, camera, w * pr, h * pr); ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = .85;
        ao.updateGtaoMaterial({ radius: .9, distanceExponent: 1.2, thickness: 1.2, scale: 1, samples: 10, distanceFallOff: 1, screenSpaceRadius: false });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 10 });
        c.addPass(ao);
      } catch (e) { console.warn("GTAO off", e); }
    }
    this.dofPass = null;
    if (q.dof) { try { this.dofPass = new BokehPass(scene, camera, { focus: 6.6, aperture: .00018, maxblur: .006 }); this.dofPass.enabled = false; c.addPass(this.dofPass); } catch (e) { console.warn('DOF off', e); } }
    if (q.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(w * pr / 2, h * pr / 2), q.bloom, .55, 1.0));
    const lens = new ShaderPass(LensShader); lens.material.defines.SAMPLES = q.mb > 1 ? 10 : 7;
    lens.uniforms.uMB.value = q.mb; lens.uniforms.uGrade.value = q.grade || 0; lens.uniforms.uCA.value = q.ca; c.addPass(lens);
    c.addPass(new OutputPass());
    this.c = c; this.lens = lens; this.key = key; this.scene = scene; this.cfgName = name;
  }
}

/* ---------------- дощ: смужки навколо камери, анімація на GPU ---------------- */
export class Rain {
  constructor(n) {
    const pos = new Float32Array(n * 6), seed = new Float32Array(n * 6), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const a = Math.random(), b = Math.random(), c = Math.random(); for (let k = 0; k < 2; k++) { seed.set([a, b, c], i * 6 + k * 3); end[i * 2 + k] = k; } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3)); g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    this.u = { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -16, 0) }, uT: { value: 0 }, uA: { value: .32 }, uCol: { value: new THREE.Color(.78, .84, .95) } };
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: this.u,
      vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform vec3 uCam,uVel; uniform float uT; varying float vA;
        void main(){ vec3 box=vec3(46.,30.,46.); vec3 w=aSeed*box+vec3(0.,-16.,0.)*uT*0.+ (vec3(0.,-16.,0.))*uT;
          vec3 p=uCam+mod(w-uCam,box)-box*.5; vec3 dir=normalize(uVel); p-=dir*(aEnd*(.5+aSeed.x*.5)*(.6+length(uVel)*.035));
          vA=1.-aEnd*.7; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.); }`,
      fragmentShader: "varying float vA; uniform float uA; uniform vec3 uCol; void main(){ gl_FragColor=vec4(uCol,uA*vA); }"
    });
    this.obj = new THREE.LineSegments(g, m); this.obj.frustumCulled = false; this.obj.renderOrder = 5;
  }
  update(t, cam, carVel) { this.u.uT.value = t; this.u.uCam.value.copy(cam); this.u.uVel.value.set(-carVel.x, -16 - 0, -carVel.z); }
  dispose() { this.obj.geometry.dispose(); this.obj.material.dispose(); }
}

/* мокра траса: нижча шорсткість, темніша, сильніші відблиски, похмуре освітлення і туман */
export function applyRain(W, on) {
  if (!on || !W) return;
  const th = W.th, sc = W.scene;
  sc.fog.color.lerp(new THREE.Color(.42, .46, .52), .75); sc.background = sc.fog.color.clone();
  sc.fog.near *= .25; sc.fog.far *= .45;
  if (W.sun) W.sun.intensity *= .45;
  if (W.hemi) { W.hemi.intensity *= .9; W.hemi.color.lerp(new THREE.Color(.6, .65, .72), .6); }
  const u = W.sky && W.sky.material.uniforms;
  if (u) { const grey = new THREE.Color(.36, .4, .46); u.top.value.lerp(grey, .8); u.hor.value.lerp(new THREE.Color(.55, .6, .66), .8); u.sunCol.value.multiplyScalar(.12); u.stars.value = 0; if (u.cover) { u.cover.value = .9; u.cb.value *= .7; } }
  const road = W.road && W.road.material;
  if (road) { road.roughness = Math.max(.12, road.roughness * .38); road.envMapIntensity = (road.envMapIntensity || 1) * 2.3; road.color.multiplyScalar(.62); road.needsUpdate = true; }
  sc.traverse(o => { if (o.isMesh && o.material && o !== W.road && o.material.isMeshStandardMaterial && !o.userData.keep && o.material.map && o.material.roughness > .8) { o.material = o.material.clone(); o.material.color.multiplyScalar(.7); o.material.roughness = .7; } });
}

/* фара-прожектор для машини гравця (ніч / дощ) */
export function addHeadlights(model, strong) {
  const L = new THREE.SpotLight(0xfff0d0, strong ? 520 : 260, 95, .42, .65, 1.2);
  L.position.set(1.2, .7, 0); L.target.position.set(24, -.4, 0);
  model.root.add(L, L.target); model.headL = L;
  return L;
}

/* краплі на склі/лінзі — 2D canvas поверх гри, тільки з кабіни і капота */
export class Drops {
  constructor(canvas) { this.cv = canvas; this.g = canvas.getContext("2d"); this.d = []; this.acc = 0; this.on = false; }
  size() { const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 400; if (this.cv.width !== (w >> 1) || this.cv.height !== (h >> 1)) { this.cv.width = w >> 1; this.cv.height = h >> 1; } }
  update(dt, vis, speed) {
    const cv = this.cv; if (!this.on || !vis) { if (this.d.length) { this.d.length = 0; this.g.clearRect(0, 0, cv.width, cv.height); } cv.style.opacity = 0; return; }
    cv.style.opacity = vis; this.acc += dt; if (this.acc < 1 / 24) return; const step = this.acc; this.acc = 0; this.size();
    const w = cv.width, h = cv.height, g = this.g;
    if (this.d.length < 70 && Math.random() < .7) this.d.push({ x: Math.random() * w, y: Math.random() * h * .9, r: 1.5 + Math.random() * 3.4, v: 0, life: 4 + Math.random() * 6 });
    g.clearRect(0, 0, w, h);
    for (let i = this.d.length - 1; i >= 0; i--) {
      const p = this.d[i]; p.life -= step; if (p.life <= 0) { this.d.splice(i, 1); continue; }
      if (p.r > 3 || speed > 30) { p.v += step * (8 + speed * .6) * (p.r / 4); p.y -= step * p.v * .35; p.x += Math.sin(p.y * .15 + i) * step * 6; p.r *= 1 - step * .08; }
      if (p.y < -8) { this.d.splice(i, 1); continue; }
      const a = Math.min(1, p.life) * .55, gr = g.createRadialGradient(p.x - p.r * .3, p.y - p.r * .3, p.r * .1, p.x, p.y, p.r);
      gr.addColorStop(0, `rgba(235,245,255,${a * .55})`); gr.addColorStop(.7, `rgba(150,175,200,${a * .22})`); gr.addColorStop(1, `rgba(20,30,40,${a * .4})`);
      g.fillStyle = gr; g.beginPath(); g.ellipse(p.x, p.y, p.r, p.r * (1 + Math.min(.7, p.v * .05)), 0, 0, 7); g.fill();
    }
  }
}

/* ---------------- PBR-асфальт: тайлова карта нормалей і шорсткості (процедурно, мікрозерно + тріщини) ---------------- */
export function asphaltMaps(aniso) {
  const N = 256, hgt = new Float32Array(N * N);
  const lat = (cells) => { const gsz = cells, v = new Float32Array(gsz * gsz).map(() => Math.random()); const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const fx = x / N * gsz, fy = y / N * gsz, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = v[(y0 % gsz) * gsz + x0 % gsz], b = v[(y0 % gsz) * gsz + (x0 + 1) % gsz], c = v[((y0 + 1) % gsz) * gsz + x0 % gsz], d = v[((y0 + 1) % gsz) * gsz + (x0 + 1) % gsz];
      out[y * N + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; }
    return out; };
  for (const [cells, wgt] of [[8, .5], [16, .35], [32, .5], [64, .6], [128, .7]]) { const l = lat(cells); for (let i = 0; i < N * N; i++) hgt[i] += l[i] * wgt; }
  for (let i = 0; i < N * N; i++) hgt[i] += Math.random() * .55;                        // зерно щебеню
  const crack = (x, y, a, n) => { for (let k = 0; k < n; k++) { for (let w = -1; w <= 1; w++) { const px = (((x | 0) + w) % N + N) % N, py = ((y | 0) % N + N) % N; hgt[py * N + px] -= w === 0 ? 1.4 : .5; } a += (Math.random() - .5) * .7; x += Math.cos(a); y += Math.sin(a); } };
  for (let i = 0; i < 3; i++) crack(Math.random() * N, Math.random() * N, Math.random() * 6.28, 70 + Math.random() * 120);
  const nd = new Uint8ClampedArray(N * N * 4), rd = new Uint8ClampedArray(N * N * 4), S = 2.1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], hy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    let nx = -hx * S, ny = -hy * S, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4; nd[o] = (nx * .5 + .5) * 255; nd[o + 1] = (ny * .5 + .5) * 255; nd[o + 2] = (nz * .5 + .5) * 255; nd[o + 3] = 255;
    const r = Math.max(.7, Math.min(1, .86 + (hgt[y * N + x] - 1.6) * .08)) * 255; rd[o] = rd[o + 1] = rd[o + 2] = r; rd[o + 3] = 255; }
  const mk = (data, srgb) => { const c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d"); g.putImageData(new ImageData(data, N, N), 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso || 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { normal: mk(nd), rough: mk(rd) };
}
