/* Простий синтез звуку: двигун, дрифт, вітер, удари, сигнали */
let AC = null, on = true, eng = {}, nz = {}, wind = {};
export function setSound(v) { on = v; if (AC) master.gain.value = v ? 1 : 0; }
let master;
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
  } catch (e) { AC = null; }
}
export function audioFrame(p, racing) {
  if (!AC) return;
  const t = AC.currentTime;
  if (!p || !racing) { eng.g.gain.setTargetAtTime(racing === "idle" ? .05 : 0, t, .1); nz.skid.g.gain.setTargetAtTime(0, t, .1); wind.g.gain.setTargetAtTime(0, t, .2); return; }
  const spec = p.spec, f = (38 + p.rpmSnd * 130) * spec.snd;
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
