# Changelog

## 0.4.1 — 2026-09-16

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
