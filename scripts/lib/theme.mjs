// Themes are data: fonts, palette roles, a type scale with enforced minimum sizes, and margins.

// Minimum sizes are rules, not suggestions: text below its role's minimum fails the build.
// uni-deck wrote "body ≥ 13–14 pt" into its skill and still shipped decks with 40 % of text under 12 pt.
const ROLES = {
  title: { size: 30, lineSpacing: 1.05, color: "primary", min: 24 },
  kicker: { size: 10, color: "muted", caps: true, spacing: 2.2, min: 10 },
  label: { size: 11, color: "muted", caps: true, spacing: 1.2, bold: true, min: 10 },
  lead: { size: 18, lineSpacing: 1.25, min: 16 },
  body: { size: 15, lineSpacing: 1.25, min: 14 },
  small: { size: 13, lineSpacing: 1.2, min: 12 },
  caption: { size: 11, color: "muted", italic: true, lineSpacing: 1.15, min: 10 },
  source: { size: 10, color: "muted", lineSpacing: 1.15, min: 10 },
  kpi: { size: 30, color: "primary", lineSpacing: 1, min: 22 },
  kpiLabel: { size: 12, color: "muted", lineSpacing: 1.15, min: 11 },
  cardTitle: { size: 15, bold: true, lineSpacing: 1.15, min: 13 },
  quote: { size: 22, italic: true, lineSpacing: 1.25, color: "primary", min: 18 },
  tableHead: { size: 13, bold: true, lineSpacing: 1.15, min: 12 },
  tableBody: { size: 13, lineSpacing: 1.15, min: 12 },
  bibliography: { size: 11, lineSpacing: 1.15, min: 10 },
  number: { size: 22, color: "accent", lineSpacing: 1, min: 16 },
  pageNumber: { size: 13, color: "primary", lineSpacing: 1, min: 10 },
  coverTitle: { size: 46, color: "primary", lineSpacing: 1.05, min: 32 },
  coverSubtitle: { size: 17, color: "muted", lineSpacing: 1.25, min: 14 },
  closingTitle: { size: 30, color: "onPrimary", lineSpacing: 1.1, min: 24 },
};

export const THEMES = {
  // White ground, one main colour and one accent, hairlines instead of boxes, a running header.
  editorial: {
    name: "editorial",
    fonts: { heading: "Arial", body: "Arial" },
    palette: {
      bg: "FFFFFF",
      ink: "1A2433",
      muted: "5F6B7C",
      primary: "0F3D73",
      accent: "C4272F",
      onPrimary: "FFFFFF",
    },
    roles: ROLES,
    margins: { left: 0.75, right: 0.75, top: 0.36, bottom: 0.38 },
    gap: 0.4,
  },
};

const hex = (c) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => rgb.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");

/** Mix colour a toward b by t (0..1). */
export function mix(a, b, t) {
  const [x, y] = [hex(a), hex(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Relative luminance contrast ratio (WCAG). */
export function contrast(a, b) {
  const lum = (c) =>
    hex(c)
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [l1, l2] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Build a theme from a base plus overrides: { palette: { primary, accent }, fonts, roles }.
 * Derived tints (rule, track, tint) follow the primary colour so a topic palette stays coherent.
 */
export function makeTheme(base = "editorial", overrides = {}) {
  const t = typeof base === "string" ? THEMES[base] : base;
  if (!t) throw new Error(`Unknown theme "${base}". Available: ${Object.keys(THEMES).join(", ")}`);
  const palette = { ...t.palette, ...overrides.palette };
  palette.rule ??= mix(palette.primary, "FFFFFF", 0.8);
  palette.track ??= mix(palette.primary, "FFFFFF", 0.92);
  palette.tint ??= mix(palette.primary, "FFFFFF", 0.55);
  palette.onPrimaryMuted ??= mix(palette.primary, "FFFFFF", 0.7);
  const fonts = { ...t.fonts, ...overrides.fonts };
  const roles = {};
  for (const [name, r] of Object.entries({ ...t.roles, ...overrides.roles })) {
    const face = r.face ?? (/title|kpi|number|quote/i.test(name) ? fonts.heading : fonts.body);
    roles[name] = { lineSpacing: 1.15, color: "ink", ...t.roles[name], ...r, face };
  }
  return { ...t, ...overrides, palette, fonts, roles };
}

/** Resolve a palette name ("primary") or hex ("0F3D73") to hex. */
export function color(theme, c) {
  if (!c) return undefined;
  if (theme.palette[c]) return theme.palette[c];
  if (/^[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  throw new Error(`Unknown colour "${c}". Use a hex value or one of: ${Object.keys(theme.palette).join(", ")}`);
}

/** Style for a role, with per-use overrides. Checks the size against the role's minimum. */
export function style(theme, role, over = {}) {
  const r = theme.roles[role];
  if (!r) throw new Error(`Unknown text role "${role}". Roles: ${Object.keys(theme.roles).join(", ")}`);
  const s = { ...r, ...over };
  return { ...s, role, color: color(theme, s.color) };
}
