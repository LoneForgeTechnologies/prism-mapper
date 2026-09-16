import definitions from "../shared/patterns.json";
export const CATALOG = definitions;
export const PATTERNS = CATALOG.map((pattern) => pattern.id);
export const ANIMATIONS = CATALOG.filter((pattern) => pattern.animated);
export const CATEGORIES = [
  "All",
  "Shape",
  "Halloween",
  "Atmosphere",
  "Geometry",
  "Playful",
  "Utility",
];
export const patternNames: Record<string, string> = Object.fromEntries(
  CATALOG.map((p) => [p.id, p.label]),
);
export const patternById = new Map(CATALOG.map((p) => [p.id, p]));
