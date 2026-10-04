import type { CapacitorConfig } from "@capacitor/cli";

// Native shells for Prism Mapper (Android and iOS/iPadOS), built with
// Capacitor. The app is the same offline web build that the desktop app and
// the browser use: `npm run build` writes dist/, and `npx cap sync` copies it
// into android/ and ios/. See docs/building-mobile.md.
//
// The app id below is the Android application id and the iOS bundle id. It
// cannot be changed once an app has been published to Google Play or the App
// Store, so treat it as permanent.
const background = "#090d12";

const config: CapacitorConfig = {
  appId: "org.prismmapper.mobile",
  appName: "Prism Mapper",
  webDir: "dist",
  backgroundColor: background,
  // Native and web console output only reaches the system log in debug builds.
  loggingBehavior: "debug",
  server: {
    // The bundled files are served from https://localhost on Android and from
    // capacitor://localhost on iOS. "localhost" keeps the page a secure
    // context, which getUserMedia (the microphone) needs. There is no
    // server.url (no remote or live-reload page) and no allowNavigation, so
    // the web view can only ever load the files shipped inside the app.
    hostname: "localhost",
    androidScheme: "https",
    iosScheme: "capacitor",
    cleartext: false,
  },
  android: {
    backgroundColor: background,
    allowMixedContent: false,
    // webContentsDebuggingEnabled is left out on purpose. Its default is "on
    // only when the app is debuggable", so release builds cannot be inspected
    // while the debug build used by the CI emulator test can.
  },
  ios: {
    backgroundColor: background,
    allowsLinkPreview: false,
  },
  plugins: {
    // Android edge-to-edge: Capacitor pads the web view by the system bars and
    // exposes the insets to CSS as --safe-area-inset-top|right|bottom|left.
    // "DARK" means light icons on the dark bars.
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
    },
    // Light status bar text on the dark app background, iOS and Android.
    StatusBar: {
      style: "DARK",
      backgroundColor: background,
      overlaysWebView: true,
    },
  },
};

export default config;
