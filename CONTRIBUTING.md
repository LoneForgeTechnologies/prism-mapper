# Contributing

Prism Mapper is an MIT-licensed early projection-mapping app for Windows, Mac, Android, iPhone and iPad, and it is a half vibe-coded, half-tested project. Contributions should be original or carry a compatible license. Do not copy proprietary applications' code, assets, or branding.

AI-assisted contributions are welcome, as the project itself is full of them, but you are responsible for what you submit: read it, run it, and say in the pull request what you tried and on which device.

Explain the practical mapping problem and include steps to reproduce and verify the behavior. Run `npm run build`, `npm run format:check`, `npm test`, and the relevant UI and desktop checks (the README lists them). Pull requests run the same checks on GitHub, and the phone apps are built and started on emulators and simulators when the app or the native projects change. Geometry changes need mathematical edge cases; output changes should be tried on an extended display when available. The mapping GPU test covers concave outlines, masks, blend modes, feathering, content transforms, and the low-uniform WebGL fallback.

Keep normal projector output free of editor controls. Temporary alignment guides must be optional outside drawing and must disappear during blackout. Handle missing media, projector removal, and graphics failure explicitly. Preserve validated project compatibility or version the schema; keep the native and browser validators in agreement. Keep the installed apps self-contained, with all editor assets and generated animations bundled. Do not add telemetry, accounts, remote asset downloads, hosted app routes, or internet requirements to local use. GitHub is the distribution route for source and installable releases; local browser previews remain a development tool.

To add a generated material, add a unique ID, shader number, category, and description in `shared/patterns.json`, implement its shader in `src/animations/` and renderer dispatch, then generate its thumbnail. Test animation, pause, zero speed, detail, and blackout. Respect surface clipping and content positioning; edge effects use projector-pixel outline distances instead of assuming a rectangle.

Good next contributions: media relinking and packaging, grid/mesh deformation, synchronized playback, saved cues, keyboard-only outline creation, and distributable signed builds. Discuss larger changes before implementing them.

Audio changes should exercise generated PCM, missing/denied/disconnected sources, pending-start cancellation, Stop, and stale-signal recovery. Keep capture explicitly user-started and local; never connect the analyser graph to speakers. Only normalized signal summaries belong on the output IPC bridge. Do not broaden camera, screen, file, or output-window privileges when adding audio sources. Physical system audio needs permission and platform testing; distinguish mocked transport coverage from a successful OS loopback test.

Be careful with older web views: the phone apps run on whatever web view the device has, and an older phone can have an old one (the Android 11 emulator in the checks runs Chrome 83 from 2020). Use `newId()` and `lastOf()` from `src/compat.ts` instead of `crypto.randomUUID()` and `Array.prototype.at()`, and avoid CSS that old engines lack. `tests/compat.test.ts` scans the source for newer APIs. Published text, including the in-app help, the README and the release notes, uses commas, colons and periods instead of em dashes and en dashes.

## Making a release

1. Pick the version and change it in `package.json` (and `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, so Xcode shows the same number). Minor and patch must stay below 100.
2. Update `CHANGELOG.md` and `VALIDATION.md`, and say honestly what was and was not tested.
3. Run the **Release** workflow by hand on your branch with **dry run** ticked. It builds, tests and checks every download and shows the release notes in the run summary, but publishes nothing.
4. Merge, then push a tag that equals `v` plus the package version, for example `v0.5.1`. The workflow builds the tag and publishes the release with every download, its checksum and `SHA256SUMS.txt`. A tag with a hyphen, such as `v0.6.0-beta.1`, is published as a pre-release.
5. Confirm that the release page describes downloading, installing and transferring the app to an offline device. The unsigned iOS IPA needs the documented signing and sideloading steps. Do not publish a hosted browser app as an installation route.
