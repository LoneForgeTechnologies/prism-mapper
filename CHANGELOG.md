# Changelog

## 0.5.0 (2026-10-04)

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
