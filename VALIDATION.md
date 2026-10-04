# Version 0.6.0 development validation

Tested locally on October 4, 2026, before publication. This version adds saved scenes, an ordered show timeline and eight recent-project shortcuts in the desktop app. Twenty two-minute clips make a 40-minute rotation. The installed v0.5.0 downloads do not include these changes.

- The production build, formatting and 347 unit tests passed, including project v3 validation, legacy compatibility, transient playback stripping, save size limits, shared-clock playback and desktop recent-project boundaries.
- Original tiny H.264 MP4 fixtures passed real Chromium decode, ordered cue changes, paused seeks, repeated media, held final frames, show-end pause, loop boundaries, resume and independent preview/output clocks. The desktop and emulated touch UI passed scene capture/load/update, duration editing, ordering, file save/reload and quick switching. Existing mobile layout, animation mix and desktop media checks passed.
- An isolated Electron profile on this Apple silicon Mac passed native MP4 playback through the local media protocol, four separate show saves/reopens, recent-project persistence after restart and missing-file recovery. Tests opened no projector windows. The packaged Mac application started, saved/opened files and passed the existing desktop behavior checks.
- Signing configuration and failure paths passed unit tests and workflow syntax checks. Mac and Windows public signing has not been exercised because owner accounts and credentials are not configured. Android has a permanent release key, repository signing secrets and an expected public certificate fingerprint; its signed build still needs CI verification.

These are development results. GitHub CI results will be recorded with the pull request. No 0.6.0 projector session, band performance, physical phone or tablet test has been completed, and no signed 0.6.0 public release has been published.

# Distribution update, October 4, 2026

Prism Mapper is distributed through GitHub Releases as locally installed applications. The hosted GitHub Pages app has been retired. Download the installer, application ZIP, APK or unsigned IPA on a connected device, then copy it to the project device if needed. The desktop and native mobile apps bundle their editor and assets; using them does not require the retired website or an internet connection. iPhone and iPad installation still requires signing or sideloading.

The browser and offline-cache checks below record testing of the shared editor and its former browser distribution. They do not describe a currently hosted product. Native installation and signing limits remain as recorded below.

# Version 0.5.0 validation

Tested October 3 and 4, 2026, by automation only. Nobody has tried this version on a physical Windows PC, Mac, phone, tablet or projector. The tests ran in a Linux container, on GitHub-hosted Windows, macOS and Linux machines, and on Android emulators and iOS simulators. Their results are in the Checks, Mobile apps and Release (dry run) workflow runs of the pull request for this version.

What passed:

- Formatting, the production build and all 303 unit tests: 224 for the editor, the project format, geometry, audio, the web app files and the release scripts, and 79 for the desktop shell. The release file checker is among them, including that a file nobody expected is refused.
- Five browser suites in Chromium with software WebGL: the animation mix, mapping and GPU rendering, audio, the phone and tablet layout, and the offline web app (21 scenarios). The phone and tablet suite drives emulated touch screens from 320 × 568 to 1180 × 820 with real touch input. It is emulation: no physical device and no WebKit engine.
- Windows 10 and 11, 64-bit, on a Windows Server machine: the packaged app started and reported the right version, opened project files, kept a usable window size, read project media from drive, long and network paths and a project file saved by Notepad, and started from the source launcher. The ZIP unpacked and started. The Setup installer was built, installed for the current user, started, opened projects through its commands, updated a running copy with a second Setup and uninstalled.
- macOS on Apple silicon and on Intel (each on a machine of its own kind): the packaged app started, opened projects and kept a usable window size. The ZIP was unpacked the way the Finder does, its signature was verified and the app started again.
- Android: the debug APK and the shareable APK were installed on four emulator setups: Android 11 with web view 83 (from 2020), Android 14 with Google apps and web view 113, Android 14 without Google apps and web view 113, and Android 15 with web view 124. On each, both installed with the right version, started, stayed alive, drew a screen that is not blank and left no crash or not-responding report in the system log. The shareable APK also survived a rotation, and Google Play services being crashed and stopped once it had settled. The debug build was inspected from the inside: secure context, WebGL working, the native shell present, the microphone interface present and the safe-area values readable. Its web view process was then stopped on purpose, as a phone short of memory does, and the app stayed alive in the same process and drew its screen again. Emulators draw in software, so this says nothing about speed or about real graphics chips.
- iPhone and iPad: Xcode built the app for the simulator and for devices (unsigned), the app bundle and the unsigned IPA were checked, and the simulator build was installed and opened on an iPhone 17 and an iPad Pro 11-inch (M5) simulator running iOS 26.5. Both screenshots show the drawn editor.

Three results were not steady, and each is explained here.

- **Android 14 emulator with Google apps.** In one Release (dry run) the shareable APK died about ten seconds after it started, while the same commit passed in another run. The cause was found afterwards, and it very likely is not in Prism Mapper's own code. Android stops an app that holds a stable connection to a content provider when the process of that provider dies. On this emulator (web view 113.0.5672.136) the app holds such a connection to the font provider of Google Play services for the first seconds after it starts. When the emulator test crashed Play services at the first moment of that connection, Android stopped the app every time, with the message "depends on provider com.google.android.gms/.fonts.provider.FontsProvider in dying proc". The same test left the app alone on Android 11 with web view 83 and on Android 14 without Google apps, and on Android 15 with web view 124 the connection showed only now and then. The likely holder is the web view, Android System WebView: its own code contains the name of that font provider and a font lookup that requests fonts from it, and neither removing the app's own emoji start-up step nor a build whose page names only system fonts removed the connection. The exact call was not captured, because an attempt to record the app's system calls crashed the emulator. Other projects report the same message for apps that use the web view, for example [bats-lang/quire issue 220](https://github.com/bats-lang/quire/issues/220). For people this means: if Play services restart in the first seconds after Prism Mapper opens, for example right after a phone has booted, Android can close the app once, and opening it again works. The app cannot turn this off. The emulator test now crashes Play services after the app has settled (the app must survive, and it does) and at the start-up moment (reported as a known limitation, it never fails the build).
- **Intel Mac, packaged app.** In one release dry run the packaged-app smoke test failed on the Intel Mac runner after 20 seconds with no reason in the run, while the dry run before it had passed. Nothing pointed at the app, and it looked like timing on a busy shared machine. The packaged tests now wait up to 90 seconds for the first window and 45 seconds for each later step, and report why they fail.
- **iPhone simulator.** In one run the simulator refused to launch the app, and in another it showed the first page too late, while the iPad simulator and the same commit passed elsewhere. A launch is now tried three times, a screenshot is taken every ten seconds for up to ten tries, and a device that still fails is checked once more on an erased simulator. A second attempt is reported as a warning.

Not tested:

- Any physical device. The last test with a physical projector was version 0.2 on a Mac. Showing the output of a phone or tablet through a cable or a cast has not been tried.
- The microphone on Windows, Android, iPhone and iPad, and physical system-output capture on any platform.
- Windows on real hardware, on Windows 10 and on ARM processors.
- Safari, Firefox and Edge. The web app was only run in Chromium. Adding it to an iPhone Home Screen and Safari's cleanup of unused sites were not tried.
- Code signing, notarization, SmartScreen and Play Protect. The Windows, Mac and Android downloads are not signed by a known developer.
- Long sessions, battery use on phones, and screen reader use.

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
