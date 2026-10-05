# Project format, version 2

`.prism.json` is UTF-8 JSON. Native and browser validators accept schema versions 1 and 2 and normalize both to version 2. A version-1 file gains defaults without changing its geometry. Saving writes version 2 so an older application cannot silently strip polygons or masks.

A project stores its name, width/height in output pixels, brightness, blackout, playback state, surfaces, and media references. See `src/model.ts` for types and `src/project-validation.ts` / `electron/project.cjs` for the enforced limits. Both validators must remain in agreement. Files over the native size limit are rejected before JSON parsing.

## Surfaces

The `surfaces` array is back-to-front. Each layer requires a unique ID, name, source, four normalized `corners`, visibility, lock, opacity, and hexadecimal color. Normalized geometry spans `[0,1]` across the output canvas.

| Optional field | Meaning and default |
| --- | --- |
| `polygon` | 3 to 64 normalized vertices; absent means a perspective quad |
| `kind` | `surface` (default) or `mask` |
| `blendMode` | `normal` (default), `add`, or `screen` |
| `speed` | 0 to 3; default 1 |
| `detail` | 0.5 to 3; default 1 |
| `edgeWidth` | 1 to 80 output pixels; default 12, or 20 for the alignment outline |
| `feather` | 0 to 80 output pixels; default 0 |
| `audio` | Optional per-layer response: enabled, band, amount, mode |
| `content` | Rotation in degrees, scale, offsetX, offsetY; defaults 0, 1, 0, 0 |

Content rotation accepts -180 to 180 degrees, scale 0.1 to 4, and offsets -1 to 1. Content transforms change sampling inside a surface; they do not move its mapped geometry. Media samples outside their unit rectangle are transparent.

For polygons, `corners` must equal the axis-aligned bounding rectangle in top-left, top-right, bottom-right, bottom-left order. The polygon determines clipping and edge effects; the rectangle determines content UVs. Quads retain inverse-homography perspective sampling. Polygon outlines may be concave and use either winding, but must be simple: no crossings, non-adjacent touches, duplicate points, or folded-back edges. Collinear intermediate points are supported. There are at most 32 surfaces per project.

A mask composites black over the layers below it, using its opacity and feather. Layers later in the array can cover it. Its blend mode and source are ignored by rendering, but its source must still be a valid material reference. The editor creates masks using `solid`.

## Audio responses

An optional `audio` object contains `enabled` (boolean), `band` (`level`, `bass`, `mid`, `treble`, or `beat`), `amount` (0 to 1), and `mode` (`brightness`, `zoom`, or `both`). Omission disables reaction. Masks ignore audio. This additive version-2 field requires Prism Mapper 0.4 to retain it on subsequent saves; 0.3 does not know this field.

Capture source IDs, permissions, tuning, raw audio samples, and live signal summaries are never serialized into a project. The editor owns capture. Validated, normalized level summaries are sent to the output over separate IPC at approximately 30Hz; stale data expires after 500ms. Capturing must be explicitly started after opening the application.

## Media and session state

Saved media records contain relative local paths. At runtime, the desktop shell grants opaque `media://local/` URLs only to files chosen through native import or loaded from a validated project. Project files do not contain media bytes. Browser imports use temporary blob URLs and cannot retain those files across reloads.

Solo selection, guide visibility, draft outline points, selected layer/point, and automatic-mix state are not part of the schema. Projector guides travel over separate, editor-only validated IPC. Blackout suppresses them as well as rendered light.

## Rendering

Simple polygons use cached ear-clipped triangles. Distance to the true outline drives feathering and Shape edge effects in output pixels. The normal WebGL path sends up to 64 outline points as uniforms; hardware with smaller fragment-uniform budgets uses a packed outline texture. Both paths have pixel-based regression coverage in `tests/render-advanced.cjs`.
