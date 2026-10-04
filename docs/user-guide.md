# Prism Mapper user guide

The reference for the editor: what every tool does and where the limits are. Install a download from [GitHub Releases](https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest) before starting. The installed app runs locally without internet. If you have never used the app, start with [Getting started](getting-started.md), which covers installation, transferring downloads to an offline device, and a first projection. This guide describes the upcoming 0.6 development version. Scenes and timeline are not included in the 0.5.0 downloads.

Prism Mapper is a half vibe-coded, half-tested project (see the [README](../README.md#how-well-is-it-tested)). Where this guide says something works, it works as far as the automated checks and the testing described in [VALIDATION.md](../VALIDATION.md) go. Where something has not been tried on real hardware, the guide says so.

**On this page:** [First indoor mapping](#first-indoor-mapping) · [Mapping and layers](#mapping-and-layers) · [Scenes and timeline](#scenes-and-timeline) · [Controls](#controls) · [Phones and tablets](#phones-and-tablets) · [Animation library](#animation-library) · [Halloween collection](#halloween-collection) · [Audio react](#audio-react) · [Saving, moving and updating](#saving-moving-and-updating) · [Current limits](#current-limits)

## First indoor mapping

1. Connect your projector. On a Mac use **System Settings → Displays**, on Windows press **Windows + P** and choose **Extend**, so the editor and the projector have separate views.
2. Aim and focus the projector so your wall or object fits inside the beam. Keep it fixed while mapping.
3. Choose your projector under **Target display** and **Open projector output**. Set a matching canvas aspect ratio to fill the display; other ratios receive black bars.
4. Use a **Rect** for a flat rectangular face: drag its four corners until the calibration grid fits. For an irregular section, choose **Line tool**, click each corner in order, then **click the first point again** to close it. Inward corners, such as an L-shaped wall section, are supported. Live point guides appear on the projector while drawing.
5. Each closed shape becomes a **layer**. Select it and choose an animation or imported image/video. Add another layer for each section. Try **Shape → Edge chase** to run light around the outline, **Triangle weave** on a triangle, or **Radar sweep** on a circle.
6. Draw a **Mask** around an area that should stay dark, such as a window. A mask blocks layers below it; layers above it can still show. The top row of the layer list is in front.
7. **Save project** stores your layout and settings in `.prism.json`. Media uses relative file paths; keep the original files with the project when moving it. Missing media stays black until you import and assign a replacement.

The default software brightness is 65%. The built-in **Setup guide** covers this workflow. Three examples require no external media: `examples/indoor-cube.prism.json`, `examples/architectural-study.prism.json`, and `examples/halloween-haunt.prism.json`.

## Mapping and layers

- **Rect / Square** use four-corner perspective warping. **Triangle / Circle** create editable polygon outlines; circles start with 32 points.
- **Line tool** creates simple outlines with 3 to 64 points. Edges may turn inward but cannot cross, touch another edge, fold back, or leave the canvas. Invalid edits keep the last valid geometry.
- Drag a point to refine an outline; double-click an edge to insert a point. Choose a point in the inspector to enter exact pixel coordinates or remove it. A shape must retain at least three points.
- Drag inside a shape to move the whole layer. **Snapping** aligns points to nearby layer points and canvas corners. Hold Shift while drawing for 45-degree angle increments.
- Drag layer rows to change stacking, or use the up/down controls. Each layer has independent visibility, lock, opacity, animation, speed, and detail. **Solo** temporarily shows one layer and the cutouts without changing saved visibility.
- **Normal**, **Add**, and **Screen** blend modes combine overlapping animation layers. Masks always use normal black compositing. **Soft edge** feathers inward in output-canvas pixels. It is a basic edge fade, not calibrated multi-projector blending.
- **Content positioning** rotates, zooms, and offsets the animation or media inside the mapped shape. Media outside its image bounds becomes transparent. The physical outline stays fixed.
- **Projector guides** show the selected outline and point numbers on the real output. Guides and drawing previews disappear during blackout and are never saved into the project.

## Scenes and timeline

Open **Scenes & timeline** in the header; on narrow windows it is the film icon. Scenes store complete snapshots of the mapped layers, including geometry, masks, stacking, sources, content transforms, blend modes and audio response settings. The media library belongs to the whole project. Master brightness and blackout remain live project controls.

### Arrange local videos for a band show

1. Align the mapping and select the non-mask surface that should show the videos. If no video surface exists, importing creates one. Other layers and their sources stay in each scene.
2. Choose **Add videos to timeline** and pick your local MP4s, MOVs or WebMs. H.264 MP4 is the usual starting format; codec support depends on the device. One scene and one timeline clip are added for each accepted video in selection order.
3. The app reads each video's metadata for its clip length. If a supported duration cannot be read, it uses **2:00** and reports how many clips need a length check. Lengths are editable as `m:ss` or a number of seconds. Press Enter or leave the field to apply the change.
4. Drag clips or use **Move earlier / Move later** to arrange them. Duplicate a clip to repeat a scene, or remove it from the timeline. Removing a timeline clip keeps its scene; deleting a scene also removes its clips.
5. Use **Play show**, **Pause show**, **Stop show** and the playhead slider. Clicking a clip or its timeline segment jumps to it. **Loop show** repeats the whole rotation; otherwise the last scene holds at the end.

For a 40-minute pre-show, add twenty two-minute videos, check that each clip is **2:00**, and confirm the total reads **40:00**. Fifteen such clips make a 30-minute rotation. Enable **Loop show** when you want it to repeat while the audience arrives.

Scene changes are clean cuts. Each video starts at its beginning when its clip starts and video audio is always muted. A clip shorter than its video cuts to the next scene at its set length; a clip longer than its video holds the video's final frame until the next scene. There are no overlapping tracks, crossfades or video trimming controls in this version.

### Capture and edit a scene

Use **Capture look** to save the currently visible mapped look as a named scene, including the displayed scene while a show is playing or paused. Then use **Add to timeline** to give it a clip. Captured clips start at **2:00**; change that length to suit the show.

**Load look** stops the show and puts the scene into the mapping editor. Adjust its corners, masks or source, then use **Update look** on that scene to store the changes. Editing the base mapping does not automatically replace saved scene snapshots. Mapping handles and projector guides are hidden while the timeline is active; stop it or load a scene to align the mapping.

If media is missing, playback is disabled for affected scene videos. Load the affected scene, import and assign the replacement media, then use **Update look**. Repeat for other scenes using the missing file. Keep originals beside the saved project so paths remain valid when moving the show.

### Keep several shows ready

Rename and save separate `.prism.json` projects for **Band intro**, **Pre-show**, **Set 1** and **Set 2**. **New show** retains your current mapping and media but clears the scene library and timeline. Save the new show under its own name. On desktop, **Quick open** lists the eight most recently opened or saved projects; a button opens the actual local file. A disconnected drive or a moved file requires reconnecting the drive or using **Open** to find its new location.

The saved project contains scenes, clip order, clip lengths and the loop setting. The playhead and current playback session are never saved. Opening another project stops the show; press **Play show** when you are ready to start it. Save before switching if you need to keep edits.

Limits are 128 scenes, 512 clips, 32 layers per scene and 256 shared media entries. Each clip can last from 0.1 seconds to 120 minutes, with a maximum of 24 hours for one rotation. Project files must fit within 5 MB; complex polygon snapshots can reach that limit before the scene or clip counts do.

## Controls

| Action                             | Control                                       |
| ---------------------------------- | --------------------------------------------- |
| Line tool / select tool            | **P / V**                                     |
| Close the current outline          | **Click first point / Enter**                 |
| Undo the last point while drawing  | **Backspace / Ctrl+Z (⌘Z on a Mac)**          |
| Cancel drawing                     | **Esc**                                       |
| Show / hide projector guides       | **G**                                         |
| Blackout / restore projected light | **B**                                         |
| Pause / resume patterns and videos | **Space**                                     |
| Pause / resume an active show      | **Space** outside focused controls            |
| Select point 1 to 9                | **1 to 9** (inspector supports every point)   |
| Nudge selected point               | **Arrow keys** (one output pixel)             |
| Nudge 10 pixels                    | **Shift + Arrow keys**                        |
| Undo / redo edits                  | **Ctrl+Z / Ctrl+Shift+Z** (⌘Z / ⇧⌘Z on a Mac) |
| Save project                       | **Ctrl+S** (⌘S on a Mac)                      |
| Remove unlocked selected layer     | **Delete / Backspace** outside drawing mode   |
| Close projector output             | **Esc** outside drawing mode                  |

B and Esc also work when the projector window has focus. Locking prevents geometry edits and deletion. Solo, guides, unfinished outlines, and animation mixes are temporary session controls.

Space and Enter act on the button or control that has the keyboard focus. Click an empty part of the stage to hand the keys back to the editor.

## Phones and tablets

Prism Mapper switches to a touch layout when its window is narrower than 1050 pixels. Every phone and most tablets in portrait are narrower than that, and a narrow desktop app window gets the same layout.

- Five tabs at the bottom open sheets: **Layers**, **Looks** (the animations and your own pictures and videos), **Adjust** (the settings of the selected layer), **Audio** and **Show** (output and brightness).
- **Select** and **Line tool** sit at the top with undo, redo, pause and blackout. Drag corners with a finger. Tap the first point again to close an outline. Touch targets are at least 44 pixels.
- The header's **film icon** opens **Scenes & timeline**, including video import, scene capture, clip order and the show playhead. The bottom **Show** tab remains the output and brightness controls.
- **Show, then Present on this screen** fills the screen with only the mapped light. A phone or tablet whose screen is cabled or cast to a projector can be the projector's source this way. Turn on **Align** to see the outlines and drag corners while presenting. Tap the screen to bring the controls back. **Blackout** turns the light off at once.
- On Android the Back button closes a sheet, cancels an outline you are drawing, leaves Present, and otherwise leaves the app.
- The screen stays on while the app is in front.
- Phones cannot capture the sound of other apps, so **Audio react** listens to the microphone only. The app asks for permission the first time you tap **Start listening**.
- All orientations work.

Showing the output through a cable, AirPlay, Chromecast or screen mirroring has not been tried with real hardware, and nothing has been tried with a physical projector on a phone or tablet.

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

**Speed** runs from 0 to 3×; 0 freezes just that layer. **Detail** runs from 0.5 to 3×. Shape effects also offer an accent color and outline width. Edge effects follow the actual outline, including inward corners and perspective quads. The rest of the library fills any shape; content positioning changes the composition inside it.

**Play a mix** cycles the selected animation layer every 20 seconds. Pause stops animation and the mix. Manually choosing a material, switching layers, opening a project, or starting a show stops the mix. Resume starts a fresh interval. Use **Scenes & timeline** to save a deliberate sequence instead.

The original shader code is included under the MIT license. Playback needs no downloaded videos or external service.

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

On Android, iPhone and iPad the microphone is the only source. The desktop apps can also use a system output capture on supported systems.

## Saving, moving and updating

**Save project** writes a `.prism.json` file with your layout, settings and any scenes and timeline. It does not contain the pictures and videos: it only remembers each one by name and relative path. Keep the media files in a folder together with the project, and move or share the whole folder. Media that cannot be found stays black until you import and assign a replacement. After replacing a scene's source, use **Update look** to keep that change in the saved scene.

Generated-pattern drafts and, in the phone apps, imported media are kept in the device's own storage, so a restart normally brings the work back. App storage can be cleared by the system or by uninstalling, so **Save project** and copies of your original media are the reliable backup. If the storage refuses to save, the app says so and keeps the open project.

Projects move between the apps in both directions. A project saved in a desktop app opens in a mobile app, and the other way round, but the media files do not travel with it: pictures and videos show as missing until you add them again on the new device.

Projects open with **Open** in the app, and on a phone through the system's file picker. On Windows the installer (unless you untick the option) adds **Open in Prism Mapper** to the right-click menu of `.prism.json` files and lists Prism Mapper under **Open With** for JSON files. On a Mac, Prism Mapper is listed under **Open With**. Double-clicking is not set up on purpose, because that would make Prism Mapper the default program for every JSON file.

Updates are manual. Download the new app and checksum from [GitHub Releases](https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest) on a computer with internet, check the checksum, and transfer the download to the offline device if needed. Save your projects and media before changing the app. Then:

| Where             | How                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows installer | Close Prism Mapper and run the newer `Setup.exe`. It updates the installed copy.                                                                                                                                                                                             |
| Windows ZIP       | Extract the new ZIP and run the new copy. Delete the old folder when you are done.                                                                                                                                                                                           |
| Mac               | Quit Prism Mapper, then replace **Prism Mapper.app** with the new copy.                                                                                                                                                                                                      |
| Android           | Builds with temporary signatures need the old version uninstalled first (save your projects as files and keep your media before that, because uninstalling removes the app's data). Then install the new APK. Builds signed with the same key can update the installed copy. |
| iPhone or iPad    | Re-sign and sideload the new unsigned IPA, or build and sign the new source with Xcode. A free Apple ID requires a refresh every 7 days.                                                                                                                                     |

There is no automatic updater. **Help, then Download updates** opens the release page. The apps keep the same identity between releases, so drafts normally survive an update on the same computer and user account. Do not keep your only copy of a project or its media inside the application folder.

The 0.6 development version reads schema versions 1, 2 and 3. Existing version-1/2 mappings without a show continue to save as version 2; projects with scenes and timelines save as version 3 and require Prism Mapper 0.6 or later. Version 0.5 cannot open version-3 files. Prism Mapper 0.1 and 0.2 cannot open version-2 projects. Version 0.3 understands their mapping geometry but drops audio response settings when it saves. Use 0.4 or later to keep those settings, and keep a separate copy before opening a project in an older app.

## Current limits

This is an early application. Curved-object mesh deformation, multi-projector routing and calibrated edge blending, overlapping timeline tracks and crossfades, DMX/OSC/MIDI, audio mixing, Syphon/Spout/NDI, auto-calibration and camera alignment remain future work.

Polygon content uses the outline's bounding rectangle; arbitrary polygons do not provide independent perspective control for every point. Use separate perspective quads for angled flat faces. Circular outlines are polygon approximations.

Scenes use a shared timestamped show clock across the preview and projector output. Decoders are not locked to the same hardware video frame, so this is not a frame-accurate multi-output playback system. Outside a show, procedural phases can differ between windows. Video audio is muted. The projector output does not reopen automatically after a restart.

The desktop apps show the output on a second display through a separate window. The phone apps have no second window, so they use **Present on this screen** and rely on the device's own screen mirroring or cable output.

The phone apps keep their data in the local web view's storage, which has a limit that depends on the device. A very large video may not fit; the app says so instead of failing silently.

On Android phones with Google Play services, Android's web view asks Play services for fonts when the app starts. If Play services restart in those first seconds, for example right after the phone has booted, Android can close Prism Mapper once. Open it again: nothing is lost, because the app was only starting. [VALIDATION.md](../VALIDATION.md) has the details.

For developers, `npm run dev` starts a local browser preview at http://127.0.0.1:5178. Native display selection and native file dialogs need a desktop app.

Physical system-output audio capture has not been verified on any platform. No version has been tested with a physical projector on Windows, Android, iPhone or iPad.
