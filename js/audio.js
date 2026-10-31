/* Простий синтез звуку: двигун, дрифт, вітер, удари, сигнали */
let AC = null, on = true, eng = {}, nz = {}, wind = {};
export function setSound(v) { on = v; if (AC) master.gain.value = v ? 1 : 0; }
let master;

/* характер двигуна кожної машини (порядок запалювання, резонанси вихлопу, турбіна) */
const alt = (n, w, pat) => Array.from({ length: n }, (_, i) => [i / n, 1 + w * pat[i % pat.length]]);
const ENG = {
  city: { idle: 650, red: 7200, fc: 520, roll: 1.4, res: [[110, 1.3, 70], [240, .9, 120], [520, .35, 200]], comb: .35, intake: .06, rough: .5, turbo: 0, pops: .5,
    fire: alt(8, .55, [1, -1, -1, 1, -1, -1, 1, 1]) },               // V8 twin-turbo, хрест. колінвал — бурчання
  sport: { idle: 780, red: 7200, fc: 520, roll: 1.75, res: [[85, 1.3, 55], [210, 1.1, 100], [460, .65, 190], [880, .3, 280]], comb: .3, intake: .04, rough: .4, turbo: 0, pops: .35,
    fire: [[0, 1], [1 / 6, .94], [2 / 6, 1.06], [3 / 6, .95], [4 / 6, 1.05], [5 / 6, .97]] },   // рядна шістка S58: глибоке, щільне гарчання без свисту
  muscle: { idle: 800, red: 8000, fc: 600, roll: 1.3, res: [[130, 1.2, 80], [300, 1, 140], [700, .5, 260]], comb: .45, intake: .08, rough: .6, turbo: 0, pops: .8,
    fire: alt(8, .45, [1, -1, -1, 1, -1, -1, 1, 1]) },
  gt: { idle: 900, red: 8800, fc: 1300, roll: 1.1, res: [[500, .9, 200], [1100, 1, 300], [2300, .5, 600]], comb: .3, intake: .06, rough: .15, turbo: 0, pops: .25,
    fire: Array.from({ length: 12 }, (_, i) => [i / 12, 1 + .04 * ((i * 7) % 5 - 2) / 2]) },  // атмосферний V12 — високий крик
  hyper: { idle: 1000, red: 8000, fc: 1000, roll: 1.15, res: [[400, .8, 150], [900, 1, 250], [1900, .8, 450]], comb: .5, intake: .07, rough: .35, turbo: 0, pops: .6,
    fire: alt(8, .3, [1, -1]) }                                         // V8 плоский колінвал — рваний вереск
};
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
