// Boxes in inches. Every region of a slide is a Box; components are placed into boxes.

export class Box {
  constructor(x, y, w, h) {
    Object.assign(this, { x, y, w, h });
  }

  /** Right edge. */
  get x2() {
    return this.x + this.w;
  }

  /** Bottom edge. */
  get y2() {
    return this.y + this.h;
  }

  /** Shrink by margins (CSS order: top, right, bottom, left). */
  inset(t, r = t, b = t, l = r) {
    return new Box(this.x + l, this.y + t, this.w - l - r, this.h - t - b);
  }

  /** Split into columns. `spec` is a count or a list of ratios, e.g. [7, 5]. */
  cols(spec, gap = 0.4) {
    const ratios = typeof spec === "number" ? Array(spec).fill(1) : spec;
    const free = this.w - gap * (ratios.length - 1);
    const sum = ratios.reduce((a, b) => a + b, 0);
    let x = this.x;
    return ratios.map((r) => {
      const w = (free * r) / sum;
      const box = new Box(x, this.y, w, this.h);
      x += w + gap;
      return box;
    });
  }

  /** Split into rows. `spec` is a count or a list of ratios. */
  rows(spec, gap = 0.3) {
    const ratios = typeof spec === "number" ? Array(spec).fill(1) : spec;
    const free = this.h - gap * (ratios.length - 1);
    const sum = ratios.reduce((a, b) => a + b, 0);
    let y = this.y;
    return ratios.map((r) => {
      const h = (free * r) / sum;
      const box = new Box(this.x, y, this.w, h);
      y += h + gap;
      return box;
    });
  }

  /** [top part of height h, the rest below it after gap]. */
  top(h, gap = 0) {
    return [new Box(this.x, this.y, this.w, h), new Box(this.x, this.y + h + gap, this.w, this.h - h - gap)];
  }

  /** [the rest above, bottom part of height h]. */
  bottom(h, gap = 0) {
    return [new Box(this.x, this.y, this.w, this.h - h - gap), new Box(this.x, this.y2 - h, this.w, h)];
  }

  /** [left part of width w, the rest]. */
  left(w, gap = 0) {
    return [new Box(this.x, this.y, w, this.h), new Box(this.x + w + gap, this.y, this.w - w - gap, this.h)];
  }

  /** [the rest, right part of width w]. */
  right(w, gap = 0) {
    return [new Box(this.x, this.y, this.w - w - gap, this.h), new Box(this.x2 - w, this.y, w, this.h)];
  }

  with(changes) {
    const b = { ...this, ...changes };
    return new Box(b.x, b.y, b.w, b.h);
  }

  intersects(o) {
    return this.x < o.x + o.w && o.x < this.x2 && this.y < o.y + o.h && o.y < this.y2;
  }
}

export const box = (x, y, w, h) => new Box(x, y, w, h);
