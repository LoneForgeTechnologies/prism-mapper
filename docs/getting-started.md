# Your first projection with Prism Mapper

Prism Mapper lets you draw a shape over a real object and fill that shape with moving light. You can learn the editor on your computer screen before connecting a projector.

## 1. Download and open

Prism Mapper is a half vibe-coded, half-tested project, so keep a copy of your projects and expect rough edges. The [README](../README.md#how-well-is-it-tested) says what has and has not been tested.

Open the [latest release](https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest), expand **Assets**, and download the file for your device:

| Your device | Download | Then |
| --- | --- | --- |
| Windows 10 or 11, 64-bit | The file ending in `-Windows-x64-Setup.exe` | Run it. SmartScreen may warn that the app is not signed: choose **More info**, then **Run anyway**. It installs for your user account and needs no administrator rights. |
| Windows, without installing | The file ending in `-Windows-x64.zip` | Right-click the ZIP, **Properties**, tick **Unblock**, press OK, extract it and start **Prism Mapper.exe**. |
| Mac with an M-series chip | The file ending in `-macOS-arm64.zip` | Open the ZIP, move **Prism Mapper.app** to **Applications** and open it. macOS 12 or newer. |
| Mac with an Intel processor | The file ending in `-macOS-x64.zip` | The same steps. |
| Android 7 or newer | The file ending in `-Android.apk` | Open it on the phone and allow installs from that source. Play Protect may warn that the developer is unknown. |
| iPhone or iPad | The [web app](https://loneforgetechnologies.github.io/prism-mapper/) | Open it in Safari, tap **Share**, then **Add to Home Screen**. |

The downloads contain the app and its runtime, so you do not need Node.js. The separate **Source code** ZIP is for developers.

The Mac app is ad-hoc signed and not notarized, so macOS can show a first-launch warning. Read [Apple's instructions for opening downloaded apps](https://support.apple.com/en-us/102445) and only proceed if you trust the download and its origin. If macOS reports malware or a damaged file, stop and report the exact message rather than treating it as an ordinary unidentified-developer prompt.

The last recorded test with a physical projector was version 0.2 on a Mac. Everything else, including every Windows, Android, iPhone and iPad build, was tried by automation on cloud computers, emulators and simulators. Developers can also build everything from source, see the README.

## 2. Connect the projector

1. Plug the projector into the computer and turn it on.
2. Set it up as an **extended display**, so it is separate from your main screen. On macOS, use **System Settings → Displays**. On Windows, press **Windows + P → Extend**.
3. Aim and focus the projector on the object or wall. Moving the projector afterward changes where every mapped point lands.
4. In Prism Mapper, select the projector under **Target display**, then click **Open projector output**.
5. Choose a canvas resolution or aspect ratio matching the projector. A mismatched ratio leaves black bars.

The editor remains on your computer, while the output window shows only projected content. Press **B** to turn the output black or restore it. Press **Esc** outside drawing mode to close the output window. If you have no projector connected, work in the editor preview for now.

On a phone or tablet there is no second window. Plug the device into the projector with a video cable, or mirror its screen to it, then open **Show** and choose **Present on this screen**. Present fills the screen with only the mapped light. Turn on **Align** to see the outlines and drag the corners while presenting, and tap the screen to bring the controls back. In a browser, choose **Present on this screen** after dragging the window onto the projector. These ways of showing the output have not been tried with real hardware.

## 3. Map one section

For a rectangular face, click **Rect** and use **Utility → Calibration grid** while aligning. Drag each of its four corner points until the projected rectangle fits the real face. These four points provide perspective correction.

For a triangle, irregular object, or wall section with inward corners:

1. Click **Line tool**.
2. Click the corners in order around the perimeter.
3. Click the **first point again** to close the outline. **Enter** also closes it once you have at least three points.

Live guides show the points on the projector while drawing. Press **Backspace** to remove the last unfinished point or **Esc** to cancel. Outlines can have 3 to 64 points; their edges cannot cross or touch another edge. A closed outline becomes a layer.

Drag a finished point to adjust it. Double-click a polygon edge to add another point. Use the inspector to enter exact coordinates or remove a point. **Projector guides** helps you check a finished outline. Lock a layer when its geometry is aligned.

Polygon content fills the outline's bounding rectangle. For an object with several angled flat faces, use a separate perspective rectangle for each face.

## 4. Give each section its own animation

Select a layer and choose a thumbnail from the library. Try:

- **Shape → Edge chase** for light following an irregular outline.
- **Shape → Triangle weave** for triangles, or **Radar sweep** for circles.
- **Atmosphere → Ocean** for moving color across a wall.
- **Halloween** for watching eyes, ghosts, pumpkins, and fictional horror effects.

Add another rectangle or outline for the next section. Each layer has its own animation, speed, detail, visibility, and opacity. Drag rows to reorder them; the **top row is in front**. Use **Solo** to inspect one layer temporarily. There can be up to 32 layers.

Choose **Mask** and draw around a place that should remain dark, such as a window. A mask covers layers below it. A layer above the mask can still appear there.

**Content positioning** rotates, zooms, or moves the image inside the mapped outline. It leaves your alignment in place. Imported videos loop without sound; this app does not mix or play their audio.

## 5. Make a layer react to sound

1. Click **Audio react** above the canvas.
2. Under **Listen to**, choose **Microphone / audio input** or **System output · current mix**. For an input, choose the desired microphone, USB interface, or virtual audio device.
3. Click **Start listening** and grant the requested OS microphone or system-audio permission. Permission is only needed for listening; animation playback works without it.
4. Confirm that the live meters move. Select a layer and enable **React this layer to audio**.
5. Choose volume, bass, mids, treble, or pulses, then **Brightness**, **Zoom**, or **Both**. Try different frequency bands on different layers.

Use gain for a quiet input, noise gate for background hiss, and smoothing for gentler motion. **Stop listening** releases the audio source. Listening starts off each time you launch the app, even if a project contains response settings.

System output means the computer's current playback mix; it is not a separate selectable tap for every speaker or headphone device. Route playback in your OS, or use a virtual loopback device as an input, if you need a particular route. Native system capture is implemented for supported macOS 14.2+ and Windows systems, but a physical system-output capture has not yet been verified. Use an available microphone or input if system capture is unavailable.

Audio stays on the computer and is analyzed without recording, uploading, or being played back through the speakers. If access is denied, correct the app's permission in your OS settings, then try **Start listening** again; a restart may be needed after changing a permission.

## 6. Save, share, and update

Click **Save project** to create a `.prism.json` file. To share a layout made only from generated animations, send that file to someone using Prism Mapper 0.4 or later.

For imported images or videos, keep a project folder containing the `.prism.json` and its media, then share the whole folder. The saved project references media by relative path and does not bundle it. Missing media appears black until you import and assign a replacement. Your projector alignment is specific to your room; someone using another projector position will need to adjust the points.

Generated-pattern drafts normally recover on the same computer and user account, but an explicit saved project is the reliable way to move or back up your work. Audio source selection, listening state, tuning, solo, guides, unfinished outlines, and automatic mixes are session controls and are not saved in the project.

For an update:

1. Save your project and keep its media files.
2. Use **Help → Download updates**, or open the [latest release](https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest), and download the file for your device again.
3. Quit Prism Mapper. On Windows run the newer Setup over the installed copy (or extract the new ZIP). On a Mac replace the old app with the new copy. On Android install the newer APK, and uninstall the old one first if Android refuses (save your projects as files before that, because uninstalling deletes the app's data). The web app tells you when a new version is ready and asks you to reload.
4. Open your saved project if needed. Output and audio listening must be started again.

The application keeps the same identity between releases, preserving its local draft under normal updates. There is no automatic updater. Store your projects and media outside the application folder so replacing the app cannot replace your only copy.

Current releases open project schema versions 1 and 2 and save version 2. Projects also move between the desktop apps, the phone apps and the web app, but their pictures and videos do not travel with them. App versions 0.1 and 0.2 cannot open version-2 projects. App version 0.3 can read version-2 mapping geometry but drops audio response settings if it saves the project. Use 0.4 or later for projects with audio responses.

## Need help?

Use **Help → Getting started** (or the **?** button) to return to this guide. Check the [user guide](user-guide.md) for the controls and the current limits. To report a problem, [open a bug report](https://github.com/LoneForgeTechnologies/prism-mapper/issues/new/choose) with your app version, device and system, projector connection, exact message, and steps to reproduce. A small example using generated animations is useful; leave out private media and personal file paths.

Developers can run from the source folder with Node.js 22.12 or newer:

```sh
npm ci
npm start
```
