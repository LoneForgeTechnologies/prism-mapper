# Version 0.4.1 public release validation

Tested September 16, 2026 on Apple silicon macOS.

- Production build, formatting, and all 47 unit tests passed.
- The distribution script assembled an isolated Apple silicon app, verified its ad-hoc signature and ZIP integrity, and generated a SHA-256 checksum. The archive includes the runtime licenses and three original example projects.
- The packaged app passed native startup/version checks, the 49-material catalog and Halloween thumbnails, triangle creation, exact project Save/Open, capture-off defaults, and all four Help menu links. Tests used a temporary profile and did not open projector output or start physical audio capture.
- A fresh extraction of the downloadable ZIP passed signature verification and the same packaged smoke test with the software GPU settings used in CI.
- Publication review found no credentials, personal media, mapping backups, development dependencies, or local QA artifacts in the intended public source and distribution. Original generated thumbnails are included.
- The release is ad-hoc signed, not Apple-notarized. macOS 12 or newer on Apple silicon is required. First-launch Gatekeeper approval and physical system-audio capture remain platform checks for users; the earlier physical-projector routing evidence is recorded below.

# Version 0.4 Halloween and audio validation

Tested September 12, 2026 on Apple silicon macOS, Electron 41.10.7.

- TypeScript/production build and 45 unit tests passed, including RMS/DC rejection, frequency bands, envelope/gate/onset response, finite bounded values, capture lifecycle, permission boundaries, and saved per-layer audio configuration.
- All 49 materials are distinct and nonblank. All 46 animations move, pause, freeze at speed zero, respond to detail, and obey blackout. The 12 new Halloween materials also passed the WebGL compact-uniform fallback. Actual shader thumbnails were generated and visually inspected.
- GPU audio checks passed on both renderer paths: independent bands/layers, brightness ceiling, zoom without moving clipping boundaries, masks unaffected, pause/resume, blackout, stop, and stale-input recovery.
- Audio UI checks used a real WebAudio analyser fed by a generated oscillator stream. They passed explicit Start, source/device selection, metering, gain/gate/smoothing, per-layer settings, permission error/retry, missing audio, disconnect, pending-start cancellation, capture across inspector tabs, and Stop after deleting the last layer. No real microphone or speaker was used. Layout was reviewed at 1460×940 and 1120×740.
- Native audio checks used Chromium's synthetic microphone without bypassing Electron's permission handlers. They verified exact-device selection, real analyser output, retained granted device names, output signal forwarding, camera/unarmed-input rejection, output read-only access, missing-device handling, Stop, and stale clearing.
- The native system-capture pipeline was exercised with an explicit test stub that substitutes the editor's own audio for OS loopback. The audio track remains live after the unused video track stops. This caught and fixed Electron 41's legacy media permission callback and request-order behavior.
- Physical microphone and OS playback capture were not exercised. First use requires the user's OS permission; actual system-loopback behavior still needs a physical audio test. System output targets the current OS mix rather than independently selecting hardware speakers.
- Existing polygon/quad, masks, blending, feathering, media transforms, geometry caching, drawing, layer-management, and persistence regressions passed. Native image/video import, streaming, Save/Open and advanced-project regressions also passed. Automatic 20-second mix/pause checks passed.
- Current mapping was backed up before updating. The installed 0.4 app opened and saved all five existing layers; an exact comparison confirmed every saved setting and corner was preserved. The Halloween library and Audio react tab are visible, and capture is OFF. Both macOS usage descriptions and the ad-hoc bundle signature were verified. Private mapping backups and QA artifacts are omitted from the MIT source ZIP.

Local evidence: `artifacts/halloween-previews.png`, `artifacts/audio-react-panel-wide.png`, `artifacts/audio-react-panel.png`, `artifacts/desktop-audio-validation.json`, and `artifacts/animation-validation.json`. Source tests reproduce the checks; runtime thumbnails are included in `public/previews`.

# Version 0.3 mapping tools validation

Tested September 12, 2026 on Apple silicon macOS.

- TypeScript and production build passed; 31 unit tests passed (19 geometry/browser schema, 12 native schema/media ranges).
- All 37 materials render distinct, nonblank GPU output; all 34 animations advance, pause, freeze at zero speed, respond to detail, and respect blackout. Category/search/source/speed/mix controls passed.
- The advanced GPU suite passed both the standard uniform path and the emulated minimum-budget WebGL1 outline-texture fallback. Covered concave and reversed outlines, clipping, masks and layer order, all blend modes with opacity, feathering at inner notches, perspective quads, transformed media/transparency, actual-outline Shape effects, and geometry caching.
- All eight Shape thumbnails regenerated and visually reviewed. Radar rings use physical surface aspect; perimeter blooms fade before interior arc-coordinate seams.
- Advanced editor interaction checks passed: click-first-point closure, Enter, Escape, Backspace, crossing rejection, drag/undo/redo, point insertion/removal (including sloped edges), presets, layer lock/solo/opacity/blend/content settings, button and drag/drop reordering, masks, persistence, and 1120×740 layout.
- Native image/video import, decoding, streamed byte ranges, Save/Open, and rejected unregistered media URLs passed.
- Native advanced Save/Open preserved every geometry and advanced setting. Version-1 files migrated without changing perspective geometry. Solo and guides did not enter saved files. Validated guide IPC, output geometry alignment, drawing cursor, closed outlines, blackout/null cleanup, and output write restrictions passed in a small internal-display window.
- Desktop smoke passed corner dragging, undo/redo, layer add/delete, blackout GPU pixels, and window-size checks. Only the built-in display was connected during this update, so the external-projector portion was skipped. The SP840 test below records the previous version's hardware check.
- Current user mapping was backed up before replacing the local application. The installed version 0.3 reopened and saved successfully; an exact comparison confirmed every mapping/settings field was preserved, with only the schema version changing to 2. Personal mapping backups and test profiles are excluded from source packaging.

Evidence is in the ignored `artifacts/` folder: `advanced-editor-ui.png`, `shape-previews.png`, `desktop-advanced-validation.json`, and `animation-validation.json`. Runtime thumbnails are included in `public/previews/`.

# Version 0.2 animation library validation

- 29 GPU materials render distinct, nonblank output with WebGL error 0.
- All 26 animated materials change between frames; pause and speed 0 freeze every effect, and detail changes their visual scale.
- Global blackout returns black GPU pixels.
- Real render previews generated for all 29 materials, and a 26-animation contact sheet visually reviewed.
- Category filtering, search, source assignment, speed presets, and mix controls passed browser interaction checks. A simulated clock verified 20-second cycling, pause/resume, and calibration stopping the mix.
- Updated desktop passed the full SP840 projector smoke test. Installed v0.2 opened with the existing mapping preserved; Ocean is live on the projector.
- All generator IDs and speed/detail values round-trip through native project serialization; legacy projects without motion settings remain valid. Invalid motion values are rejected.
- Unit tests: 19 passed (9 geometry/browser validation, 10 native schema/media).

Visual evidence is in `artifacts/animation-contact-sheet.png` and animation metrics in `artifacts/animation-validation.json` (local QA files, excluded from source packaging). Runtime thumbnails are in `public/previews` and included in the app/source.

# Version 0.1 validation

Tested September 12, 2026 on Apple silicon macOS with Electron 41.10.7.

- `npm run build`: TypeScript and production build passed.
- `npm test`: 17 tests passed (8 geometry/browser project validation, 9 native schema/media ranges).
- `node tests/desktop-media.cjs`: native PNG and VP8 WebM import and GPU rendering, advancing video playback, exact 206 byte ranges, Save/Open roundtrip, and unknown-token rejection passed. No uncaught renderer errors.
- `node tests/smoke.cjs`: desktop corner dragging, undo/redo, surface add/delete, GPU blackout, layout at small/short windows, and clean output passed.
- Extended projector detected as **SP840**, **1920 × 1080**, alongside the built-in Retina display. The app opened its separate fullscreen output on that display, rendered the warped labeled grid, accepted live updates and blackout, and closed output with Escape.
- Browser review: invalid import reports an error without crashing; malformed local draft recovers; 4:3 output is centered and letterboxed in a 16:9 window.
- Dependency audit after removing unnecessary packaging dependencies: **0 vulnerabilities** reported by npm.

These checks verify software rendering and routing to the detected projector. Physical focus, alignment to the real object, and appearance under room lighting require looking at the projected image and adjusting the corners.

Screenshots from testing are in the local `artifacts/` folder (excluded from the source package). No performance claim is based on the displayed preview FPS: automated screenshots and testing affect it. Long-running playback, other OSes, hardware disconnection under every platform, and every image/video codec have not been exhaustively tested.
