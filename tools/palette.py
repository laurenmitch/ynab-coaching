#!/usr/bin/env python3
"""
Fill the site's colour slots from a palette.

The site never names a colour. It names seven ROLES, ordered light to dark:

    surface   the page itself, lightest, carries most of the reading
    tint      a light band                      (testimonials)
    mid       a mid-tone band                   (about)
    feature   the hero, the most saturated
    shout     the single loud band              (booking CTA)
    anchor    the darkest, nav + footer + buttons
    accent    small warm highlights on light surfaces

Give it a palette and it sorts by lightness, drops each colour into the
slot it fits, and derives the ink for every slot: the same hue as its
background, pushed just far enough in lightness to clear the contrast
target. Never black, never white -- that tonal pairing is what keeps a
saturated palette from reading as jarring.

    python3 tools/palette.py "#E9F056" "#FF5C34" "#D7EFFF" "#351E28" "#AEB8A0"
    python3 tools/palette.py ... --slot feature=#D7EFFF --ink shout=#351E28
    python3 tools/palette.py ... --write      # patch index.html + book.html

--write replaces whatever sits between the PALETTE:START / PALETTE:END
markers in each file, so the markup is untouched.
"""
import argparse, colorsys, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from elements import ELEMENTS as ELEM_REG          # generated from theme.js

ROLES = ["surface", "tint", "mid", "feature", "shout", "anchor", "accent"]
FLOOR = 4.5
HOVERS = 6          # one bold, distinct accent per pain-point card
HOVER_MIN = 3.5     # WCAG 1.4.11 wants 3:1 for non-text UI; take margin

# Where each slot sits on the light-to-dark ladder. Used to invent a slot
# when the palette is shorter than the number of slots, so a three-colour
# palette still produces a complete, legible theme.
ELEMENTS = [e["key"] for e in ELEM_REG]

ROLE_L = {"surface": 0.94, "tint": 0.88, "mid": 0.68,
          "feature": 0.62, "shout": 0.58, "anchor": 0.17}
# The page's reading surface carries the most text, so it gets the most
# headroom. Bands and the hero only need to be comfortable.
TARGETS = {"surface": 10.0, "accent": 6.0}
TARGET = 7.0


def hex2rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(f"not a hex colour: {h}")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(c):
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in c)


def _lin(v):
    v /= 255.0
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    return 0.2126 * _lin(c[0]) + 0.7152 * _lin(c[1]) + 0.0722 * _lin(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def hls(c):
    return colorsys.rgb_to_hls(*[v / 255 for v in c])


def from_hls(h, l, s):
    return tuple(v * 255 for v in colorsys.hls_to_rgb(h, l, s))


def chroma(c):
    """Perceived colourfulness. HLS saturation calls a pale pastel fully
    saturated, which puts the wrong colour in the loud slot."""
    return (max(c) - min(c)) / 255.0


def derive_ink(bg, target=TARGET, floor=FLOOR):
    """Same hue as bg, pushed only as far in lightness as contrast demands.

    Searches BOTH directions. A mid-lightness background often cannot reach
    the target by going lighter even though it is not itself dark -- a
    mid-blue tops out around 4:1 against white but clears 5:1 against near
    black -- so trying only the conventional direction silently fails."""
    h, l, s = hls(bg)
    # How saturated the ink should be tracks the background's CHROMA, not its
    # HLS saturation (a pale pastel reports s=1.0). This curve was fitted
    # against the reference palette's own inks and lands within a few points
    # of each one, so derived inks look hand-picked rather than computed.
    s_ink = min(1.0, 0.15 + chroma(bg) * 1.05)

    def sweep(down):
        rng = (range(200, -1, -1) if down else range(200, 401))
        at_target = at_floor = None
        best = None
        for i in rng:
            cand = from_hls(h, i / 400, s_ink)
            r = contrast(cand, bg)
            if best is None or r > best[1]:
                best = (cand, r)
            if at_floor is None and r >= floor:
                at_floor = (cand, r)
            if r >= target:
                at_target = (cand, r)
                break
        return at_target, at_floor, best

    # try the conventional direction first, then the other one
    order = [l > 0.5, l <= 0.5]
    sweeps = [sweep(d) for d in order]

    for at_target, _, _ in sweeps:
        if at_target:
            return at_target[0], at_target[1], "derived"
    for _, at_floor, _ in sweeps:
        if at_floor:
            return at_floor[0], at_floor[1], "derived (below target)"
    cand, r = max((s[2] for s in sweeps), key=lambda x: x[1])
    return (cand, r, "derived (below AA)") if r >= 3.0 else (None, r, "impossible")


def hover_set(surface, palette, n=HOVERS, min_cr=HOVER_MIN, rot=0.0):
    """n card-hover colours drawn from the palette itself.

    Neon hues off the colour wheel were legible but looked nothing like
    the brand, so this keeps to the palette and only falls back to a
    derived colour when nothing in it separates from the page."""
    usable = [c for c in palette if contrast(c, surface) >= min_cr]
    if not usable:
        usable = [derive_ink(surface, 4.5)[0]]
    start = int(rot / 360.0 * len(usable)) if usable else 0
    return [usable[(start + i) % len(usable)] for i in range(n)]


def assign(colours, pinned):
    """Sort by lightness and drop each colour into the slot it fits."""
    pool = [c for c in colours if rgb2hex(c) not in
            {rgb2hex(v) for v in pinned.values()}]
    slots = dict(pinned)
    by_light = sorted(pool, key=lum)

    if "anchor" not in slots and by_light:
        slots["anchor"] = by_light.pop(0)

    # the loudest colour left leads the CTA, the next loudest takes the hero
    rest = sorted(by_light, key=chroma, reverse=True)

    if "shout" not in slots and rest:
        slots["shout"] = rest.pop(0)
    if "feature" not in slots and rest:
        slots["feature"] = rest.pop(0)

    rest = sorted(rest, key=lum, reverse=True)
    if "tint" not in slots and rest:
        slots["tint"] = rest.pop(0)
    if "mid" not in slots and rest:
        slots["mid"] = rest.pop(0)

    def fill_gaps():
        """A palette with fewer colours than slots still has to fill them."""
        vivid, quiet = max(colours, key=chroma), min(colours, key=chroma)
        for role, L in ROLE_L.items():
            if role in slots:
                continue
            loud = role in ("feature", "shout")
            h, _, s = hls(vivid if loud else quiet)
            slots[role] = from_hls(h, L, min(s, 0.9) if loud else min(s, 0.30))

    if "surface" not in slots:
        base = slots.get("mid") or slots.get("tint") or (rest[0] if rest else (240, 240, 240))
        h, _, s = hls(base)
        slots["surface"] = from_hls(h, 0.935, min(s * 0.35, 0.18))

    fill_gaps()

    if "accent" not in slots:
        src = slots.get("shout") or slots.get("feature")
        h, _, s = hls(src)
        surf = slots["surface"]
        pick = None
        for L in [i / 400 for i in range(200, -1, -1)]:
            cand = from_hls(h, L, min(s * 0.95, 0.95))
            if contrast(cand, surf) >= TARGETS["accent"]:
                pick = cand
                break
        slots["accent"] = pick or (0, 0, 0)
    return slots


def resolve_elements(rows, override):
    """Every element's final colour.

    Backgrounds take their slot; text derives from the background it
    actually sits on, so it can never inherit an ink that was legible
    elsewhere. Secondary text is muted by aiming at a lower contrast
    target rather than by dropping opacity."""
    by_role = {r[0]: r for r in rows}
    def slot_of(name):
        role, _, ink = name.partition("-")
        r = by_role.get(role)
        if not r:
            return (0, 0, 0)
        return (r[2] or r[1]) if ink == "ink" else r[1]

    eff = {}
    for e in ELEM_REG:
        k = e["key"]
        if k in override:
            eff[k] = override[k]
        elif e["kind"] == "bg":
            eff[k] = slot_of(e["slot"]) if e["slot"] else derive_ink(eff.get(e["on"], (0, 0, 0)), e["need"] or 3)[0]
        else:
            base = eff.get(e["on"], (255, 255, 255))
            eff[k] = derive_ink(base, 4.8 if e["soft"] else 7.0)[0]
    return eff


def build(slots, ink_over):
    rows = []
    for role in ROLES:
        bg = slots[role]
        if role == "accent":
            rows.append((role, bg, None, contrast(bg, slots["surface"]), "on surface"))
            continue
        if role in ink_over:
            ink = ink_over[role]
            rows.append((role, bg, ink, contrast(ink, bg), "pinned"))
        else:
            ink, r, how = derive_ink(bg, TARGETS.get(role, TARGET))
            if ink is None:
                ink = slots["anchor"] if lum(bg) > 0.3 else slots["surface"]
                r, how = contrast(ink, bg), "borrowed"
            rows.append((role, bg, ink, r, how))
    return rows


def css(rows, title, hovers=(), elems=None):
    def triple(c):
        return " ".join("%3d" % round(v) for v in c)
    w = max(len(r[0]) for r in rows) + 6
    out = [f"      /* {title} */"]
    for role, bg, ink, ratio, how in rows:
        out.append(f"      {('--' + role + ':').ljust(w)}{triple(bg)};"
                   f"   /* {rgb2hex(bg)} */")
        if ink is not None:
            out.append(f"      {('--' + role + '-ink:').ljust(w)}{triple(ink)};"
                       f"   /* {rgb2hex(ink)}  {ratio:5.2f}:1  {how} */")
        out.append("")
    if hovers:
        out.append("      /* card hover accents - bold, and no two alike */")
        for i, c in enumerate(hovers, 1):
            out.append(f"      {('--hover-' + str(i) + ':').ljust(w)}{triple(c)};"
                       f"   /* {rgb2hex(c)} */")
    if elems:
        group = None
        for e in ELEM_REG:
            k = e["key"]
            if k not in elems:
                continue
            if e["group"] != group:
                group = e["group"]
                out.append("")
                out.append(f"      /* {group} */")
            out.append(f"      {('--' + k + ':').ljust(w)}{triple(elems[k])};   /* {rgb2hex(elems[k])} */")
    return "\n".join(out).rstrip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("colours", nargs="*")
    ap.add_argument("--slot", action="append", default=[], metavar="role=#hex")
    ap.add_argument("--ink", action="append", default=[], metavar="role=#hex")
    ap.add_argument("--var", action="append", default=[], metavar="name=#hex",
                    help="per-element override, e.g. --var hero-bg=#DE5438")
    ap.add_argument("--title", default="palette")
    ap.add_argument("--hover", action="append", default=[], metavar="#hex",
                    help="set the card-hover colours; give one to use it for all")
    ap.add_argument("--hue-rot", type=float, default=0.0,
                    help="rotate the card-hover hues, as the builder's slider does")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    if not a.colours:
        ap.error("give me at least one hex colour")

    pinned = {}
    for s in a.slot:
        k, _, v = s.partition("=")
        if k not in ROLES:
            ap.error(f"unknown slot {k!r}; pick from {', '.join(ROLES)}")
        pinned[k] = hex2rgb(v)
    ink_over = {}
    for s in a.ink:
        k, _, v = s.partition("=")
        ink_over[k] = hex2rgb(v)
    elems = {}
    for s in a.var:
        k, _, v = s.partition("=")
        if k not in ELEMENTS:
            ap.error(f"unknown element {k!r}; pick from {', '.join(ELEMENTS)}")
        elems[k] = hex2rgb(v)

    palette = [hex2rgb(c) for c in a.colours]
    slots = assign(palette, pinned)
    rows = build(slots, ink_over)
    if a.hover:
        chosen = [hex2rgb(h) for h in a.hover]
        hovers = [chosen[i % len(chosen)] for i in range(HOVERS)]
    else:
        hovers = hover_set(slots["surface"], palette, rot=a.hue_rot)

    print(f"{'slot':9s} {'background':10s} {'ink':10s} contrast  how")
    print("-" * 54)
    worst = 99
    for role, bg, ink, ratio, how in rows:
        ink_s = rgb2hex(ink) if ink else "--"
        flag = "" if ratio >= FLOOR else "   <-- FAILS AA"
        if ink:
            worst = min(worst, ratio)
        print(f"{role:9s} {rgb2hex(bg):10s} {ink_s:10s} {ratio:6.2f}:1  {how}{flag}")
    for i, c in enumerate(hovers, 1):
        r = contrast(c, slots["surface"])
        flag = "" if r >= 3.0 else "   <-- too faint"
        print(f"hover-{i:<3d} {rgb2hex(c):10s} {'--':10s} {r:6.2f}:1  vs surface{flag}")
    print("-" * 54)
    print(f"lowest text pair: {worst:.2f}:1   (WCAG AA body needs {FLOOR})")
    print()
    by_hand = set(elems)
    elems = resolve_elements(rows, elems)
    print()
    print(f"{len(elems)} element colours resolved "
          f"({len(by_hand)} set by hand, {len(elems) - len(by_hand)} derived)")
    worst_el, worst_r = None, 99
    for e in ELEM_REG:
        if not e["on"]:
            continue
        r = contrast(elems[e["key"]], elems[e["on"]])
        if r < (e["need"] or 0) and r < worst_r:
            worst_el, worst_r = e["key"], r
    if worst_el:
        print(f"  !! {worst_el} only reaches {worst_r:.2f}:1")
    block = css(rows, a.title, hovers, elems)

    if a.write:
        root = pathlib.Path(__file__).resolve().parent.parent
        for name in ("index.html", "book.html"):
            p = root / name
            txt = p.read_text()
            new, n = re.subn(
                r"(/\* PALETTE:START \*/).*?(\n\s*/\* PALETTE:END \*/)",
                lambda m: m.group(1) + "\n" + block + m.group(2),
                txt, flags=re.S)
            if not n:
                print(f"!! no PALETTE markers in {name}, skipped", file=sys.stderr)
                continue
            p.write_text(new)
            print(f"wrote {name}")
        # a snapshot of what is now on the page, so the builder opens
        # showing the live theme instead of a hard-coded default
        import json
        (root / "tools" / "current-theme.json").write_text(json.dumps({
            "title": a.title,
            "palette": [rgb2hex(c) for c in palette],
            "pinned": {k: rgb2hex(v) for k, v in pinned.items()},
            "inkOverride": {k: rgb2hex(v) for k, v in ink_over.items()},
            "elements": {k: rgb2hex(elems[k]) for k in by_hand},
            "hueRot": a.hue_rot,
        }, indent=2) + "\n")
        print("wrote tools/current-theme.json")
    else:
        print(block)


if __name__ == "__main__":
    main()
