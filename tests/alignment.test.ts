import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  ALIGNMENT_SOURCE,
  createProject,
  defaultEdgeWidth,
  newSurface,
} from "../src/model.ts";
import { ANIMATIONS, CATALOG, patternById } from "../src/patterns.ts";
import { createShapeSurface } from "../src/polygon.ts";
import { validateBrowserProject } from "../src/project-validation.ts";

test("the alignment outline is a static utility with a shader and thumbnail of its own", () => {
  const entry = patternById.get(ALIGNMENT_SOURCE);
  assert.ok(entry, "the default material is in the catalog");
  assert.equal(entry.category, "Utility");
  assert.equal(entry.animated, false);
  assert.ok(!ANIMATIONS.some((pattern) => pattern.id === entry.id));
  assert.equal(
    CATALOG.filter((pattern) => pattern.shader === entry.shader).length,
    1,
    "no other material uses its shader id",
  );
  assert.ok(
    existsSync(new URL("../public/previews/alignment.png", import.meta.url)),
    "its thumbnail ships with the app",
  );
});

test("every new surface and outline starts as the alignment outline", () => {
  assert.equal(createProject().surfaces[0].source, ALIGNMENT_SOURCE);
  for (let index = 0; index < 12; index++)
    assert.equal(newSurface(index).source, ALIGNMENT_SOURCE);
  for (const preset of [
    "rectangle",
    "square",
    "triangle",
    "circle",
    "polygon",
  ] as const)
    assert.equal(
      createShapeSurface(preset, 3).source,
      ALIGNMENT_SOURCE,
      `${preset} preset`,
    );
});

test("projects saved with another animation keep it", () => {
  for (const source of ["aurora", "edge-chase", "radar", "solid"]) {
    const project = createProject();
    project.surfaces[0].source = source;
    assert.equal(validateBrowserProject(project).surfaces[0].source, source);
  }
  const saved = validateBrowserProject(createProject());
  assert.equal(saved.surfaces[0].source, ALIGNMENT_SOURCE);
  assert.equal("edgeWidth" in saved.surfaces[0], false);
});

test("the alignment outline defaults to a wider outline than the shape animations", () => {
  assert.equal(defaultEdgeWidth(ALIGNMENT_SOURCE), 20);
  for (const pattern of CATALOG)
    if (pattern.id !== ALIGNMENT_SOURCE)
      assert.equal(defaultEdgeWidth(pattern.id), 12, pattern.id);
  assert.equal(defaultEdgeWidth("media:photo"), 12);
});
