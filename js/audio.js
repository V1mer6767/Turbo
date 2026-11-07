/* Простий синтез звуку: двигун, дрифт, вітер, удари, сигнали */
let AC = null, on = true, eng = {}, nz = {}, wind = {};
export function setSound(v) { on = v; if (AC) master.gain.value = v ? 1 : 0; }
let master;

/* характер двигуна кожної машини (порядок запалювання, резонанси вихлопу, турбіна) */
const alt = (n, w, pat) => Array.from({ length: n }, (_, i) => [i / n, 1 + w * pat[i % pat.length]]);
const ENG = {
  city: { idle: 650, red: 7200, fc: 520, roll: 1.4, res: [[110, 1.3, 70], [240, .9, 120], [520, .35, 200]], comb: .35, intake: .06, rough: .5, turbo: 0, pops: .5,
    fire: alt(8, .55, [1, -1, -1, 1, -1, -1, 1, 1]) },               // V8 twin-turbo, хрест. колінвал — бурчання
  sport: { idle: 780, red: 7200, fc: 700, roll: 1.2, res: [[60, 1.6, 35], [100, 1.8, 45], [150, 1.4, 55], [240, .9, 80], [400, .4, 120], [700, .1, 200]], comb: .4, intake: .05, rough: .55, turbo: 0, pops: .55, drive: 4, lp: .3, pk: .25, pipe: [[1.9, .3], [3.6, .1]],
    fire: [[0, 1], [1 / 6, .5], [2 / 6, 1.4], [3 / 6, .6], [4 / 6, 1.3], [5 / 6, .7]] },   // рядна шістка S58: щільне гарчання, багато обертонів
  muscle: { idle: 800, red: 8000, fc: 600, roll: 1.3, res: [[130, 1.2, 80], [300, 1, 140], [700, .5, 260]], comb: .45, intake: .08, rough: .6, turbo: 0, pops: .8,
    fire: alt(8, .45, [1, -1, -1, 1, -1, -1, 1, 1]) },
  gt: { idle: 900, red: 9000, fc: 1100, roll: 1.1, res: [[100, .5, 60], [250, .5, 100], [500, .4, 160], [1000, .3, 300]], comb: .5, intake: .06, rough: 1, turbo: 0, drive: 1.6, lp: .5, pk: .5, pops: .6,
    fire: [[-0.0038,1.084],[0.1173,0.952],[0.1673,1.122],[0.2248,1.017],[0.3437,1.41],[0.3842,0.725],[0.4673,1.434],[0.5988,0.359],[0.7052,1.651],[0.7623,1.162],[0.8059,0.321],[0.9189,0.383]] },
  hyper: { idle: 1000, red: 8600, fc: 1100, roll: 1.15, res: [[100, .5, 60], [250, .5, 100], [500, .4, 160], [1000, .3, 300]], comb: .5, intake: .07, rough: 1, turbo: 0, drive: 1.6, lp: .5, pk: .5, pops: .6,
    fire: [[-0.0148,0.622],[0.1081,0.398],[0.2713,0.861],[0.4027,0.841],[0.5366,1.486],[0.585,0.594],[0.7828,0.958],[0.9134,0.856]] },
};
ENG.p930 = Object.assign({}, ENG.sport, { idle: 850, red: 6800, roll: 1.2, fire: [[0,1],[1/6,.55],[2/6,1.3],[3/6,.7],[4/6,1.2],[5/6,.65]] });   // оппозитна шістка
ENG.f40 = Object.assign({}, ENG.gt, { idle: 1000, red: 7800, roll: 1.1, fire: [[0,1],[.12,.6],[.26,1.3],[.37,.7],[.5,1.2],[.62,.65],[.76,1.35],[.88,.7]] });   // twin-turbo V8
ENG.huracan = Object.assign({}, ENG.hyper, { idle: 900, red: 8400, roll: 1.1, fire: [[0.0000,1],[0.1040,0.6],[0.1940,1.3],[0.3050,0.7],[0.3960,1.2],[0.5060,0.65],[0.5950,1.35],[0.7040,0.75],[0.7940,1.1],[0.9050,0.7]] });   // V10: щільний, високий, злий
export function audioInit() {
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = on ? 1 : 0; master.connect(AC.destination);
    const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 1.5;
    eng.o1 = AC.createOscillator(); eng.o1.type = "sawtooth"; eng.o2 = AC.createOscillator(); eng.o2.type = "square"; eng.o3 = AC.createOscillator(); eng.o3.type = "triangle";
    eng.g = AC.createGain(); eng.g.gain.value = 0; eng.lp = lp;
    const g1 = AC.createGain(), g2 = AC.createGain(), g3 = AC.createGain(); g1.gain.value = .5; g2.gain.value = .18; g3.gain.value = .5;
    eng.o1.connect(g1); eng.o2.connect(g2); eng.o3.connect(g3); g1.connect(lp); g2.connect(lp); g3.connect(lp); lp.connect(eng.g); eng.g.connect(master);
    eng.o1.start(); eng.o2.start(); eng.o3.start();
    const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    nz.buf = buf;
    const mk = (freq, q) => { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; const f = AC.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q; const g = AC.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start(); return { s, f, g }; };
    nz.skid = mk(1700, 3); wind = mk(500, .6);
    if (AC.audioWorklet && window.AudioWorkletNode) AC.audioWorklet.addModule("js/engine-worklet.js").then(() => {
      eng.node = new AudioWorkletNode(AC, "engine", { numberOfInputs: 0, outputChannelCount: [1] });
      eng.node.connect(master); eng.car = null;
    }).catch(() => {});
  } catch (e) { AC = null; }
}
export function audioFrame(p, racing) {
  if (!AC) return;
  const t = AC.currentTime;
  if (!p || !racing) { if (eng.node) eng.node.parameters.get("gain").value = 0; eng.g.gain.setTargetAtTime(racing === "idle" ? .05 : 0, t, .1); nz.skid.g.gain.setTargetAtTime(0, t, .1); wind.g.gain.setTargetAtTime(0, t, .2); return; }
  const spec = p.spec;
  if (eng.node) {
    const cfg = ENG[spec.id] || ENG.city;
    if (eng.car !== spec.id) { eng.car = spec.id; eng.node.port.postMessage({ cfg }); }
    const rn = Math.max(0, (p.rpmSnd - .28) / .72), pm = eng.node.parameters;
    pm.get("rpm").value = (cfg.idle + rn * (cfg.red - cfg.idle)) * (p.boostT > 0 ? 1.03 : 1);
    pm.get("thr").value = p.thr ? 1 : 0;
    pm.get("gain").value = (racing === "idle" ? .6 : 1) * (p.boostT > 0 ? 1.15 : 1);
    eng.g.gain.setTargetAtTime(0, t, .03);
    const sk2 = clamp01((p.slip - 4) / 12) * (p.speed > 8 ? 1 : 0) + (p.off ? .3 * clamp01(p.speed / 20) : 0);
    nz.skid.g.gain.setTargetAtTime(sk2 * .11, t, .05); nz.skid.f.frequency.setTargetAtTime(p.off ? 500 : 1500 + p.slip * 40, t, .05);
    wind.g.gain.setTargetAtTime(clamp01(p.speed / 80) * .09, t, .1); wind.f.frequency.setTargetAtTime(300 + p.speed * 8, t, .1);
    return;
  }
  const f = (38 + p.rpmSnd * 130) * spec.snd;
  eng.o1.frequency.setTargetAtTime(f, t, .04); eng.o2.frequency.setTargetAtTime(f * .5, t, .04); eng.o3.frequency.setTargetAtTime(f * 2, t, .04);
  eng.lp.frequency.setTargetAtTime(500 + p.rpmSnd * 1700 * (p.boostT > 0 ? 1.3 : 1), t, .05);
  eng.g.gain.setTargetAtTime(.1 + (p.thr ? .13 : .03) + p.rpmSnd * .05 + (p.boostT > 0 ? .04 : 0), t, .05);
  const sk = clamp01((p.slip - 4) / 12) * (p.speed > 8 ? 1 : 0) + (p.off ? .3 * clamp01(p.speed / 20) : 0);
  nz.skid.g.gain.setTargetAtTime(sk * .11, t, .05); nz.skid.f.frequency.setTargetAtTime(p.off ? 500 : 1500 + p.slip * 40, t, .05);
  wind.g.gain.setTargetAtTime(clamp01(p.speed / 80) * .09, t, .1); wind.f.frequency.setTargetAtTime(300 + p.speed * 8, t, .1);
}
const clamp01 = v => Math.max(0, Math.min(1, v));
export function beep(freq = 660, dur = .15, vol = .18) {
  if (!AC) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = "square"; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
}
export function thud(v = 1) {
  if (!AC || !nz.buf) return; const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = nz.buf; const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 400 + v * 600;
  const g = AC.createGain(); g.gain.setValueAtTime(.3 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .35); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + .4);
}
