# Building the Android and iPhone/iPad apps

Prism Mapper also runs as an app on Android phones and tablets, and on iPhone and iPad. The apps are the same offline web app that runs in the browser and in the desktop app, packed into a small native shell with [Capacitor](https://capacitorjs.com/) 8. There is no server, no account and no network access: everything is inside the app.

This page explains how to build the apps yourself, how the automatic builds work, how to install them, and what has and has not been tested. Prism Mapper is a half vibe-coded, half-tested project, and the phone and tablet apps have never been run on a physical device, see [What has been tested, and what has not](#what-has-been-tested-and-what-has-not).

## What is in the repository

| Path | What it is |
| --- | --- |
| `capacitor.config.ts` | One configuration for both apps: app id, app name, colors, status bar |
| `android/` | The Android project (open it in Android Studio) |
| `ios/` | The iOS and iPadOS project (open it in Xcode) |
| `mobile/` | Helper scripts: icon generator, the CI smoke tests, build checks |
| `.github/workflows/mobile.yml` | The automatic build and test of both apps |

The app id is `org.prismmapper.mobile`. It is the Android application id and the iOS bundle id. **It can never be changed once the app has been published** on Google Play or the App Store, so pick it carefully before the first publication.

The web app is never copied by hand. `npm run build` writes it to `dist/`, and `npx cap sync` copies `dist/` into `android/` and `ios/`. The copies are not committed. Always build the web app and sync before you open or build a native project. The npm scripts below do this for you.

## Version numbers

The version lives in one place, `version` in `package.json` (for example `0.5.0`).

| | Where it comes from |
| --- | --- |
| Android `versionName` | `version` in `package.json` |
| Android `versionCode` | `major * 10000 + minor * 100 + patch`, so `0.5.0` becomes `500` |
| iOS version (`CFBundleShortVersionString`) | `version` in `package.json`, set by a build step |
| iOS build number (`CFBundleVersion`) | The CI run number, or `1` for a local build |

Google Play needs a higher `versionCode` for every upload, so keep the minor and patch numbers below 100. The build stops with a clear message if they are not. A pre-release ending such as `-beta.1` is kept in the Android `versionName` and ignored for the `versionCode`. On iOS the ending is dropped from the version, because the App Store only accepts numbers.

When you change the version, also change `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` so that Xcode shows the same number. The app itself always gets the number from `package.json`.

## npm scripts

| Command | What it does |
| --- | --- |
| `npm run cap:sync` | Builds the web app and copies it into both native projects |
| `npm run android:open` | Builds, syncs and opens the project in Android Studio |
| `npm run android:run` | Builds and runs on a connected Android device or emulator |
| `npm run android:debug` | Builds a debug APK on the command line |
| `npm run android:release` | Builds the release APK and AAB (signed only with the keystore settings below) |
| `npm run ios:open` | Builds, syncs and opens the project in Xcode |
| `npm run ios:run` | Builds and runs on a connected iPhone or iPad, or a simulator |
| `npm run ios:simulator` | Builds for the iOS Simulator on the command line |

## Build the Android app on your computer

You need:

- Node 22 or newer and `npm install` done once in the project folder.
- [Android Studio](https://developer.android.com/studio) Narwhal 3 (2025.1.3) or newer. It brings Java 21 and the Android SDK manager. Android SDK Platform 36 is needed, and Android Studio offers to install it the first time you open the project.

Then:

1. Run `npm run android:open`. Android Studio opens the `android/` folder and syncs Gradle. The first sync downloads a lot and takes a few minutes.
2. Pick a phone (a real one with USB debugging on, or an emulator from Device Manager) and press Run.

To build from the command line instead, set `ANDROID_HOME` to the SDK folder and run `npm run android:debug`. The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

There are three kinds of build:

| Build | Command | Signed with | Use it for |
| --- | --- | --- | --- |
| `debug` | `./gradlew assembleDebug` | The standard Android debug key | Development. Its web view can be inspected from Chrome (`chrome://inspect`). |
| `sideload` | `./gradlew assembleSideload` | The standard Android debug key (a new one is made on every CI machine) | Giving the app to testers. It is a release build, not inspectable. |
| `release` | `./gradlew assembleRelease bundleRelease` | Your own key, see below | Google Play and anything you want to keep updating |

Run the `./gradlew` commands inside the `android/` folder, after `npm run cap:sync`.

## Build the iPhone and iPad app on your Mac

You need a Mac with:

- [Xcode](https://developer.apple.com/xcode/) 26 or newer. Capacitor 8 requires it. The app itself runs on iOS and iPadOS 15 and newer.
- Node 22 or newer and `npm install` done once.

Then:

1. Run `npm run ios:open`. Xcode opens `ios/App/App.xcodeproj` and fetches the Swift packages the first time.
2. To try it in the simulator, pick an iPhone or iPad simulator at the top and press Run. No account is needed.
3. To run it on your own iPhone or iPad, open the **App** target, then **Signing & Capabilities**, choose your team (a free Apple ID works) and change the bundle identifier to something unique to you, because `org.prismmapper.mobile` belongs to the project's own Apple developer account. Connect the device and press Run. With a free Apple ID the app stops working after 7 days and has to be installed again.

You cannot build the iOS app on Windows or Linux. Use the automatic build (below) to get an unsigned IPA from GitHub instead.

## Signing and publishing

### Android and Google Play

An Android release needs a signing key that only you have. Keep it safe: if you lose it you cannot update the app under the same name.

1. Create a keystore once (answer the questions and remember the passwords):

   ```
   keytool -genkeypair -v -keystore prism-mapper-release.jks -alias prism-mapper \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Build with the keystore, passing it through environment variables. Nothing about the key is stored in the repository.

   ```
   export ANDROID_KEYSTORE_FILE=/full/path/to/prism-mapper-release.jks
   export ANDROID_KEYSTORE_PASSWORD=...
   export ANDROID_KEY_ALIAS=prism-mapper
   export ANDROID_KEY_PASSWORD=...
   npm run android:release
   ```

   The signed APK is `android/app/build/outputs/apk/release/app-release.apk` and the bundle for Google Play is `android/app/build/outputs/bundle/release/app-release.aab`. Without the four variables the release build is not signed and cannot be installed (the build prints a warning).

3. In the [Google Play Console](https://play.google.com/console) create the app, turn on Play App Signing and upload the `.aab`. The Data safety form can say that the app collects no data: audio from the microphone is analyzed on the device and is never recorded or sent anywhere.

The keystore file is never committed (`*.jks` and `*.keystore` are ignored by git).

### iPhone, iPad and the App Store

1. Join the Apple Developer Program, then create an app record in [App Store Connect](https://appstoreconnect.apple.com/) with the bundle id `org.prismmapper.mobile`.
2. In Xcode choose your team, then **Product > Archive**, then **Distribute App > App Store Connect**.
3. The app privacy answers are: no data collected. The microphone text shown to people is already in `Info.plist`. The export compliance question is already answered there too (the app uses no encryption of its own).

TestFlight builds go through the same upload, and are the easiest way to test on real devices with other people.

## How the automatic build works

The workflow `.github/workflows/mobile.yml` ("Mobile apps") runs on every push to `main` and to the `claude/mobile-native` branch and on pull requests that touch the app, the native projects or the workflow. It can also be started by hand from the Actions tab, and the release workflow calls it. It has four jobs:

**Android build.** Builds the web app, syncs it into `android/` and builds the `debug` and `sideload` APKs with Gradle. It then checks both with `aapt2`: application id, version name and code, SDK levels, no backups, no cleartext traffic, only the microphone permissions, and debuggable or not as expected. It also tries the release signing with a throwaway key made on the spot, so the signing setup keeps working even though the real key is not in CI.

**Android emulator test.** Starts an Android emulator (x86_64, 4 GB of memory, the `swangle_indirect` software graphics mode) on four setups: Android 14, Android 11, Android 15 and Android 14 with the plain open-source image. Android 14 and Android 11 must pass, the other two still run and show their result but do not fail the workflow. A build whose check fails is checked once more, because emulators on shared machines now and then stop an app that is fine: the first attempt shows as warnings and is kept in an `attempt-1` folder of the artifact, and the run says that it needed a second attempt. A build that fails both attempts fails the job. On each setup it installs the debug build and the sideload build and opens each one. For the debug build it connects to the app's web view and checks that the app interface and the preview canvas exist, that the preview is not blank and that the page logged no errors (one harmless Capacitor message about the safe area is ignored). It then stops the web view's process on purpose and checks that the app stays alive in the same process and draws its preview again. Both builds get a screenshot, the sideload build is rotated to landscape, and the system log is checked for crashes. On the sideload build the persistent process of Google Play services is then crashed and the rest of Play services is stopped, and the app must stay alive in the same process. Last, the app is started again and Play services are crashed at the first moment the app holds a stable connection to one of their providers. Android's web view makes that connection on Android 14 with Google apps, and Android stops an app whose provider dies, so the app does not always live through it. That result is shown as a warning and never fails the build (see `VALIDATION.md`). The older graphics modes (`swiftshader_indirect` and the guest modes) stop the whole emulator on the GitHub machines about 20 seconds after Prism Mapper opens, which is why `start-emulator.sh` insists on `swangle_indirect`.

**iOS and iPadOS build.** Builds the web app, syncs it into `ios/`, builds for the iOS Simulator and checks the app bundle (bundle id, version, microphone text, orientations, privacy manifest). It then builds the app for real devices without signing, checks the app inside that archive the same way, and packs it into an unsigned IPA.

**iOS simulator test.** Installs and opens the simulator app on an iPhone simulator and on an iPad simulator, takes a screenshot of each and checks that the screen is not blank, that the app is still running and that no crash report exists.

### What you get

Open the run in the Actions tab and scroll to **Artifacts**.

| Artifact | Contents |
| --- | --- |
| `mobile-android` | `Prism-Mapper-v<version>-Android.apk` and its `.sha256` file. This is the file the release workflow publishes. It is the sideload build, or the release build signed with your key when the Android signing secrets are set. |
| `mobile-ios` | `Prism-Mapper-v<version>-iOS-unsigned.ipa` and its `.sha256` file. This is the file the release workflow publishes. |
| `store-android`, `store-ios` | Only with signing secrets: the `.aab` for Google Play and the `-iOS-appstore.ipa` for the App Store. These are never published on the release page. |
| `android-smoke-<setup>` | The emulator screenshots, the page check and crash recovery results and the filtered logs, one artifact per emulator setup |
| `ios-smoke-<iPhone or iPad>` | The simulator screenshots and logs |
| `ios-build-logs` | The Xcode build logs |

The `.sha256` files are in the format that `sha256sum -c` and `shasum -a 256 -c` understand. Artifacts are kept for 14 days. The release script refuses to publish any file that is not one of the four desktop downloads, the Android APK or the unsigned IPA, so a store bundle or a debug build cannot end up on the release page by accident.

### Optional secrets

All of these are optional. Without them the signed builds are skipped without an error.

| Secret | What it holds |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The keystore file, encoded with `base64 -i prism-mapper-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | The key alias, for example `prism-mapper` |
| `ANDROID_KEY_PASSWORD` | The key password |
| `APPLE_TEAM_ID` | The 10 character Apple team id |
| `APPLE_CERTIFICATE_P12_BASE64` | An Apple Distribution certificate exported as `.p12` and encoded with `base64` |
| `APPLE_CERTIFICATE_PASSWORD` | The password of that `.p12` file |
| `APPLE_PROVISIONING_PROFILE_BASE64` | An App Store provisioning profile for `org.prismmapper.mobile`, encoded with `base64` |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_P8_BASE64` | An App Store Connect API key, only needed to upload to TestFlight |

The release workflow passes them to this one by name. TestFlight upload happens only when the workflow is started by hand with `testflight: true`. With the four Android secrets set, the APK on the release page is the release build signed with your key, so later versions install over it. The signed Android path was tried in CI only with a throwaway key. The signed Apple path has not been run by the project, because it needs real Apple certificates, so expect to adjust it the first time you use it.

## Install the Android app

1. Download `Prism-Mapper-v<version>-Android.apk` from the release page (or unzip the build artifact) onto the phone, or copy it over by USB.
2. Open the file. Android asks for permission to install apps from this source (Chrome, Files or whichever app you used to open it). Allow it for that app, then go back and tap **Install**. The setting is called "Install unknown apps" and you can turn it off again afterwards.
3. Play Protect may say the app is from an unknown developer. That is expected for an app that did not come from Google Play.

Or, with a computer and USB debugging on: `adb install Prism-Mapper-v<version>-Android.apk`.

Android installs an update over an installed app only when both were signed with the same key. The CI builds are signed with the standard debug key, which is created fresh on every CI machine, so each build has a different signature and cannot be installed over another one. Uninstall the old version first, and save your projects as files before that, because uninstalling deletes the app's data. Builds signed with your own key (see above) install over each other.

## Install the iPhone and iPad app

The unsigned IPA cannot be installed directly: iOS only runs apps that are signed by an Apple account. Pick one of these ways:

- **Simulator on a Mac.** Run `npm run ios:simulator`, start a simulator from Xcode, and drag `ios/App/build/DerivedData/Build/Products/Debug-iphonesimulator/App.app` onto its window (or run `xcrun simctl install booted <that App.app>`).
- **The web app, on any iPhone or iPad, without a Mac or an account.** Open the web app in Safari, tap **Share**, then **Add to Home Screen**. See the README for the address.
- **Your own device, with a Mac.** Build from source as described above.
- **Your own device, without a Mac.** Tools such as AltStore or Sideloadly can re-sign the unsigned IPA with your own Apple ID and install it. A free Apple ID gives an app that has to be refreshed every 7 days.
- **TestFlight or the App Store.** Needs the signed build from the Apple developer account.

## What the apps do differently from the browser

- **The screen stays on.** The apps keep the display awake while Prism Mapper is in front, because a projection that dims is useless. Normal sleep returns when you leave the app.
- **Microphone.** Android and iOS ask for permission the first time you tap Start listening. The audio is analyzed on the device to animate effects. It is never recorded or uploaded. Phones cannot capture the sound of other apps, so the microphone is the only audio source.
- **All orientations** work on phones and tablets.
- **Dark launch screen and status bar.** The system bars use light icons on the dark app background.
- **Saved files.** The app lets you share or save files with the system dialogs. On iOS the app's documents also appear in the Files app.
- **No network.** The Android app does not ask for the internet permission at all (see the next section).

## What has been tested, and what has not

Tested by the automatic build on every push (when the app, the native projects or the workflow change):

- The web app builds, and `npx cap sync` runs for Android and iOS.
- The Android app builds as a debug and a sideload APK, with the expected version, permissions and manifest settings.
- Both APKs install and start on Android emulators: Android 11 (with an old web view, version 83), Android 14, Android 15 and Android 14 with the plain open-source image. The preview is drawn, the page check passes, the screen rotates, and the app survives the death of its web view process and a crash of Google Play services (see "How the automatic build works").
- The iOS app builds for the simulator and for devices (without signing), the app inside the device archive passes the same bundle checks, and the simulator build starts on an iPhone and an iPad simulator.
- The web app is also tested in headless Chromium, on a phone-sized and a tablet-sized screen with touch emulation (`npm run test:mobile`), and as an installable offline web app (`npm run test:pwa`).

Not tested, and not claimed:

- **Real phones and tablets.** Nothing has been run on physical Android or iOS hardware. The emulator and the simulators do not have a real microphone, real touch, real GPU behavior or real battery and thermal behavior.
- **The microphone** on a real device, including the permission prompt wording on each Android and iOS version.
- **Showing the output on an external display or projector** by cable, Chromecast, AirPlay or screen mirroring.
- **Google Play and App Store review.** No store has accepted these builds. The privacy and data answers above are a starting point, not legal advice.
- **TestFlight and the signed Apple path**, and the signed Android path with a real key. Only the parts that run without secrets are tested.
- **Google Play services restarting while the app starts.** On Android 14 with Google apps the web view holds a connection to the font provider of Play services for the first seconds, and Android closes an app whose provider process dies. An emulator test shows it, the app cannot prevent it, and the details are in `VALIDATION.md`.
- **Old devices.** The emulators in CI have fixed web views (version 83 on Android 11, version 113 on Android 14). Real devices usually have a newer one, and their behavior can differ.
- **Safari and WebKit.** The web app was never run in Safari. The iOS app uses the system web view, which the simulator test only starts, it does not exercise the editor from the inside.

## If something goes wrong

- *Gradle or Android Studio cannot find the project's plugins.* Run `npm run cap:sync` first. It creates files in `android/` that Gradle needs.
- *Xcode says a package is missing.* Run `npm run cap:sync`, then in Xcode choose **File > Packages > Resolve Package Versions**.
- *The app shows a blank screen after a code change.* The web app was not rebuilt. Run `npm run cap:sync` and run the app again.
- *The build says "must look like MAJOR.MINOR.PATCH".* The `version` in `package.json` has to be three numbers, such as `0.5.1`.
