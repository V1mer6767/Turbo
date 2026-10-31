/* Фізичний синтез двигуна: гармоніки робочого циклу (720°) зі спектром, що залежить від порядку запалювання,
   резонанси вихлопу, шум згоряння/впуску, турбіна (свист, стравлювання), постріли при скиданні газу, відсічка. */
const K = 56;
class Engine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rpm", defaultValue: 800, minValue: 0, maxValue: 14000, automationRate: "k-rate" },
      { name: "thr", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "gain", defaultValue: 0, minValue: 0, maxValue: 2, automationRate: "k-rate" }
    ];
  }
  constructor() {
    super();
    this.cfg = null; this.ph = 0; this.ph2 = 0;
    this.A = new Float32Array(K + 1); this.Ps = new Float32Array(K + 1); this.mag = new Float32Array(K + 1); this.psi = new Float32Array(K + 1);
    this.jit = new Float32Array(K + 1); this.thrS = 0; this.spool = 0; this.prevThr = 0; this.rpmS = 800;
    this.pop = 0; this.popT = 0; this.blow = 0; this.cn = 0; this.lp1 = 0; this.lp2 = 0; this.bp1 = 0; this.bp2 = 0; this.lim = 0; this.wob = 0; this.t = 0; this.liftT = 0; this.turbPh = 0;
    this.port.onmessage = e => { if (e.data && e.data.cfg) this.setCfg(e.data.cfg); };
  }
  setCfg(c) {
    this.cfg = c;
    // спектр одного циклу з порядку запалювання: P_k = |Σ a_i e^{-j2πkθ_i}|
    const n = c.fire.length;
    for (let k = 1; k <= K; k++) {
      let re = 0, im = 0, sa = 0;
      for (let i = 0; i < n; i++) { const a = c.fire[i][1], th = c.fire[i][0]; re += a * Math.cos(2 * Math.PI * k * th); im -= a * Math.sin(2 * Math.PI * k * th); sa += Math.abs(a); }
      this.mag[k] = Math.hypot(re, im) / sa; this.psi[k] = Math.atan2(im, re);
    }
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0], c = this.cfg; if (!out) return true;
    const sr = sampleRate, N = out.length;
    if (!c) { out.fill(0); return true; }
    const rpmT = params.rpm[0], thrT = params.thr[0], gain = params.gain[0], dtb = N / sr;
    // згладжування
    this.rpmS += (rpmT - this.rpmS) * Math.min(1, dtb * 14);
    this.wob += ((Math.random() - .5) * 2 - this.wob) * Math.min(1, dtb * 3);
    const idleW = this.rpmS < c.idle * 1.3 ? 1 : 0;
    const rpm = this.rpmS + this.wob * (idleW ? 22 : 6);
    this.thrS += (thrT - this.thrS) * Math.min(1, dtb * (thrT > this.thrS ? 12 : 6));
    const thr = this.thrS;
    const rn = Math.min(1, Math.max(0, (rpm - c.idle) / (c.red - c.idle)));
    // турбіна
    const want = c.turbo ? thr * Math.min(1, rn * 1.5) : 0;
    this.spool += (want - this.spool) * Math.min(1, dtb * (want > this.spool ? 1.6 : 2.2));
    if (c.turbo && this.prevThr > .6 && thrT < .25 && this.spool > .45) this.blow = this.spool;
    // постріли при скиданні газу
    if (thrT < .15 && this.prevThr >= .5) this.liftT = .9;
    this.prevThr = thrT;
    this.liftT = Math.max(0, this.liftT - dtb);
    // відсічка
    const limiting = thr > .5 && rpm > c.red * .985;
    // амплітуди гармонік (на блок)
    const f0 = rpm / 120; // частота робочого циклу, Гц
    const fc = c.fc * (.55 + .75 * thr) * (.8 + .5 * rn);
    let pw = 0;
    const A = this.A;
    for (let k = 1; k <= K; k++) {
      const f = k * f0;
      if (f > sr * .42) { A[k] = 0; continue; }
      let s = 1 / Math.pow(1 + (f / fc) * (f / fc), c.roll);
      for (const r of c.res) { const d = (f - r[0]) / r[2]; s += r[1] * Math.exp(-d * d); }
      this.jit[k] += ((Math.random() - .5) * .5 - this.jit[k]) * Math.min(1, dtb * 8);
      const target = this.mag[k] * s * (1 + c.rough * this.jit[k]);
      A[k] += (target - A[k]) * .35; pw += A[k] * A[k];
    }
    const norm = .55 / Math.sqrt(pw + 1e-6);
    const load = (.34 + .66 * thr) * (.6 + .4 * rn);
    const fireHz = f0 * c.fire.length;
    const g0 = gain * load * norm;
    const turbF = 1800 + 6500 * this.spool, wbBlow = this.blow;
    const cutHz = 17;
    for (let i = 0; i < N; i++) {
      this.ph += f0 / sr; if (this.ph >= 1) this.ph -= 1;
      const w = 6.283185307 * this.ph;
      let y = 0;
      for (let k = 1; k <= K; k++) { const a = A[k]; if (a > 1e-4) y += a * Math.sin(k * w + this.psi[k]); }
      y *= g0;
      // шум згоряння: у такт запалювання
      this.ph2 += fireHz / 240 / sr * 2; // fireHz/ (rpm-cycle) -> фаза запалювань
      const fp = (this.ph * c.fire.length) % 1;
      const env = Math.pow(Math.max(0, Math.cos((fp - .12) * 6.2832 * .8)), 3);
      const nz = Math.random() * 2 - 1;
      this.lp1 += (nz - this.lp1) * .22;
      y += this.lp1 * env * c.comb * (.25 + thr) * gain * .5;
      // впуск
      this.bp1 += (nz - this.bp1) * (.08 + rn * .12); this.bp2 += (this.bp1 - this.bp2) * .3;
      y += (this.bp1 - this.bp2) * c.intake * thr * (.4 + rn) * gain * 2.2;
      // турбіна: свист + шум
      if (c.turbo && this.spool > .02) {
        this.turbPh += turbF / sr; if (this.turbPh > 1) this.turbPh -= 1;
        y += Math.sin(6.2831853 * this.turbPh) * c.turbo * this.spool * .35 * gain;
        y += (nz - this.bp1) * .01 * this.spool * gain;
      }
      if (wbBlow > .01) { y += ((nz - this.lp2) * .6) * this.blow * .18 * gain; this.lp2 += (nz - this.lp2) * .3; this.blow *= .99985; }
      // постріли
      if (this.liftT > 0 && c.pops && rn > .3) {
        if (Math.random() < c.pops * dtb / N * 22) this.pop = 1;
      }
      if (this.pop > .002) { y += (this.lp1 * 1.5 + Math.sin(this.t * 620) * .5) * this.pop * .55 * gain; this.pop *= .9985; }
      // відсічка
      if (limiting) { this.lim += cutHz / sr; if (this.lim > 1) this.lim -= 1; if (this.lim > .62) y *= .15; }
      this.t += 1 / sr;
      // м'яке обмеження
      const v = y; out[i] = Math.tanh(v * 1.3) * .8;
    }
    return true;
  }
}
registerProcessor("engine", Engine);
