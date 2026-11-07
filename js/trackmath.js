/* Геометрія траси без THREE: центральна лінія, висоти, пошук найближчої точки */
const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

export const TRACK_DEFS = [
  { id: "forest", name: "Forest Track", sub: "Fast corners, gentle terrain", theme: "day", diff: 1, R: 340, sx: 1.4, sy: 1, w: 14, aiMax: 50,
    f: t => 1 + .16 * Math.sin(2 * t) + .09 * Math.sin(3 * t + 1) + .03 * Math.sin(5 * t), elev: t => 7 * Math.sin(2 * t + .5) + 3 * Math.sin(3 * t) },
  { id: "canyon", name: "Western Canyon", sub: "Desert, long arcs and hills", theme: "sunset", diff: 2, R: 360, sx: 1.2, sy: 1, w: 13, aiMax: 56,
    f: t => 1 + .17 * Math.sin(3 * t) + .07 * Math.sin(5 * t + .5), elev: t => 11 * Math.sin(t + 1) + 5 * Math.sin(2 * t) },
  { id: "glacier", name: "Glacier", sub: "Snow, hairpins and fast sections", theme: "snow", diff: 3, R: 380, sx: 1.3, sy: 1, w: 13, aiMax: 63,
    f: t => 1 + .2 * Math.sin(2 * t) + .1 * Math.sin(4 * t + 1) + .035 * Math.sin(7 * t), elev: t => 8 * Math.sin(2 * t) + 2 * Math.sin(5 * t + 1) },
  { id: "night", name: "Night City", sub: "Dark, technical, lots of turns", theme: "night", diff: 4, R: 400, sx: 1.1, sy: 1, w: 12, aiMax: 70,
    f: t => 1 + .15 * Math.sin(4 * t) + .05 * Math.sin(7 * t + 2) + .07 * Math.sin(3 * t), elev: t => 6 * Math.sin(3 * t) + 4 * Math.sin(t + 2) },
  { id: "speedway", name: "Speedway", sub: "Wide, fast, long straights", theme: "day", diff: 2, R: 320, sx: 1.6, sy: .9, w: 16, aiMax: 58,
    f: t => 1 + .13 * Math.sin(2 * t) + .07 * Math.sin(4 * t + .8) + .03 * Math.sin(6 * t), elev: t => 2.5 * Math.sin(2 * t) + 1.5 * Math.sin(3 * t + 1) },
  { id: "serpent", name: "Serpentine", sub: "Sunset, mountains and linked turns", theme: "sunset", diff: 3, R: 350, sx: 1.2, sy: 1, w: 12, aiMax: 60,
    f: t => 1 + .13 * Math.sin(5 * t) + .08 * Math.sin(3 * t + 1) + .035 * Math.sin(8 * t), elev: t => 11 * Math.sin(t) + 4 * Math.sin(3 * t + 1) },
  { id: "marathon", name: "Winter Marathon", sub: "Long snowy lap with smooth arcs", theme: "snow", diff: 2, R: 430, sx: 1.7, sy: .85, w: 14, aiMax: 58,
    f: t => 1 + .1 * Math.sin(3 * t) + .06 * Math.sin(5 * t + 2) + .03 * Math.sin(2 * t), elev: t => 5 * Math.sin(2 * t + 1) + 3 * Math.sin(5 * t) },
  { id: "neon", name: "Neon Circuit", sub: "Night, fast corner combinations", theme: "night", diff: 3, R: 370, sx: 1.25, sy: 1, w: 13, aiMax: 66,
    f: t => 1 + .13 * Math.sin(2 * t) + .09 * Math.sin(5 * t) + .04 * Math.sin(9 * t + 1), elev: t => 4 * Math.sin(2 * t) + 3 * Math.sin(4 * t + 2) }
];

/* Побудова центральної лінії: рівномірний крок ~6 м, замкнена */
export function buildCenterline(def) {
  const N = 64, sub = 20, cp = [];
  for (let i = 0; i < N; i++) {
    const th = i / N * TAU, r = def.R * def.f(th);
    cp.push([r * Math.cos(th) * def.sx, r * Math.sin(th) * def.sy]);
  }
  const dx = [], dz = [], du = [];
  for (let i = 0; i < N; i++) {
    const p0 = cp[(i + N - 1) % N], p1 = cp[i], p2 = cp[(i + 1) % N], p3 = cp[(i + 2) % N];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const cr = j => .5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      dx.push(cr(0)); dz.push(cr(1)); du.push((i + t) / N);
    }
  }
  const D = dx.length, cum = [0];
  for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + Math.hypot(dx[i % D] - dx[i - 1], dz[i % D] - dz[i - 1]));
  const L = cum[D], M = Math.round(L / 6), step = L / M;
  const x = new Float32Array(M), z = new Float32Array(M), h = new Float32Array(M);
  let j = 0;
  for (let i = 0; i < M; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1), a = j % D, b = (j + 1) % D;
    x[i] = lerp(dx[a], dx[b], t); z[i] = lerp(dz[a], dz[b], t);
    let u0 = du[a], u1 = du[b]; if (u1 < u0) u1 += 1;
    h[i] = def.elev(lerp(u0, u1, t) * TAU);
  }
  // згладжування висот (прибираємо різкі зломи)
  for (let it = 0; it < 3; it++) { const c = Float32Array.from(h); for (let i = 0; i < M; i++) h[i] = (c[(i + M - 1) % M] + 2 * c[i] + c[(i + 1) % M]) / 4; }
  const tx = new Float32Array(M), tz = new Float32Array(M), nx = new Float32Array(M), nz = new Float32Array(M), curv = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const a = (i + M - 1) % M, b = (i + 1) % M, ex = x[b] - x[a], ez = z[b] - z[a], l = Math.hypot(ex, ez);
    tx[i] = ex / l; tz[i] = ez / l; nx[i] = -tz[i]; nz[i] = tx[i]; // нормаль праворуч за ходом
  }
  for (let i = 0; i < M; i++) { const b = (i + 1) % M; curv[i] = Math.abs(angDiff(Math.atan2(tz[i], tx[i]), Math.atan2(tz[b], tx[b]))) / step; } // 1/м
  return { def, M, step, length: L, x, z, h, tx, tz, nx, nz, curv, halfW: def.w / 2 };
}

/* Найближча точка траси; hint — попередній індекс (швидкий локальний пошук) */
export function nearest(T, px, pz, hint, out) {
  const { M, x, z } = T;
  let best = 1e18, bi = 0;
  const lim = 40, win = 14;
  if (hint >= 0) {
    for (let d = -win; d <= win; d++) { const i = (hint + d + M) % M, ex = px - x[i], ez = pz - z[i], q = ex * ex + ez * ez; if (q < best) { best = q; bi = i; } }
  }
  if (hint < 0 || best > lim * lim) {
    best = 1e18;
    for (let i = 0; i < M; i++) { const ex = px - x[i], ez = pz - z[i], q = ex * ex + ez * ez; if (q < best) { best = q; bi = i; } }
  }
  // проєкція на дотичну для плавної висоти й бокового зсуву
  const ex = px - x[bi], ez = pz - z[bi];
  const s = ex * T.tx[bi] + ez * T.tz[bi];
  const lat = ex * T.nx[bi] + ez * T.nz[bi];
  let i0 = bi, t = 0;
  if (s >= 0) { i0 = bi; t = clamp(s / T.step, 0, 1); }
  else { i0 = (bi - 1 + M) % M; t = clamp(1 + s / T.step, 0, 1); }
  const i1 = (i0 + 1) % M;
  out.idx = bi; out.lat = lat; out.dist = Math.abs(lat); out.s = s;
  out.h = lerp(T.h[i0], T.h[i1], t);
  return out;
}

/* Висота рельєфу в довільній точці. Біля дороги — рівно висота дороги, далі пагорби */
export function hills(x, z, amp) {
  return amp * (.55 * Math.sin(x * .0042 + 1.3) * Math.cos(z * .0036) + .3 * Math.sin(x * .011 + z * .008 + 2) + .15 * Math.sin(x * .027 - z * .021)) + amp * .3;
}
export function groundH(T, x, z, near, amp) {
  const d = Math.max(0, near.dist - T.halfW - 7);
  const k = smooth(0, 75, d);
  return lerp(near.h, hills(x, z, amp) + near.h * .25, k);
}
