# Contributing

Prism Mapper is an MIT-licensed early projection-mapping app. Contributions should be original or carry a compatible license. Do not copy proprietary applications' code, assets, or branding.

Explain the practical mapping problem and include steps to reproduce and verify the behavior. Run `npm run build`, `npm test`, and relevant UI/desktop checks. Geometry changes need mathematical edge cases; output changes should be tried on an extended display when available. The mapping GPU test covers concave outlines, masks, blend modes, feathering, content transforms, and the low-uniform WebGL fallback.

Keep normal projector output free of editor controls. Temporary alignment guides must be optional outside drawing and must disappear during blackout. Handle missing media, projector removal, and graphics failure explicitly. Preserve validated project compatibility or version the schema; keep the native and browser validators in agreement. Do not add telemetry, accounts, or internet requirements to local playback.

To add a generated material, add a unique ID, shader number, category, and description in `shared/patterns.json`, implement its shader in `src/animations/` and renderer dispatch, then generate its thumbnail. Test animation, pause, zero speed, detail, and blackout. Respect surface clipping and content positioning; edge effects use projector-pixel outline distances instead of assuming a rectangle.

Good next contributions: media relinking and packaging, grid/mesh deformation, synchronized playback, saved cues, keyboard-only outline creation, and distributable signed builds. Discuss larger changes before implementing them.

Audio changes should exercise generated PCM, missing/denied/disconnected sources, pending-start cancellation, Stop, and stale-signal recovery. Keep capture explicitly user-started and local; never connect the analyser graph to speakers. Only normalized signal summaries belong on the output IPC bridge. Do not broaden camera, screen, file, or output-window privileges when adding audio sources. Physical system audio needs permission and platform testing; distinguish mocked transport coverage from a successful OS loopback test.
