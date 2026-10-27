// Path vocabulary for the silhouette layers (land.ts): ridges, dunes, cliffs, islands, buildings, trees, figures.
// Plate coordinates: logical px, y down, the frame is 0..1920 x 0..1080 (masks extend M px past it).
import { fbm1, noise1 } from '../engine/util';

type C = CanvasRenderingContext2D;
const X0 = -200, X1 = 2120, BOTTOM = 1300;

/** A mountain range: base height y0 (px from top), amplitude, horizontal scale, seed, sharpness (0 soft .. 1 jagged). */
export function ridge(c: C, y0: number, amp: number, scale: number, seed: number, sharp = 0.6, x0 = X0, x1 = X1) {
  c.beginPath();
  c.moveTo(x0, BOTTOM);
  for (let x = x0; x <= x1; x += 4) {
    const u = x / scale;
    // broad massifs, warped ridged octaves on top (peaks at irregular spacing), a little grit
    const warp = fbm1(u * 0.45 + seed * 3.7, 3, seed + 5) * 0.9;
    const mass = fbm1(u * 0.35 + seed * 1.3, 3, seed + 9) * 0.5 + 0.5;
    let rid = 0, a = 0.55, f = 1;
    for (let o = 0; o < 4; o++) {
      const n = 1 - Math.abs(noise1((u + warp) * f * 0.9 + seed * 11 + o * 3.1, seed + o));
      rid += a * n * n; a *= 0.48; f *= 2.13;
    }
    const grit = noise1(u * 14 + seed, seed + 3) * 0.025;
    const h = clamp01(lerp(mass * 0.8, rid * (0.45 + 0.7 * mass), sharp) + grit);
    c.lineTo(x, y0 - amp * h);
  }
  c.lineTo(x1, BOTTOM);
  c.closePath();
  c.fill();
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1.2 ? 1.2 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A fern (or a tree fern when `trunk` > 0): arching fronds with leaflets. */
export function fern(c: C, x: number, base: number, h: number, rnd: () => number, trunk = 0) {
  const top = base - trunk;
  if (trunk > 0) {
    c.beginPath(); c.moveTo(x - h * 0.03, base); c.quadraticCurveTo(x - h * 0.02 + h * 0.03, base - trunk * 0.5, x - h * 0.015, top); c.lineTo(x + h * 0.015, top); c.quadraticCurveTo(x + h * 0.04, base - trunk * 0.5, x + h * 0.03, base); c.closePath(); c.fill();
  }
  const n = 9 + Math.floor(rnd() * 4);
  c.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k / (n - 1) - 0.5) * (trunk > 0 ? 3.6 : 2.4) + (rnd() - 0.5) * 0.2;
    const L = h * (0.55 + 0.35 * Math.cos((k / (n - 1) - 0.5) * 2)) * (0.8 + rnd() * 0.3);
    const droop = trunk > 0 ? 0.9 : 0.55;
    let px = x, py = top, ang = a;
    const steps = 18;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const nx = px + Math.cos(ang) * L / steps, ny = py + Math.sin(ang) * L / steps;
      c.lineWidth = Math.max(1, h * 0.012 * (1 - u)); c.beginPath(); c.moveTo(px, py); c.lineTo(nx, ny); c.stroke();
      const leaf = h * 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.08));
      for (const sg of [-1, 1]) {
        const la = ang + sg * 1.15;
        c.lineWidth = Math.max(1, h * 0.008 * (1 - u * 0.6));
        c.beginPath(); c.moveTo(nx, ny); c.lineTo(nx + Math.cos(la) * leaf, ny + Math.sin(la) * leaf + leaf * 0.25); c.stroke();
      }
      px = nx; py = ny;
      ang += (ang < Math.PI / 2 ? 1 : -1) * 0 + droop * 0.05 * Math.sign(Math.cos(ang)) * 1.0;
    }
  }
}

/** Soft rolling dunes / hills. */
export function dunes(c: C, y0: number, amp: number, scale: number, seed: number) {
  c.beginPath();
  c.moveTo(X0, BOTTOM);
  for (let x = X0; x <= X1; x += 8) {
    const n = Math.sin(x / scale + seed) * 0.6 + fbm1(x / (scale * 1.7) + seed, 3, seed) * 0.5;
    c.lineTo(x, y0 - amp * (0.5 + 0.5 * n));
  }
  c.lineTo(X1, BOTTOM);
  c.closePath();
  c.fill();
}

/** Flat ground with a gentle wobble. */
export function ground(c: C, y: number, wob = 6, seed = 1) {
  c.beginPath();
  c.moveTo(X0, BOTTOM);
  for (let x = X0; x <= X1; x += 10) c.lineTo(x, y + fbm1(x / 160 + seed, 3, seed) * wob);
  c.lineTo(X1, BOTTOM);
  c.closePath();
  c.fill();
}

/** A rounded-top karst pillar (Liyue's stone forests). */
export function pillar(c: C, x: number, base: number, w: number, h: number, seed = 0) {
  c.beginPath();
  const lean = noise1(seed * 3.1, 2) * w * 0.25;
  c.moveTo(x - w / 2, base);
  for (let k = 0; k <= 12; k++) {
    const t = k / 12, y = base - h * t;
    const ww = w * (0.5 - 0.12 * t + 0.06 * noise1(t * 5 + seed, 3));
    c.lineTo(x - ww + lean * t, y);
  }
  c.quadraticCurveTo(x + lean, base - h - w * 0.35, x + w * 0.38 + lean, base - h);
  for (let k = 12; k >= 0; k--) {
    const t = k / 12, y = base - h * t;
    const ww = w * (0.5 - 0.12 * t + 0.06 * noise1(t * 5 + seed + 9, 3));
    c.lineTo(x + ww + lean * t, y);
  }
  c.closePath();
  c.fill();
}

/** A volcano cone with a crater notch. */
export function volcano(c: C, x: number, base: number, w: number, h: number, seed = 0) {
  c.beginPath();
  c.moveTo(x - w, base);
  for (let k = 0; k <= 30; k++) {
    const t = k / 30;
    const xx = x - w + (w - w * 0.13) * t;
    const yy = base - h * Math.pow(t, 1.6) + fbm1(xx / 40 + seed, 3, seed) * 10 * t;
    c.lineTo(xx, yy);
  }
  c.lineTo(x - w * 0.07, base - h + 22);
  c.lineTo(x + w * 0.07, base - h + 18);
  for (let k = 30; k >= 0; k--) {
    const t = k / 30;
    const xx = x + w - (w - w * 0.13) * t;
    const yy = base - h * Math.pow(t, 1.6) + fbm1(xx / 40 + seed + 4, 3, seed) * 10 * t;
    c.lineTo(xx, yy);
  }
  c.closePath();
  c.fill();
}

/** A floating island: a flat top with spires, an inverted rocky cone under it (Celestia). */
export function floatingIsland(c: C, x: number, y: number, w: number, depth: number, seed = 0, spires = true) {
  c.beginPath();
  c.moveTo(x - w / 2, y);
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const xx = x - w / 2 + w * t;
    const prof = Math.pow(Math.sin(Math.PI * t), 0.7);
    const jag = (fbm1(t * 9 + seed, 4, seed) * 0.5 + 0.5) * 0.35 + 0.65;
    c.lineTo(xx, y + depth * prof * jag);
  }
  c.lineTo(x + w / 2, y);
  c.closePath();
  c.fill();
  if (spires) {
    for (let k = 0; k < 9; k++) {
      const t = (k + 0.5) / 9;
      const xx = x - w * 0.42 + w * 0.84 * t;
      const hh = w * (0.06 + 0.16 * Math.pow(Math.sin(Math.PI * t), 3)) * (0.7 + 0.5 * Math.abs(noise1(k * 1.7 + seed, 4)));
      spire(c, xx, y + 2, w * 0.022, hh);
    }
    dome(c, x, y + 2, w * 0.07);
  }
}

export function rect(c: C, x: number, base: number, w: number, h: number) { c.fillRect(x - w / 2, base - h, w, h); }

/** A thin tower with a pointed top. */
export function spire(c: C, x: number, base: number, w: number, h: number) {
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.lineTo(x - w / 2, base - h * 0.78);
  c.lineTo(x, base - h);
  c.lineTo(x + w / 2, base - h * 0.78);
  c.lineTo(x + w / 2, base);
  c.closePath();
  c.fill();
}

/** A dome (half disc) on a drum. */
export function dome(c: C, x: number, base: number, r: number) {
  c.fillRect(x - r, base - r * 0.5, 2 * r, r * 0.5);
  c.beginPath(); c.arc(x, base - r * 0.5, r, Math.PI, 0); c.fill();
  c.fillRect(x - r * 0.06, base - r * 1.75, r * 0.12, r * 0.3);
}

/** An onion dome tower (Snezhnaya). */
export function onion(c: C, x: number, base: number, w: number, h: number) {
  c.fillRect(x - w / 2, base - h * 0.62, w, h * 0.62);
  const y = base - h * 0.62, r = w * 0.75;
  c.beginPath();
  c.moveTo(x - w / 2, y);
  c.bezierCurveTo(x - r * 1.2, y - r * 0.6, x - r * 0.9, y - r * 1.4, x, y - r * 2.1);
  c.bezierCurveTo(x + r * 0.9, y - r * 1.4, x + r * 1.2, y - r * 0.6, x + w / 2, y);
  c.closePath(); c.fill();
  c.fillRect(x - 1.5, y - r * 2.6, 3, r * 0.6);
}

/** A stepped pyramid (the desert mausoleum) — `steps` terraces. */
export function pyramid(c: C, x: number, base: number, w: number, h: number, steps = 0) {
  c.beginPath();
  if (!steps) { c.moveTo(x - w / 2, base); c.lineTo(x, base - h); c.lineTo(x + w / 2, base); }
  else {
    c.moveTo(x - w / 2, base);
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      c.lineTo(x - w / 2 * (1 - t0), base - h * t1 * 0.97);
      c.lineTo(x - w / 2 * (1 - t1), base - h * t1 * 0.97);
    }
    c.lineTo(x + w / 2 * (1 / steps), base - h);
    for (let k = steps - 1; k >= 0; k--) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      c.lineTo(x + w / 2 * (1 - t1), base - h * t1 * 0.97);
      c.lineTo(x + w / 2 * (1 - t0), base - h * t1 * 0.97);
    }
    c.lineTo(x + w / 2, base);
  }
  c.closePath(); c.fill();
}

/** A skyline of mixed buildings between x0 and x1. style: 'gothic' | 'east' | 'dome' | 'block' | 'belle' */
export function city(c: C, x0: number, x1: number, base: number, hMax: number, rnd: () => number, style = 'gothic') {
  let x = x0;
  while (x < x1) {
    const r = rnd(), cx = () => x + w / 2;
    let w: number, h: number;
    switch (style) {
      case 'gothic': { // houses with steep gables, now and then a church tower
        const tower = r < 0.12;
        w = tower ? 22 + rnd() * 16 : 30 + rnd() * 40;
        h = tower ? hMax * (0.7 + 0.3 * rnd()) : hMax * (0.18 + 0.32 * rnd());
        rect(c, cx(), base, w, h);
        if (tower) spire(c, cx(), base - h + 2, w * 0.95, h * 0.55);
        else gable(c, cx(), base - h, w * 1.08, w * (0.45 + 0.3 * rnd()));
        break;
      }
      case 'dome': { // classical: temples with pediments and colonnades, domed halls, a few towers
        w = 60 + rnd() * 90;
        h = hMax * (0.22 + 0.3 * rnd());
        if (r < 0.4) temple(c, cx(), base, w, h);
        else if (r < 0.7) { rect(c, cx(), base, w * 0.9, h * 0.75); dome(c, cx(), base - h * 0.75 + 1, w * 0.36); }
        else if (r < 0.82) { rect(c, cx(), base, w * 0.3, h * 1.6); dome(c, cx(), base - h * 1.6 + 1, w * 0.17); }
        else { rect(c, cx(), base, w, h * 0.55); gable(c, cx(), base - h * 0.55, w * 1.04, h * 0.16); }
        break;
      }
      case 'belle': { // mansard roofs and domes
        w = 40 + rnd() * 70;
        h = hMax * (0.3 + 0.4 * rnd());
        rect(c, cx(), base, w, h);
        mansard(c, cx(), base - h, w, h * 0.16);
        if (r < 0.25) dome(c, cx(), base - h - h * 0.16 + 1, w * 0.22);
        break;
      }
      case 'east': {
        w = 40 + rnd() * 60;
        h = hMax * (0.2 + 0.35 * rnd());
        rect(c, cx(), base, w * 0.85, h);
        eaveRoof(c, cx(), base - h, w * 1.3, w * 0.32);
        break;
      }
      default: { // block: stepped industrial terraces with masts (Khaenri'ah)
        w = 50 + rnd() * 80;
        h = hMax * (0.3 + 0.7 * Math.pow(rnd(), 1.4));
        const steps = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < steps; k++) rect(c, cx(), base - h * k / steps, w * (1 - k * 0.22), h / steps + 1);
        if (r < 0.3) c.fillRect(cx() - 1.5, base - h - h * 0.3, 3, h * 0.3);
        if (r > 0.75) { c.beginPath(); c.arc(cx(), base - h, w * 0.18, Math.PI, 0); c.fill(); }
      }
    }
    x += w + rnd() * (style === 'dome' ? 30 : 8);
  }
}

/** A gabled roof on a wall top at y. */
export function gable(c: C, x: number, y: number, w: number, h: number) {
  c.beginPath(); c.moveTo(x - w / 2, y + 1); c.lineTo(x, y - h); c.lineTo(x + w / 2, y + 1); c.closePath(); c.fill();
}

/** A mansard roof: steep lower slope, flat top. */
export function mansard(c: C, x: number, y: number, w: number, h: number) {
  c.beginPath(); c.moveTo(x - w / 2 - 3, y + 1); c.lineTo(x - w * 0.38, y - h); c.lineTo(x + w * 0.38, y - h); c.lineTo(x + w / 2 + 3, y + 1); c.closePath(); c.fill();
}

/** A classical temple: stylobate, a colonnade (gaps between columns), entablature and pediment. */
export function temple(c: C, x: number, base: number, w: number, h: number) {
  c.fillRect(x - w / 2 - 6, base - h * 0.08, w + 12, h * 0.08);
  const n = Math.max(4, Math.round(w / 16));
  const colH = h * 0.62, cw = w / n * 0.48;
  for (let k = 0; k < n; k++) c.fillRect(x - w / 2 + (k + 0.5) * (w / n) - cw / 2, base - h * 0.08 - colH, cw, colH);
  c.fillRect(x - w / 2 - 3, base - h * 0.08 - colH - h * 0.1, w + 6, h * 0.1);
  gable(c, x, base - h * 0.08 - colH - h * 0.1, w + 10, h * 0.2);
}

/** An eastern curved roof (Liyue / Inazuma eaves). */
export function eaveRoof(c: C, x: number, y: number, w: number, h: number) {
  c.beginPath();
  c.moveTo(x - w / 2 - w * 0.08, y - h * 0.15);
  c.quadraticCurveTo(x - w * 0.3, y - h * 0.2, x - w * 0.18, y - h);
  c.lineTo(x + w * 0.18, y - h);
  c.quadraticCurveTo(x + w * 0.3, y - h * 0.2, x + w / 2 + w * 0.08, y - h * 0.15);
  c.lineTo(x + w / 2, y);
  c.lineTo(x - w / 2, y);
  c.closePath(); c.fill();
}

/** A multi-tier pagoda. */
export function pagoda(c: C, x: number, base: number, w: number, tiers: number, tierH: number) {
  let y = base;
  for (let k = 0; k < tiers; k++) {
    const ww = w * (1 - k * 0.13);
    rect(c, x, y, ww * 0.7, tierH * 0.65);
    eaveRoof(c, x, y - tierH * 0.65, ww, tierH * 0.45);
    y -= tierH;
  }
  spire(c, x, y + 4, w * 0.06, tierH * 1.2);
}

/** A torii gate. */
export function torii(c: C, x: number, base: number, w: number, h: number) {
  const p = w * 0.07;
  c.fillRect(x - w * 0.36 - p / 2, base - h, p, h);
  c.fillRect(x + w * 0.36 - p / 2, base - h, p, h);
  c.fillRect(x - w * 0.45, base - h * 0.78, w * 0.9, p * 0.8);
  c.beginPath();
  c.moveTo(x - w * 0.58, base - h * 0.98);
  c.quadraticCurveTo(x, base - h * 0.9, x + w * 0.58, base - h * 0.98);
  c.lineTo(x + w * 0.55, base - h * 1.07);
  c.quadraticCurveTo(x, base - h * 1.0, x - w * 0.55, base - h * 1.07);
  c.closePath(); c.fill();
}

/** A windmill with four sails at angle `a`. */
export function windmill(c: C, x: number, base: number, h: number, a: number) {
  c.beginPath();
  c.moveTo(x - h * 0.16, base); c.lineTo(x - h * 0.1, base - h); c.lineTo(x + h * 0.1, base - h); c.lineTo(x + h * 0.16, base);
  c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x - h * 0.13, base - h); c.lineTo(x, base - h * 1.18); c.lineTo(x + h * 0.13, base - h); c.closePath(); c.fill();
  const hx = x, hy = base - h * 0.98;
  for (let k = 0; k < 4; k++) {
    const t = a + k * Math.PI / 2, L = h * 0.85;
    c.save(); c.translate(hx, hy); c.rotate(t);
    c.fillRect(0, -2, L, 4);
    c.fillRect(L * 0.25, 2, L * 0.72, h * 0.12);
    c.restore();
  }
}

/** A lighthouse. */
export function lighthouse(c: C, x: number, base: number, h: number) {
  c.beginPath();
  c.moveTo(x - h * 0.09, base); c.lineTo(x - h * 0.05, base - h * 0.85); c.lineTo(x + h * 0.05, base - h * 0.85); c.lineTo(x + h * 0.09, base);
  c.closePath(); c.fill();
  c.fillRect(x - h * 0.065, base - h * 0.97, h * 0.13, h * 0.12);
  c.beginPath(); c.moveTo(x - h * 0.075, base - h * 0.97); c.lineTo(x, base - h * 1.07); c.lineTo(x + h * 0.075, base - h * 0.97); c.closePath(); c.fill();
}

/** A tree: 'round' (sakura / oak crown), 'pine', 'dead' (bare branches), 'fern'. */
export function tree(c: C, x: number, base: number, h: number, kind: string, rnd: () => number) {
  if (kind === 'pine') {
    c.beginPath(); c.moveTo(x, base - h);
    for (let k = 0; k <= 6; k++) { const t = k / 6; const w = h * 0.22 * t; c.lineTo(x + w, base - h + h * t * 0.85); c.lineTo(x + w * 0.55, base - h + h * t * 0.85); }
    c.lineTo(x + h * 0.03, base); c.lineTo(x - h * 0.03, base);
    for (let k = 6; k >= 0; k--) { const t = k / 6; const w = h * 0.22 * t; c.lineTo(x - w * 0.55, base - h + h * t * 0.85); c.lineTo(x - w, base - h + h * t * 0.85); }
    c.closePath(); c.fill();
    return;
  }
  // trunk + branches
  const branch = (bx: number, by: number, len: number, ang: number, w: number, d: number) => {
    const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
    c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo((bx + ex) / 2 + (rnd() - 0.5) * len * 0.3, (by + ey) / 2, ex, ey); c.stroke();
    if (d <= 0) {
      if (kind === 'round') { c.beginPath(); c.arc(ex, ey, len * (0.9 + rnd() * 0.6), 0, Math.PI * 2); c.fill(); }
      return;
    }
    const n = kind === 'fern' ? 3 : 2 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const da = (k - (n - 1) / 2) * (kind === 'fern' ? 0.9 : 0.6) + (rnd() - 0.5) * 0.35;
      branch(ex, ey, len * (0.62 + rnd() * 0.18), ang + da, w * 0.62, d - 1);
    }
  };
  branch(x, base, h * 0.36, -Math.PI / 2 + (rnd() - 0.5) * 0.12, h * 0.07, kind === 'dead' ? 5 : 4);
}

/** A standing figure seen from behind, in a cloak; `h` = height. pose: 'stand' | 'lyre' | 'sword' | 'torch' | 'sit' */
export function figure(c: C, x: number, base: number, h: number, pose = 'stand', facing = 1) {
  c.save(); c.translate(x, base); c.scale(facing * h / 100, h / 100);
  c.beginPath();
  if (pose === 'sit') {
    c.ellipse(0, -52, 9, 10, 0, 0, Math.PI * 2);
    c.moveTo(-14, -40); c.quadraticCurveTo(-26, -10, -30, 0); c.lineTo(30, 0); c.quadraticCurveTo(24, -12, 14, -40); c.closePath();
  } else {
    c.ellipse(0, -90, 7, 8.5, 0, 0, Math.PI * 2);
    c.moveTo(-8, -80); c.quadraticCurveTo(-16, -60, -19, -8); c.lineTo(-9, 0); c.lineTo(-3, -30); c.lineTo(3, -30); c.lineTo(9, 0); c.lineTo(19, -8); c.quadraticCurveTo(16, -60, 8, -80); c.closePath();
    // cloak tail in the wind
    c.moveTo(-12, -74); c.quadraticCurveTo(-34, -50, -42, -24); c.lineTo(-18, -34); c.closePath();
  }
  c.fill();
  c.lineWidth = 3; c.lineCap = 'round';
  if (pose === 'lyre') { c.beginPath(); c.ellipse(16, -58, 7, 11, 0.4, 0, Math.PI * 2); c.stroke(); }
  if (pose === 'sword') { c.beginPath(); c.moveTo(14, -50); c.lineTo(34, -96); c.stroke(); }
  if (pose === 'torch') { c.beginPath(); c.moveTo(12, -62); c.lineTo(22, -112); c.stroke(); c.beginPath(); c.arc(22, -116, 5, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

/** A small floating companion (a round head, a cape): the Traveler's guide. */
export function companion(c: C, x: number, y: number, s: number) {
  c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(x - s * 0.8, y + s * 0.6); c.quadraticCurveTo(x, y + s * 2.6, x + s * 0.8, y + s * 0.6); c.closePath(); c.fill();
  c.beginPath(); c.arc(x + s * 0.2, y - s * 1.15, s * 0.32, 0, Math.PI * 2); c.fill();
}

/** Broken colonnade ruins. */
export function ruins(c: C, x0: number, x1: number, base: number, h: number, rnd: () => number) {
  // a broken colonnade: whole columns carrying fragments of architrave, snapped shafts with jagged tops,
  // fallen drums, on a stylobate
  c.fillRect(x0 - 30, base - 10, x1 - x0 + 60, 10);
  const cw = Math.max(10, h * 0.09), gap = cw * 3.2;
  const cols: { x: number; top: number }[] = [];
  for (let x = x0; x < x1; x += gap * (0.8 + rnd() * 0.5)) {
    if (rnd() < 0.18) continue;                                  // a missing column
    const whole = rnd() < 0.45;
    const hh = whole ? h : h * (0.15 + rnd() * 0.65);
    const top = base - 10 - hh;
    c.fillRect(x - cw * 0.7, base - 10 - cw * 0.35, cw * 1.4, cw * 0.35);  // base
    c.fillRect(x - cw / 2, top, cw, hh - cw * 0.3);
    if (whole) c.fillRect(x - cw * 0.8, top - cw * 0.35, cw * 1.6, cw * 0.4);  // capital
    else { c.beginPath(); c.moveTo(x - cw / 2, top + 1); c.lineTo(x - cw * 0.1, top - cw * (0.4 + rnd())); c.lineTo(x + cw * 0.15, top - cw * 0.2); c.lineTo(x + cw / 2, top - cw * rnd()); c.lineTo(x + cw / 2, top + 1); c.closePath(); c.fill(); }
    cols.push({ x, top: whole ? top - cw * 0.35 : 1e9 });
  }
  for (let i = 0; i + 1 < cols.length; i++) {                      // architrave fragments over neighbouring whole columns
    const a = cols[i]!, b = cols[i + 1]!;
    if (a.top < 1e8 && b.top < 1e8 && rnd() < 0.7) c.fillRect(a.x - cw, a.top - cw * 0.7, b.x - a.x + cw * 2, cw * 0.7);
  }
  for (let k = 0; k < (x1 - x0) / 160; k++) {                    // fallen drums
    const x = x0 + rnd() * (x1 - x0);
    c.beginPath(); c.ellipse(x, base - 10 - cw * 0.45, cw * (0.9 + rnd() * 0.8), cw * 0.5, (rnd() - 0.5) * 0.3, 0, Math.PI * 2); c.fill();
  }
}

/** An arch (or a broken one: `broken` 0..1 removes the right part). */
export function arch(c: C, x: number, base: number, w: number, h: number, t = 14, broken = 0) {
  c.fillRect(x - w / 2, base - h, t, h);
  if (broken < 0.5) c.fillRect(x + w / 2 - t, base - h, t, h);
  c.lineWidth = t; c.beginPath();
  c.arc(x, base - h, w / 2 - t / 2, Math.PI, Math.PI * 2 - broken * Math.PI * 0.9); c.stroke();
}

/** Ice shelves / a frozen sea: flat tops, sheer edges. */
export function iceShelves(c: C, y: number, rnd: () => number) {
  let x = X0;
  while (x < X1) {
    const w = 60 + rnd() * 380, h = 6 + rnd() * 34, yy = y + (rnd() - 0.5) * 50;
    c.beginPath();
    c.moveTo(x, yy + 40);
    const n = 3 + Math.floor(rnd() * 4);
    c.lineTo(x + rnd() * 10, yy - h * (0.6 + rnd() * 0.4));
    for (let k = 1; k < n; k++) c.lineTo(x + w * k / n + (rnd() - 0.5) * 20, yy - h * (0.7 + rnd() * 0.5));
    c.lineTo(x + w - rnd() * 14, yy - h * rnd() * 0.6);
    c.lineTo(x + w, yy + 40);
    c.closePath(); c.fill();
    x += w + 10 + rnd() * 140;
  }
}

/** Waves: a band of breaking crests along y. */
export function waves(c: C, y: number, amp: number, len: number, seed: number) {
  c.beginPath(); c.moveTo(X0, BOTTOM);
  for (let x = X0; x <= X1; x += 6) {
    const p = (x / len + seed) % 1;
    const crest = Math.pow(Math.sin(Math.PI * p), 3) * amp * (0.6 + 0.4 * noise1(x / 300 + seed, 5));
    c.lineTo(x, y - crest);
  }
  c.lineTo(X1, BOTTOM); c.closePath(); c.fill();
}
