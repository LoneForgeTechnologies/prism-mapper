# Prism Mapper

A free, local desktop projection-mapping app. Fit images, videos, and generated light to walls and objects with perspective rectangles or point-by-point outlines. The working name is **Prism Mapper**. Independently implemented and MIT licensed; not affiliated with MadMapper.

**[Download the latest release](https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest)** · [Getting started](docs/getting-started.md) · [Release notes](CHANGELOG.md) · [Report a bug](https://github.com/LoneForgeTechnologies/prism-mapper/issues/new/choose)

## Download and open

Download **`Prism-Mapper-v0.4.1-macOS-arm64.zip`** from the release's **Assets** section. This build requires **macOS 12 or later on a Mac with an Apple M-series chip**. Check **Apple menu → About This Mac** if unsure. The packaged application includes its runtime; you do not need Node.js or a developer account to use it.

Double-click the ZIP, move **Prism Mapper.app** into **Applications**, and open it. GitHub's automatic **Source code** downloads are for building the app yourself; choose the macOS-arm64 ZIP to run it directly.

This early build carries an **ad-hoc signature** and is **not notarized by Apple**, so macOS may show a first-launch warning. Download from this repository and review [Apple's app-opening guidance](https://support.apple.com/en-us/102445) if a warning appears. An organization-managed computer may prevent launch.

Apple silicon macOS is the physically tested platform and the only packaged download in this release. Intel Mac, Windows, and Linux users can try [building from source](#build-from-source), but those platforms have not been physically tested. Physical system-output audio capture still needs verification on all platforms.

Normal playback stays offline. No account, subscription, telemetry, server, or API key is needed. Start with the [step-by-step setup guide](docs/getting-started.md).

## Updating

Save your work with **Save project**, then use **Help → Download updates** to open the release page. Download and extract the new release, quit Prism Mapper, and replace the Mac app with the newly extracted copy. There is no automatic updater.

The app keeps the same identity between releases, so generated-pattern drafts normally remain available on the same computer and user account. An explicit `.prism.json` save is your portable backup. Projects reference imported media rather than including it: keep those files with the project when updating or sharing. Do not put your only project or media copy inside the application folder.

## First indoor mapping

1. Connect your projector. In **System Settings → Displays**, use an **extended display** so the editor and projector have separate views.
2. Aim and focus the projector so your wall or object fits inside the beam. Keep it fixed while mapping.
3. Choose your projector under **Target display** and **Open projector output**. Set a matching canvas aspect ratio to fill the display; other ratios receive black bars.
4. Use a **Rect** for a flat rectangular face: drag its four corners until the calibration grid fits. For an irregular section, choose **Line tool**, click each corner in order, then **click the first point again** to close it. Inward corners, such as an L-shaped wall section, are supported. Live point guides appear on the projector while drawing.
5. Each closed shape becomes a **layer**. Select it and choose an animation or imported image/video. Add another layer for each section. Try **Shape → Edge chase** to run light around the outline, **Triangle weave** on a triangle, or **Radar sweep** on a circle.
6. Draw a **Mask** around an area that should stay dark, such as a window. A mask blocks layers below it; layers above it can still show. The top row of the layer list is in front.
7. **Save project** stores your layout and settings in `.prism.json`. Media uses relative file paths; keep the original files with the project when moving it. Missing media stays black until you import and assign a replacement.

The default software brightness is 65%. The built-in **Setup guide** covers this workflow. Three examples require no external media: `examples/indoor-cube.prism.json`, `examples/architectural-study.prism.json`, and `examples/halloween-haunt.prism.json`.

## Mapping and layers

- **Rect / Square** use four-corner perspective warping. **Triangle / Circle** create editable polygon outlines; circles start with 32 points.
- **Line tool** creates simple outlines with 3–64 points. Edges may turn inward but cannot cross, touch another edge, fold back, or leave the canvas. Invalid edits keep the last valid geometry.
- Drag a point to refine an outline; double-click an edge to insert a point. Choose a point in the inspector to enter exact pixel coordinates or remove it. A shape must retain at least three points.
- Drag inside a shape to move the whole layer. **Snapping** aligns points to nearby layer points and canvas corners. Hold Shift while drawing for 45-degree angle increments.
- Drag layer rows to change stacking, or use the up/down controls. Each layer has independent visibility, lock, opacity, animation, speed, and detail. **Solo** temporarily shows one layer and the cutouts without changing saved visibility.
- **Normal**, **Add**, and **Screen** blend modes combine overlapping animation layers. Masks always use normal black compositing. **Soft edge** feathers inward in output-canvas pixels. It is a basic edge fade, not calibrated multi-projector blending.
- **Content positioning** rotates, zooms, and offsets the animation or media inside the mapped shape. Media outside its image bounds becomes transparent. The physical outline stays fixed.
- **Projector guides** show the selected outline and point numbers on the real output. Guides and drawing previews disappear during blackout and are never saved into the project.

## Controls

| Action                             | Control                                     |
| ---------------------------------- | ------------------------------------------- |
| Line tool / select tool            | **P / V**                                   |
| Close the current outline          | **Click first point / Enter**               |
| Undo the last point while drawing  | **Backspace / ⌘Z**                          |
| Cancel drawing                     | **Esc**                                     |
| Show / hide projector guides       | **G**                                       |
| Blackout / restore projected light | **B**                                       |
| Pause / resume patterns and videos | **Space**                                   |
| Select point 1–9                   | **1–9** (inspector supports every point)    |
| Nudge selected point               | **Arrow keys** (one output pixel)           |
| Nudge 10 pixels                    | **Shift + Arrow keys**                      |
| Undo / redo edits                  | **⌘Z / ⇧⌘Z** (Ctrl on Windows/Linux)        |
| Save project                       | **⌘S** (Ctrl on Windows/Linux)              |
| Remove unlocked selected layer     | **Delete / Backspace** outside drawing mode |
| Close projector output             | **Esc** outside drawing mode                |

B and Esc also work when the projector window has focus. Locking prevents geometry edits and deletion. Solo, guides, unfinished outlines, and animation mixes are temporary session controls.

## Animation library

**46 original procedural animations**, plus calibration grid, checkerboard, and solid color. Every thumbnail is generated from the actual renderer. Category filters, search, shuffle, and a 20-second automatic mix help explore the library.

| Atmosphere | Geometry     | Playful       | Shape            |
| ---------- | ------------ | ------------- | ---------------- |
| Aurora     | Orbit        | Confetti      | Edge chase       |
| Ocean      | Neon tunnel  | Bubble garden | Edge pulse       |
| Flame      | Kaleidoscope | Silk ribbons  | Edge dashes      |
| Cloudscape | Neon grid    | Comet trails  | Contour flow     |
| Lava lamp  | Wavelength   | Fireworks     | Perimeter blooms |
| Galaxy     | Spiral       | Cherry petals | Panel sweep      |
| Rainfall   | Honeycomb    | Digital rain  | Radar sweep      |
| Snowfall   | Interference | Spectrum      | Triangle weave   |
| Fireflies  | Prism shards |               |                  |

**Speed** runs from 0–3×; 0 freezes just that layer. **Detail** runs from 0.5–3×. Shape effects also offer an accent color and outline width. Edge effects follow the actual outline, including inward corners and perspective quads. The rest of the library fills any shape; content positioning changes the composition inside it.

**Play a mix** cycles the selected animation layer every 20 seconds. Pause stops animation and the mix. Manually choosing a material, switching layers, or opening a project stops the mix. Resume starts a fresh interval. There are no transitions or saved cue lists yet.

The original shader code is included under the MIT license. Playback needs no downloaded videos or external service.

## What works in 0.4.1

- GPU perspective warping for quads and triangulated concave polygons, up to 32 layers with 64 outline points each.
- Shape presets, point-by-point drawing, point editing, snapping, projector guides, masks, blending, feathering, and content transforms.
- Layer duplication, reorder, hide, solo, lock, numeric point positioning, and undo/redo.
- 46 animations and three utility materials, per-layer speed/detail/color, real thumbnails, search and mix.
- Local images and looping muted video. PNG/JPEG/WebP and H.264 MP4/WebM are good starting points. MOV playback depends on its codec. Decode failures are shown.
- Native monitor discovery, one separate projector output, live edits, blackout, hot-plug handling, and display-sleep prevention while output is open.
- Validated local projects with relative media paths. Version 0.4.1 reads schema versions 1 and 2 and saves version 2. Prism Mapper 0.1/0.2 cannot open version-2 projects; 0.3 understands their mapping geometry but drops audio response settings when saving. Use 0.4 or later to retain those settings, and keep a separate copy before opening projects in an older app.

## Halloween collection

Twelve original effects add watching eyes, glossy blood drips, living veins, a haunted skull, restless spirits, spider webs, a blood moon and bats, a jack-o’-lantern, a dread portal, a stylized open wound, crawling swarms, and graveyard mist. Find them under **Halloween** in the source library. The blood, veins, and wound are fictional procedural horror graphics. Every effect is included in the MIT-licensed source.

## Audio react

Click **Audio react** above the mapping canvas to reveal its controls.

1. Under **Listen to**, choose **Microphone / audio input** or **System output · current mix**. For input, select a built-in mic, USB audio interface, or installed virtual audio device. Refresh the list after connecting hardware.
2. Click **Start listening**. Allow the relevant microphone or system-audio permission if your OS asks. The live meters show volume, bass, mids, treble, and detected pulses.
3. Select a mapped layer, enable **React this layer to audio**, then choose the frequency band and **Brightness**, **Zoom**, or **Both**. Response strength controls how much it changes. Different layers can react to different parts of the same audio.
4. Adjust **Input sensitivity** if needed: gain for quiet sources, noise gate for room hiss, smoothing for gentler motion. **Stop listening** releases capture immediately.

Brightness response dims between peaks and returns up to your chosen master brightness. Zoom changes content sampling inside the fixed outline. Masks are unaffected. Pause holds the response, blackout overrides it, and stopped or stale audio restores normal rendering.

System output captures the current OS playback mix. It does not independently tap a selectable speaker/headphone device; route playback in your OS or select a virtual loopback input for more control. Native output capture is implemented for supported macOS 14.2+ and Windows systems; successful physical system-output capture has not yet been verified for this release. On Linux and unsupported systems, use an exposed monitor/loopback input. Browser preview supports inputs; system-output capture requires the desktop application.

Capture is off at launch and only starts from **Start listening**. Audio is analyzed locally, without recording, speaker monitoring, uploads, or feedback. Only normalized level summaries travel to the projector window. Projects save each layer's response settings, while input choice, capture permission, gain/gate/smoothing, and current listening state belong to the session. Older version-1/2 mappings still load. Use version 0.4 to retain the optional audio response settings when saving.

Electron's system-audio implementation uses Apple's CoreAudio Tap API on supported macOS releases. See the [official capture documentation](https://www.electronjs.org/docs/latest/api/desktop-capturer). A denied permission, unsupported OS, missing track, or disconnected source is shown in the panel; select another input and start again after fixing it.

## Current limits

This is an early usable application. Curved-object mesh deformation, multi-projector routing and calibrated edge blending, cue timelines, DMX/OSC/MIDI, audio mixing, Syphon/Spout/NDI, auto-calibration, and camera alignment remain future work.

Polygon content uses the outline's bounding rectangle; arbitrary polygons do not provide independent perspective control for every point. Use separate perspective quads for angled flat faces. Circular outlines are polygon approximations.

Editor and projector animate independently: procedural phases can differ and video is not frame-locked between windows. Video is muted with no seek/scrub control. Generated-pattern layouts recover locally between sessions; **save explicitly when using imported media**. Output does not reopen automatically after restart. Saved projects reference media rather than bundling it.

`npm run dev` starts a browser preview at http://127.0.0.1:5178. Native display selection and file dialogs require the desktop app. Browser media imports use temporary blobs and must be reimported after reload; browser JSON export retains geometry and generated materials only.

## Build from source

Requires **Node.js 22.12+** (or a supported newer LTS release), npm, and a graphics-capable desktop. Download the source or clone this repository, then run from the project folder:

```sh
npm ci
npm start
```

Dependencies download during setup. On macOS, **Launch Prism Mapper.command** is also available after obtaining the source. To build a local Mac app:

```sh
npm run package:mac
```

This creates an ad-hoc signed app in `release/`. See the release workflow in `.github/workflows/` for the build used by published downloads.

## Development

```sh
npm run build                 # TypeScript and production build
npm test                      # Geometry, validation, media range tests
npm run test:smoke            # Native editor and connected-projector checks
npm run test:media            # Native media import, streaming, GPU decode, Save/Open
npm run test:desktop-mapping  # Native advanced-project round trip and guide IPC
npm run test:desktop-audio    # Fake-device native capture; requires npm run dev on port 5178
```

The native `test:desktop-audio` check requires `npm run dev` running in another terminal at http://127.0.0.1:5178.

With that dev server running, installed Google Chrome can run these GPU/UI checks:

```sh
npm run test:animations       # All 49 materials: animation, pause, speed, detail, blackout
npm run test:mapping          # Polygon/mask/blend GPU checks and editing workflow
npm run previews:shapes       # Shape-specific thumbnails
npm run test:mix              # Automatic animation mix
npm run test:audio            # Synthetic audio response and capture UI
npm run previews:halloween    # Halloween GPU validation and thumbnails
```

Code lives in `src/` (editor, model, WebGL renderer, geometry), `shared/patterns.json` (material catalog), and `electron/` (sandboxed shell, media streaming, project I/O). Preview and output share the renderer. A narrow preload bridge carries validated state; Node APIs are not exposed to the renderer. See [docs/project-format.md](docs/project-format.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

The core is MIT licensed. Dependencies retain their licenses, and Electron includes Chromium's third-party notices. Imported media belongs to its creator and is not included. Source, releases, and contributions live at [LoneForgeTechnologies/prism-mapper](https://github.com/LoneForgeTechnologies/prism-mapper).
