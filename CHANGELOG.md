# Changelog

## 0.6.0 (Unreleased)

This version is in development. The 0.5.0 downloads do not include these scene and timeline features.

### Scenes and local show playback

- Capture complete mapping looks as named scenes, load a scene into the editor and update its geometry, masks, sources and effects. Each scene keeps its own snapshot and uses the project's shared media library.
- Add local MP4, MOV or WebM videos as scenes and ordered timeline clips. Clip lengths use video metadata, with an editable two-minute fallback when a supported length cannot be read. Twenty two-minute clips make a 40-minute rotation.
- A full-width time ruler shows the complete rotation, with duration-scaled named video blocks beneath it. Click the ruler to seek; a moving playhead, elapsed fill and active clip highlight show where playback is. The ordered clip list remains below for editing.
- Reorder clips by drag or arrows, duplicate or remove clips, set lengths, seek, play, pause, stop and loop the rotation. Scene changes use clean cuts and video audio remains muted. Shorter videos hold their final frame until the clip ends.
- Scenes & timeline is docked under the preview instead of covering the editor, so the preview, Layers, the mapping tools and the Inspector stay visible and usable while it is open. It opens about 300 pixels tall; drag its top edge, or focus the edge and use the arrow keys, to resize it, or fold it into a single bar that keeps Play, Stop, Loop and the show clock. A short window shrinks the panel before it shrinks the preview. Phones keep a sheet above the bottom tabs with the preview above it, and a phone held sideways gets a drawer on the right. Escape closes the panel only from inside it, so it still cancels a drawing elsewhere, and Delete and the arrow keys no longer reach the selected layer while focus is in the panel.
- Preview and projector output share a timestamped show clock. Mapping handles and projector guides disappear during playback; editing or opening another project stops the show. No overlapping tracks or crossfades are added.
- Save separate project files for band intro, pre-show and each set. The desktop panel reopens the eight most recently opened or saved files. New show retains the current mapping and media while clearing scenes and clips.
- Schema version 3 stores scenes, ordered clips, durations and the loop setting. Playback position and session state are never saved. Existing version-1/2 mappings retain their compatibility; version-3 shows require 0.6 or later.
- Limits are 128 scenes, 512 clips, 32 layers per snapshot, 256 shared media entries and a 24-hour rotation. Clips range from 0.1 seconds to 120 minutes. Saves exceeding the 5 MB project-file limit are refused with an explanation before writing an unreadable file.
- Added schema and cross-runtime roundtrips, runtime/persistence separation, local video playback, show controls, dock layout and recent-project regression coverage. Physical band-show and projector validation remains pending.

### Alignment outline

- New shapes start as the **Alignment outline** instead of an animation: a white line exactly on the edge you drag, a black line just inside it and a dim gray fill so the black line shows. The dark surface outside the shape is the other black line. It applies to the starting surface, Rect, Square, Triangle, Circle and the Line tool; cutout masks stay black, and saved projects keep the animation they were saved with.
- The lines are measured in output pixels from the real outline, so they follow straight, slanted, curved and concave edges and stay sharp in the editor preview and on the projector. **Outline width** sets the white and black lines together (20 px by default, 1 to 80). The outline does not animate or use the accent color.
- Utility lists the alignment outline first, with its own thumbnail. There are still 46 animations, and four tools instead of three.
- The outline width control showed 10 px while the renderer used the documented default of 12 px. They now agree.
- Added unit, GPU (native and low-uniform fallback), editor and catalog checks, and `previews:shapes` now draws the alignment thumbnail.

### Local installation and distribution

- GitHub Releases is the installation route: Windows Setup or portable ZIP, Mac ZIP, Android APK, and an unsigned iOS IPA that requires signing and sideloading or an Xcode build.
- The hosted browser app and GitHub Pages deployment are retired. Installed apps bundle the editor, runtime and generated animations for local use without internet.
- Installation and update guides now cover downloading on another computer, checking checksums, and transferring the app, project and media to an offline device. Updates are manual.
- The source-code ZIP remains available for developers, with an initial dependency installation and build required before use.

### Signing preparation

- Mac packaging supports Developer ID signing, hardened runtime, notarization and a stapled ticket. Windows packaging stages executable files for Azure Artifact Signing before creating the portable ZIP, and signs Setup and its uninstaller. Published releases require verified signing; explicit dry runs can use development signatures.
- Android has a permanent maintainer signing key. The release pipeline verifies its expected certificate fingerprint, allowing future APKs signed with that key to update one another. Existing temporary-key installations need a saved project export and reinstall before changing to this key.
- Apple and Windows signing accounts still need owner enrollment and credential setup. Existing 0.5.0 downloads remain unchanged. Windows signatures do not guarantee an immediate SmartScreen reputation bypass, and the public unsigned iOS artifact still needs signing and sideloading.

## 0.5.0 (2026-10-04)

These historical release notes include the hosted browser app that was offered at release and has since been retired. Use the installation routes in the current README.

Prism Mapper leaves the Mac. Windows, Android, iPhone and iPad join macOS, and the project now says plainly what it is: a half vibe-coded, half-tested open-source tool. Much of the code was written by directing AI coding assistants, the automated tests are real but partial, and none of the new platforms has been tried on a physical device or with a physical projector.

### New platforms

- **Windows 10 and 11 (64-bit).** A Setup installer (for your user account by default, no administrator rights, Start Menu entry, uninstaller, in-place updates, an optional "Open in Prism Mapper" command for project files) and a portable ZIP.
- **Intel Macs.** A separate ZIP next to the Apple silicon one.
- **Android phones and tablets (Android 7 and newer).** An APK. The app has no internet permission and asks for the microphone only when you tap Start listening.
- **iPhone and iPad.** The installable offline web app, an unsigned IPA for people who sideload, and an Xcode project for people with an Apple developer account. Prism Mapper is not in the App Store or on Google Play.
- **The web app.** The same editor in a browser, installable and usable offline, published to GitHub Pages.

### Phones and tablets

- A touch layout for windows narrower than 1050 pixels, with Layers, Looks, Adjust, Audio and Show sheets, touch targets of at least 44 pixels, corner dragging with a finger and safe areas for notches.
- **Present on this screen** fills the screen with only the mapped light, so a phone or tablet cabled or cast to a projector can be its source. Corner alignment works while presenting.
- The screen stays on while the app is in front. The Android Back button closes sheets and leaves Present. All orientations work.
- The setup guide in the app, and the keyboard hints, adapt to the device: Mac, Windows, phone or browser.

### Projects and files

- Projects move between the desktop apps, the phone apps and the web app. Media files do not travel with the project: they show as missing until added again.
- The web app keeps your draft and imported media across reloads, reports storage that is blocked or full, warns when a second tab saves, and tells iPhone users about Safari's cleanup of unused sites.
- Project files from Windows (byte-order marks, long and network paths) and projects named in any script open and save correctly. A saved project is flushed to disk before it takes its final name.
- A project the operating system opens (double-click on Open With, command line, second launch) shows in the editor, and only one editor window runs at a time.

### Smaller changes

- Space and Enter act on the control that has the keyboard focus instead of pausing playback.
- Old web views are supported: no `crypto.randomUUID`, no `Array.prototype.at`, no CSS `inset` shorthand.
- The audio engine says so when the device pauses it and resumes at the next tap.
- Preview pictures stay cached across app updates when the pictures did not change.
- The projector output window has a plain title.
- Shortcut labels show Ctrl or the Command key for the system you are on.

### Building and releasing

- One release workflow builds and tests the Windows, Intel Mac and Apple silicon apps, builds the Android and iOS apps, starts the Android app on four emulator setups and the iOS app on an iPhone and an iPad simulator, checks every download against its SHA-256 checksum and publishes the release. A dry-run mode does all of it except publishing. Files that nobody expected are refused. An emulator check that fails is repeated once, and a run that needed the second attempt says so.
- The Android emulator test also crashes Google Play services, after the app has settled (the app must survive) and at the moment the app starts. The second one found that Android's web view can get the app closed once when Play services restart in the app's first seconds. That is reported as a known limitation and does not fail a build (see VALIDATION.md).
- The Android app no longer starts AppCompat's emoji font request to Google Play services, and a check of every APK keeps it that way.
- A separate workflow publishes the web app to GitHub Pages once Pages is switched on.
- Release notes list the right download for every device, explain the first-launch warnings and state the testing limits.

### Known limits

- No physical projector test of any version after 0.2, and none at all on Windows, Android, iPhone or iPad.
- Real phones and tablets have not been used. The microphone, a cable or cast to a projector and real-world performance are untested on them.
- Physical system-output audio capture has not been verified on any platform.
- On Android phones with Google Play services, the app can be closed once by Android if Play services restart in its first seconds after it starts, for example right after a phone has booted. Opening it again works. It was reproduced on an emulator and it comes from Android's web view, not from the app.
- Windows, Mac and Android builds are not code-signed, and the Mac app is not notarized. Each Android build carries a new temporary signature, so an update needs the old version uninstalled first.

## 0.4.1 (2026-09-16)

First public GitHub release, focused on making Prism Mapper easier to share and install.

- A ready-to-open ZIP download for Apple silicon Macs.
- A beginner setup guide covering projector alignment, layers, audio reaction, saving, sharing, and manual updates.
- Public source, contribution guidance, and a structured bug-report form.
- Help menu links to the guide, updates, bug reports, and source.
- A source launcher that refreshes changed dependencies and rebuilds before opening.
- Documented build and testing limits, first-launch OS warnings, and project compatibility.

This release retains the 46-animation library and mapping/audio features from 0.4.0. The Mac build is ad-hoc signed and not notarized. Apple silicon macOS is the physically tested platform and the only packaged download for this release. Intel Mac, Windows, and Linux can be tried from source but remain unverified, as does physical system-output audio capture.

## 0.4.0

- Added 12 Halloween animations: watching eyes, blood drips, veins, skull, spirits, webs, bats and blood moon, pumpkin, portal, wound, swarms, and mist.
- Added local audio analysis from a selected microphone/audio input or supported system-output capture.
- Added per-layer responses to volume, bass, mids, treble, or detected pulses, using brightness, zoom, or both.
- Added gain, noise gate, smoothing, live meters, and explicit Start/Stop listening controls.
- Retained optional layer audio settings in schema-version-2 projects. Audio capture remains off at launch; source selection and input tuning are not saved.

Synthetic audio and capture-transport tests cover the implementation. Physical system-output capture remains unverified.

## 0.3.0

- Added point-by-point outlines that close by clicking the first point, including concave shapes.
- Added rectangle, square, triangle, and circle presets; editable points; snapping; numeric positions; and live projector guides.
- Added black cutout masks, layer solo/lock/reorder, blend modes, soft edges, and content positioning.
- Added eight animations that work with mapped shapes and outlines, bringing the collection to 34 animations.
- Added schema version 2 for polygon and mask projects. Versions 0.1/0.2 cannot open these files. Version 0.3 predates and does not retain 0.4's audio settings when saving.

## 0.2.0

- Expanded the library to 26 generated animations, plus three utility materials.
- Added rendered previews, categories, search, speed/detail controls, and an automatic animation mix.

## 0.1.0

- Introduced the local Electron desktop editor, four-corner perspective mapping, and separate projector output.
- Added generated materials, local image/video imports, project Save/Open, blackout, and mapping controls.
- Released the source under the MIT license.
