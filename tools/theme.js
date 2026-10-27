/* Colour engine for the theme builder.
   A direct port of tools/palette.py so the builder's preview and the
   generated stylesheet can never disagree. Keep the two in step. */

export const ROLES = [
  ["surface", "the page itself, most of the reading"],
  ["tint",    "a light band — testimonials"],
  ["mid",     "a mid-tone band — about"],
  ["feature", "the hero"],
  ["shout",   "the one loud band — booking CTA"],
  ["anchor",  "nav, footer, buttons"],
  ["accent",  "small highlights on light surfaces"],
];

export const FLOOR = 4.5;
export const TARGETS = { surface: 10.0, accent: 6.0 };
export const TARGET = 7.0;
export const HOVERS = 6;
export const HOVER_MIN = 3.5;
const ROLE_L = { surface: .94, tint: .88, mid: .68, feature: .62, shout: .58, anchor: .17 };

export const hex2rgb = h => {
  h = String(h).trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
export const rgb2hex = c =>
  "#" + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

const lin = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
export const chroma = c => (Math.max(...c) - Math.min(...c)) / 255;

export function rgb2hls(c) {
  const [r, g, b] = c.map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, l, s];
}
export function hls2rgb(h, l, s) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t % 1 + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => v * 255);
}

/* Same hue as the background, pushed only as far in lightness as contrast
   demands. Sweeps BOTH directions: a mid-lightness colour often cannot
   reach the target by going lighter even when it is not itself dark. */
export function deriveInk(bg, target = TARGET, floor = FLOOR) {
  const [h, l] = rgb2hls(bg);
  const sInk = Math.min(1, 0.15 + chroma(bg) * 1.05);
  const sweep = down => {
    let atTarget = null, atFloor = null, best = null;
    const idx = [];
    if (down) for (let i = 200; i >= 0; i--) idx.push(i);
    else for (let i = 200; i <= 400; i++) idx.push(i);
    for (const i of idx) {
      const cand = hls2rgb(h, i / 400, sInk), r = contrast(cand, bg);
      if (!best || r > best.r) best = { c: cand, r };
      if (!atFloor && r >= floor) atFloor = { c: cand, r };
      if (r >= target) { atTarget = { c: cand, r }; break; }
    }
    return { atTarget, atFloor, best };
  };
  const sweeps = [l > 0.5, l <= 0.5].map(sweep);
  for (const s of sweeps) if (s.atTarget) return { ink: s.atTarget.c, ratio: s.atTarget.r, how: "derived" };
  for (const s of sweeps) if (s.atFloor) return { ink: s.atFloor.c, ratio: s.atFloor.r, how: "below target" };
  const b = sweeps.map(s => s.best).sort((x, y) => y.r - x.r)[0];
  return { ink: b.c, ratio: b.r, how: "below AA" };
}

/* n bold, maximally distinct card-hover colours: hues spaced evenly round
   the wheel so no two cards repeat, rotated onto the palette's most
   colourful hue so the set still belongs to the brand. */
export function hoverSet(surface, palette, rot = 0, n = HOVERS, minCr = HOVER_MIN) {
  const base = palette.length
    ? palette.reduce((a, b) => chroma(b) > chroma(a) ? b : a)
    : [200, 120, 60];
  const h0 = (rgb2hls(base)[0] + rot / 360 + 1) % 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = (h0 + i / n) % 1;
    let pick = null;
    for (let x = 132; x >= 40; x--) {
      const c = hls2rgb(h, x / 200, 0.95);
      if (contrast(c, surface) >= minCr) { pick = c; break; }
    }
    out.push(pick || hls2rgb(h, 0.35, 0.95));
  }
  return out;
}

/* Sort by lightness, drop each colour into the slot it fits. Mirrors the
   Python assign(): darkest anchors, most colourful shouts, then hero. */
export function autoAssign(palette, pinned = {}) {
  const slots = { ...pinned };
  const taken = new Set(Object.values(pinned).map(rgb2hex));
  let pool = palette.filter(c => !taken.has(rgb2hex(c)));

  const byLight = [...pool].sort((a, b) => lum(a) - lum(b));
  if (!slots.anchor && byLight.length) slots.anchor = byLight.shift();

  let rest = [...byLight].sort((a, b) => chroma(b) - chroma(a));
  if (!slots.shout && rest.length) slots.shout = rest.shift();
  if (!slots.feature && rest.length) slots.feature = rest.shift();

  rest = rest.sort((a, b) => lum(b) - lum(a));
  if (!slots.tint && rest.length) slots.tint = rest.shift();
  if (!slots.mid && rest.length) slots.mid = rest.shift();

  if (!slots.surface) {
    const base = slots.mid || slots.tint || rest[0] || [240, 240, 240];
    const [h, , s] = rgb2hls(base);
    slots.surface = hls2rgb(h, 0.935, Math.min(s * 0.35, 0.18));
  }

  // a palette with fewer colours than slots still has to fill them
  const vivid = palette.length ? palette.reduce((a, b) => chroma(b) > chroma(a) ? b : a) : [200, 120, 60];
  const quiet = palette.length ? palette.reduce((a, b) => chroma(b) < chroma(a) ? b : a) : [180, 180, 180];
  for (const [role, L] of Object.entries(ROLE_L)) {
    if (slots[role]) continue;
    const loud = role === "feature" || role === "shout";
    const [h, , s] = rgb2hls(loud ? vivid : quiet);
    slots[role] = hls2rgb(h, L, loud ? Math.min(s, 0.9) : Math.min(s, 0.30));
  }

  if (!slots.accent) {
    const [h, , s] = rgb2hls(slots.shout || slots.feature);
    let pick = null;
    for (let i = 200; i >= 0; i--) {
      const c = hls2rgb(h, i / 400, Math.min(s * 0.95, 0.95));
      if (contrast(c, slots.surface) >= TARGETS.accent) { pick = c; break; }
    }
    slots.accent = pick || [0, 0, 0];
  }
  return slots;
}

/* Everything the preview and the export need, in one object. */
export function buildTheme({ palette, pinned = {}, inkOverride = {}, hueRot = 0 }) {
  const slots = autoAssign(palette, pinned);
  const rows = ROLES.map(([role]) => {
    const bg = slots[role];
    if (role === "accent") {
      return { role, bg, ink: null, ratio: contrast(bg, slots.surface), how: "on surface" };
    }
    if (inkOverride[role]) {
      const ink = inkOverride[role];
      return { role, bg, ink, ratio: contrast(ink, bg), how: "pinned" };
    }
    const d = deriveInk(bg, TARGETS[role] ?? TARGET);
    return { role, bg, ink: d.ink, ratio: d.ratio, how: d.how };
  });
  const hovers = hoverSet(slots.surface, palette, hueRot);

  const vars = {};
  for (const { role, bg, ink } of rows) {
    vars["--" + role] = bg.map(v => Math.round(v)).join(" ");
    if (ink) vars["--" + role + "-ink"] = ink.map(v => Math.round(v)).join(" ");
  }
  hovers.forEach((c, i) => { vars["--hover-" + (i + 1)] = c.map(v => Math.round(v)).join(" "); });

  return { slots, rows, hovers, vars };
}

/* ---------------------------------------------------------------
   Every part of the page you can colour, section by section.

   `slot`  a background's default, taken from the palette slots.
   `on`    which background this thing sits on.
   `need`  the contrast it must clear (4.5 body, 3 display or non-text,
           0 for a surface that only has to look different).
   `soft`  secondary text. Muted by deriving a LOWER-contrast ink
           rather than by dropping opacity -- opacity is what made
           nav links disappear against a light bar.

   Text with no override derives from its OWN background, so it can
   never inherit an ink that was legible somewhere else and invisible
   here.
---------------------------------------------------------------- */
export const ELEMENTS = [
  { key:"nav-bg",   group:"Header bar", label:"Bar background", kind:"bg",   slot:"anchor" },
  { key:"nav-logo", group:"Header bar", label:"Name",           kind:"text", on:"nav-bg",  need:4.5 },
  { key:"nav-sub",  group:"Header bar", label:"Subtitle",       kind:"text", on:"nav-bg",  need:4.5, soft:true },
  { key:"nav-link", group:"Header bar", label:"Links",          kind:"text", on:"nav-bg",  need:4.5, soft:true },
  { key:"pill-bg",  group:"Header bar", label:"Button fill",    kind:"bg",   on:"nav-bg",  need:3, slot:"shout" },
  { key:"pill-text",group:"Header bar", label:"Button text",    kind:"text", on:"pill-bg", need:4.5 },

  { key:"hero-bg",  group:"Hero", label:"Background", kind:"bg",   slot:"feature" },
  { key:"hero-type",group:"Hero", label:"Headline",   kind:"text", on:"hero-bg", need:3, display:true },

  { key:"cards-bg",   group:"Cards", label:"Section background", kind:"bg",   slot:"surface" },
  { key:"cards-head", group:"Cards", label:"Heading",   kind:"text", on:"cards-bg", need:3, display:true },
  { key:"cards-lede", group:"Cards", label:"Lead line", kind:"text", on:"cards-bg", need:4.5 },
  { key:"card-bg",    group:"Cards", label:"Card fill", kind:"bg",   on:"cards-bg", need:0, slot:"surface" },
  { key:"card-border",group:"Cards", label:"Card edge", kind:"bg",   on:"card-bg",  need:3 },
  { key:"card-title", group:"Cards", label:"Card title",kind:"text", on:"card-bg",  need:4.5 },
  { key:"card-body",  group:"Cards", label:"Card text", kind:"text", on:"card-bg",  need:4.5, soft:true },

  { key:"about-bg",     group:"About", label:"Background",  kind:"bg",   slot:"mid" },
  { key:"about-head",   group:"About", label:"Heading",     kind:"text", on:"about-bg",  need:3, display:true },
  { key:"about-body",   group:"About", label:"Body text",   kind:"text", on:"about-bg",  need:4.5, soft:true },
  { key:"about-btn",    group:"About", label:"Button fill", kind:"bg",   on:"about-bg",  need:3, slot:"anchor" },
  { key:"about-btn-ink",group:"About", label:"Button text", kind:"text", on:"about-btn", need:4.5 },

  { key:"quotes-bg",   group:"Quotes", label:"Background",  kind:"bg",   slot:"tint" },
  { key:"quotes-head", group:"Quotes", label:"Heading",     kind:"text", on:"quotes-bg", need:3, display:true },
  { key:"quote-bg",    group:"Quotes", label:"Card fill",   kind:"bg",   on:"quotes-bg", need:0, slot:"surface" },
  { key:"quote-text",  group:"Quotes", label:"Quote",       kind:"text", on:"quote-bg",  need:4.5 },
  { key:"quote-name",  group:"Quotes", label:"Attribution", kind:"text", on:"quote-bg",  need:4.5, soft:true },

  { key:"price-bg",    group:"Pricing", label:"Background", kind:"bg",   slot:"surface" },
  { key:"price-head",  group:"Pricing", label:"Heading",    kind:"text", on:"price-bg", need:3, display:true },
  { key:"price-body",  group:"Pricing", label:"Body text",  kind:"text", on:"price-bg", need:4.5, soft:true },
  { key:"price-accent",group:"Pricing", label:"The rate",   kind:"text", on:"price-bg", need:4.5 },
  { key:"p1-bg",    group:"Pricing", label:"Card 1 fill",  kind:"bg",   on:"price-bg", need:0, slot:"anchor" },
  { key:"p1-title", group:"Pricing", label:"Card 1 title", kind:"text", on:"p1-bg",    need:4.5 },
  { key:"p1-body",  group:"Pricing", label:"Card 1 text",  kind:"text", on:"p1-bg",    need:4.5, soft:true },
  { key:"p2-bg",    group:"Pricing", label:"Card 2 fill",  kind:"bg",   on:"price-bg", need:0, slot:"tint" },
  { key:"p2-title", group:"Pricing", label:"Card 2 title", kind:"text", on:"p2-bg",    need:4.5 },
  { key:"p2-body",  group:"Pricing", label:"Card 2 text",  kind:"text", on:"p2-bg",    need:4.5, soft:true },
  { key:"p3-bg",    group:"Pricing", label:"Card 3 fill",  kind:"bg",   on:"price-bg", need:0, slot:"surface" },
  { key:"p3-title", group:"Pricing", label:"Card 3 title", kind:"text", on:"p3-bg",    need:4.5 },
  { key:"p3-body",  group:"Pricing", label:"Card 3 text",  kind:"text", on:"p3-bg",    need:4.5, soft:true },

  { key:"cta-bg",     group:"CTA", label:"Background",  kind:"bg",   slot:"shout" },
  { key:"cta-head",   group:"CTA", label:"Heading",     kind:"text", on:"cta-bg",  need:3, display:true },
  { key:"cta-body",   group:"CTA", label:"Body text",   kind:"text", on:"cta-bg",  need:4.5 },
  { key:"cta-btn",    group:"CTA", label:"Button fill", kind:"bg",   on:"cta-bg",  need:3, slot:"anchor" },
  { key:"cta-btn-ink",group:"CTA", label:"Button text", kind:"text", on:"cta-btn", need:4.5 },

  { key:"contact-bg",     group:"Contact", label:"Background",  kind:"bg",   slot:"surface" },
  { key:"contact-head",   group:"Contact", label:"Heading",     kind:"text", on:"contact-bg",  need:3, display:true },
  { key:"contact-btn",    group:"Contact", label:"Button fill", kind:"bg",   on:"contact-bg",  need:3, slot:"anchor" },
  { key:"contact-btn-ink",group:"Contact", label:"Button text", kind:"text", on:"contact-btn", need:4.5 },

  { key:"foot-bg",   group:"Footer", label:"Background", kind:"bg",   slot:"anchor" },
  { key:"foot-text", group:"Footer", label:"Copyright",  kind:"text", on:"foot-bg", need:4.5, soft:true },
  { key:"foot-fine", group:"Footer", label:"Disclaimer", kind:"text", on:"foot-bg", need:4.5, soft:true },
];

export const GROUPS = [...new Set(ELEMENTS.map(e => e.group))];

/* Effective colour of every element plus the contrast a reader gets.
   Resolved in declaration order, so anything sitting ON another element
   already knows that element's colour. */
export function resolveElements(t, override = {}) {
  const norm = v => typeof v === "string" ? hex2rgb(v) : v;
  const slotOf = name => {
    const [role, ink] = name.split(/-(?=ink$)/);
    const row = t.rows.find(r => r.role === role);
    if (!row) return [0, 0, 0];
    return ink ? (row.ink || row.bg) : row.bg;
  };

  const eff = {};
  for (const e of ELEMENTS) {
    if (override[e.key]) { eff[e.key] = norm(override[e.key]); continue; }
    if (e.kind === "bg") {
      eff[e.key] = e.slot ? slotOf(e.slot) : deriveInk(eff[e.on] || [0,0,0], e.need || 3).ink;
    } else {
      // derive from the background it actually sits on; soft text simply
      // aims lower, which mutes it without ever making it invisible
      eff[e.key] = deriveInk(eff[e.on] || [255,255,255], e.soft ? 4.8 : 7).ink;
    }
  }

  return ELEMENTS.map(e => {
    const colour = eff[e.key];
    const set = !!override[e.key];
    let ratio = null, bg = null;
    if (e.on) { bg = eff[e.on]; ratio = contrast(colour, bg); }
    return { ...e, colour, set, bg, ratio, need: e.need ?? 4.5 };
  });
}
