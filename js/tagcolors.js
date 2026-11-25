/**
 * e621 tag categories and their colors, tuned to stay readable
 * (WCAG contrast >= 4.5) on this site's dark red backgrounds.
 */
export const TAG_CATEGORY_IDS = Object.freeze({
  0: "general",
  1: "artist",
  2: "contributor",
  3: "copyright",
  4: "character",
  5: "species",
  6: "invalid",
  7: "meta",
  8: "lore",
});

// e621's palette, with copyright, character, species, invalid, and lore
// lightened slightly for the dark theme.
export const TAG_CATEGORY_COLORS = Object.freeze({
  general: "#b4c7d9",
  artist: "#f2ac08",
  contributor: "#c0c0c0",
  copyright: "#e64de6",
  character: "#21c321",
  species: "#f0703a",
  invalid: "#ff5c5c",
  meta: "#ffffff",
  lore: "#6fb44f",
});

/** Category name from an e621 category number or name; unknown -> "". */
export function tagCategoryName(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" || /^\d+$/.test(String(value))) return TAG_CATEGORY_IDS[Number(value)] || "";
  const name = String(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(TAG_CATEGORY_COLORS, name) ? name : "";
}

export function tagCategoryColor(value) {
  const name = tagCategoryName(value);
  return name ? TAG_CATEGORY_COLORS[name] : "";
}

function luminance(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
