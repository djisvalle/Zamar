# Testing Zamar on iOS and Android devices

How to build Zamar and run it on a real iPhone/iPad or Android phone/tablet, and what to
check once it's running.

Zamar is a Capacitor app: the whole UI is the Vite/React bundle in `dist/`, drawn in a
web view (WKWebView on iOS, Android System WebView on Android). The native projects in
`ios/` and `android/` are thin shells plus two plugins (`@capacitor-community/sqlite` and
`@capacitor/status-bar`). So every native build follows the same pattern: build the web
bundle, copy it into the native project, then build and install with Xcode or Android
Studio.

Status as of 2026-09-25:

- **Android** has been built and run on a device. The steps below are the verified path.
- **iOS** has never been built in Xcode. The project is scaffolded (Swift Package Manager,
  no CocoaPods) and the `CapApp-SPM/Package.swift` plugin paths have been fixed, but expect
  the first build to surface issues. Record anything you hit in the "iOS first-build notes"
  section at the end.

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Build and sync the web bundle](#2-build-and-sync-the-web-bundle)
3. [Android](#3-android)
4. [iOS](#4-ios)
5. [Debugging the web view](#5-debugging-the-web-view)
6. [Live reload (optional)](#6-live-reload-optional)
7. [What to test on a device](#7-what-to-test-on-a-device)
8. [Troubleshooting](#8-troubleshooting)
9. [iOS first-build notes](#9-ios-first-build-notes)

## 1. Prerequisites

Common to both platforms:

- **Node.js and npm.** Capacitor 8 (what `package.json` pins) needs a current LTS Node;
  check the [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)
  page for the exact minimum.
- A clone of this repo, then `npm install` in its root. `node_modules/` must exist before
  any native build, because both native projects reference plugin sources inside it
  (the iOS `Package.swift` points at `../../../node_modules/...`).

Android:

- **Android Studio** (recent stable), which bundles a JDK and the Android SDK.
- In Android Studio's SDK Manager, **Android SDK Platform 36** (the project's
  `compileSdkVersion`/`targetSdkVersion` in `android/variables.gradle`).
- A device on **Android 7.0 (API 24) or newer** (`minSdkVersion = 24`), or an emulator.

iOS:

- **A Mac with Xcode** (current release; Capacitor 8 requires a recent Xcode, see the
  environment setup page above). Open Xcode once after installing so it finishes
  installing its components.
- An **Apple ID** added in Xcode ▸ Settings ▸ Accounts. A free Apple ID is enough to run
  on your own device; a paid Apple Developer Program membership is only needed for
  TestFlight or builds that don't expire after 7 days.
- A device on **iOS/iPadOS 15 or newer** (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`), or a
  simulator.
- No CocoaPods needed. The iOS project uses Swift Package Manager (`ios/App/CapApp-SPM`).

## 2. Build and sync the web bundle

Every time the web code changes, rebuild and copy it into both native projects:

```
npm run cap:sync     # = vite build && npx cap sync
```

This runs `vite build` into `dist/`, then `npx cap sync`, which copies `dist/` into
`android/app/src/main/assets/public` and `ios/App/App/public`, writes the generated
`capacitor.config.json` files, and updates native plugin wiring. Those copied folders are
gitignored, so a fresh clone must always sync before building natively.

Tip: run `npm run build` first if you want the TypeScript check (`tsc -b`) as well.
`cap:sync` only runs `vite build`, which doesn't type-check.

If you only changed web code and the native project is already open in Xcode or Android
Studio, `npx cap copy` (copy only, no plugin update) after `vite build` is enough.

## 3. Android

### Prepare the phone

1. Settings ▸ About phone ▸ tap **Build number** seven times to unlock Developer options.
2. Settings ▸ System ▸ Developer options ▸ turn on **USB debugging** (menu names vary by
   manufacturer).
3. Connect by USB and accept the "Allow USB debugging?" prompt on the phone.
   On Android 11+ you can use **Wireless debugging** instead and pair from Android Studio's
   device menu.

### Run from the command line

```
npm run cap:android   # build + sync + npx cap run android
```

`npx cap run android` lists connected devices and emulators and asks which to use. To skip
the prompt: `npx cap run android --list` to see IDs, then
`npx cap run android --target <ID>`.

### Run from Android Studio

```
npm run cap:sync
npx cap open android
```

Wait for the Gradle sync to finish, pick the device in the toolbar's device dropdown, and
press **Run** (▶). This is the easier path when a build fails, because Android Studio shows
the Gradle error in full.

### Install a debug APK without Android Studio

```
npm run cap:sync
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with
`adb install -r app/build/outputs/apk/debug/app-debug.apk`, or send the file to the phone
and open it (the phone must allow installs from that source).

### Emulator

Android Studio ▸ Device Manager ▸ create a virtual device (a Pixel phone and a tablet
profile cover both layouts). Once it's running, `npx cap run android` lists it as a target.

## 4. iOS

> Unverified: nobody has run these steps on this project yet. They are the standard
> Capacitor + Xcode flow; see section 9 for what to record.

### First-time setup

```
npm install
npm run cap:sync
npx cap open ios        # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:

1. Wait for **Swift Package Manager** to resolve packages (status in the top bar). It
   fetches `capacitor-swift-pm` 8.5.0 from GitHub and links the two local plugin packages
   from `node_modules`. If resolution fails, see [Troubleshooting](#8-troubleshooting).
2. Select the **App** project in the navigator, then the **App** target ▸
   **Signing & Capabilities**:
   - Leave **Automatically manage signing** on (the project uses `CODE_SIGN_STYLE = Automatic`).
   - Set **Team** to your Apple ID's (Personal Team) or your developer team.
   - The bundle identifier is `com.zamar.app`. With a free Personal Team, Xcode may say the
     ID is unavailable because it's already registered elsewhere. If so, change it locally
     to something unique like `com.<yourname>.zamar` and **don't commit that change**.
3. Don't commit your Team selection either. It's written to `project.pbxproj` as
   `DEVELOPMENT_TEAM`; discard that hunk before committing.

### Run on a simulator

Pick an iPhone or iPad simulator in the toolbar's run destination menu and press **Run**
(⌘R). This needs no signing and is the quickest way to find out whether the project builds
at all. Worth trying first.

### Run on a physical iPhone or iPad

1. Connect the device by USB (or over the same Wi-Fi after the first USB pairing), unlock
   it, and tap **Trust** on "Trust This Computer?".
2. On iOS 16+, turn on **Developer Mode**: Settings ▸ Privacy & Security ▸ Developer Mode,
   then restart the device when asked. The option only appears after the device has been
   connected to Xcode once.
3. Pick the device as the run destination and press **Run**.
4. With a free Apple ID, the first launch fails with an "Untrusted Developer" message. On
   the device go to Settings ▸ General ▸ VPN & Device Management, tap your Apple ID under
   Developer App, and tap **Trust**. Then run again.

Free-account builds expire after 7 days (re-run from Xcode to refresh) and a free account
can have at most 3 sideloaded apps per device.

From the command line, once signing is set up in Xcode:

```
npm run cap:ios         # build + sync + npx cap run ios
```

### Sharing a build with other testers (TestFlight)

Requires the paid Apple Developer Program. In Xcode choose a generic "Any iOS Device"
destination, then Product ▸ **Archive**, and in the Organizer **Distribute App ▸ App Store
Connect ▸ Upload**. Create the app record in App Store Connect first (bundle ID
`com.zamar.app`), then add testers under TestFlight once the build finishes processing.

## 5. Debugging the web view

Because the UI is web code, most debugging happens in desktop browser devtools attached
to the device's web view. Capacitor enables web view inspection in debug builds.

- **Android:** with the phone connected and the app open, go to `chrome://inspect/#devices`
  in desktop Chrome and click **inspect** under the Zamar WebView. You get the full console,
  elements, network and performance tools.
- **iOS:** on the device, turn on Settings ▸ Apps ▸ Safari ▸ Advanced ▸ **Web Inspector**
  (older iOS: Settings ▸ Safari ▸ Advanced). On the Mac, enable Safari ▸ Settings ▸
  Advanced ▸ "Show features for web developers", then pick the device and the Zamar page
  from Safari's **Develop** menu. Works for simulators too.

Native logs (plugin errors, SQLite, crashes) are in Android Studio's **Logcat** (filter by
`com.zamar.app`) and Xcode's debug console.

## 6. Live reload (optional)

To see web changes on the device without rebuilding each time, point the native app at
the Vite dev server:

1. Start Vite so it listens on your network: `npm run dev -- --host`. Note the LAN URL
   and port it prints.
2. In another terminal:

```
npx cap run android --live-reload --host <your-LAN-IP> --port <port>
npx cap run ios --live-reload --host <your-LAN-IP> --port <port>
```

The phone and computer must be on the same network. For Android over USB you can instead
add `--forwardPorts <port>:<port>` and use `--host localhost`, which avoids the network
entirely.

Caveat: this loads the app from `http://<host>:<port>`, a different origin from the
bundled build, so it can behave differently (notably storage and file access). Always do a
final pass on a normal `cap:sync` build.

## 7. What to test on a device

The browser dev frame (`npm run dev`) covers most layout work. A device is needed for
anything involving the native engine, real touch, or the OS itself. Suggested pass on
each platform, phone and tablet sizes:

**Boot and persistence (native SQLite, not the browser's sql.js fallback)**

- [ ] Fresh install: splash advances into Live Stage with the seed songs.
- [ ] Add a song, edit a setlist, change a setting. Force-quit the app (swipe it away)
      and relaunch: all three changes are still there.
- [ ] Settings ▸ reset (type `ERASE`) clears data, and it stays cleared after relaunch.

**Native chrome**

- [ ] No content hidden under the notch/Dynamic Island, status bar, or home indicator,
      in portrait and landscape.
- [ ] Status bar text is dark in Light and light in Stage Dark, and switches when the
      appearance setting changes.
- [ ] Rotating the device doesn't lose the current screen or scroll position.
- [ ] Android: the system back gesture/button behaves sensibly on pushed screens and
      modals (the app is iOS-first, so note anything odd rather than assuming a bug).

**Touch and gestures**

- [ ] Tab bar, sheets, list rows and buttons are easy to hit; nothing needs a double tap.
- [ ] PDF pages: pinch-zoom and pan are smooth and don't also zoom the whole page.
- [ ] Annotate: pen strokes follow the finger (and Apple Pencil on iPad) without lag;
      scrolling vs. drawing doesn't fight.
- [ ] Live Stage chrome hides after ~6 s idle and comes back on tap.
- [ ] On-screen keyboard in Add/Edit Song doesn't cover the field being typed in.

**Files and rendering**

- [ ] Import each type (PDF, photo, MusicXML) through the native file picker. On iOS,
      try both Files and the photo library.
- [ ] MusicXML renders and re-engraves when the key changes.
- [ ] Large PDFs render all pages without running out of memory.

**Performance and power**

- [ ] Scrolling long lists and switching tabs feels smooth on an older device.
- [ ] The app survives being backgrounded for a while and reopened.

Note anything platform-specific with the device model and OS version.

## 8. Troubleshooting

**`npx cap sync` fails or the app shows a blank white screen.** Check that `dist/` exists
and is fresh (`npm run build`). A blank screen with a JavaScript error is easiest to
diagnose through web view inspection (section 5).

**iOS: Swift package resolution fails.** Run `npm install` so `node_modules/` exists (the
plugin packages are local paths into it), then `npx cap sync ios`, then in Xcode
File ▸ Packages ▸ **Reset Package Caches**. The Capacitor package itself is fetched from
GitHub, so the Mac needs network access.

**iOS: signing errors ("No account for team", "Failed to register bundle identifier").**
Pick a Team in Signing & Capabilities; for a free account, use a unique bundle ID locally
(section 4).

**iOS: "Could not launch" / "device is locked" / Developer Mode prompts.** Unlock the
device, enable Developer Mode, and trust the developer certificate (section 4).

**Android: Gradle sync fails on a JDK or SDK version.** In Android Studio ▸ Settings ▸
Build Tools ▸ Gradle, use the bundled JDK, and install SDK Platform 36 from the SDK
Manager.

**Android: device not listed.** Run `adb devices`. If it shows `unauthorized`, re-plug and
accept the prompt on the phone; if it's missing, try another cable or port (some cables
are charge-only).

**The app on the device doesn't have my latest change.** You skipped `npm run cap:sync`
(or `npx cap copy`) after changing web code. The native project only ever sees the last
synced `dist/`.

## 9. iOS first-build notes

Fill this in during the first real Xcode build, so the next person doesn't rediscover it:

- Date, Mac, Xcode version:
- Did package resolution succeed first time?
- Build errors and fixes:
- Simulator run:
- Device run (model, iOS version):
- Anything from the checklist in section 7 that behaved differently from Android:

Things likely to come up, worth checking first:

- **Photo import on iOS.** The photo picker comes from a web `<input type="file"
  accept="image/*">`, which on iOS can offer "Take Photo". Using the camera from an app
  whose `Info.plist` has no `NSCameraUsageDescription` terminates the app, so `Info.plist`
  now carries that key and `NSPhotoLibraryUsageDescription`. Check that "Take Photo" shows
  the camera permission prompt and that a taken photo imports.
- **SQLite on iOS.** The `@capacitor-community/sqlite` plugin has never run on iOS in this
  project. Watch the Xcode console on first launch for plugin or database-open errors, and
  confirm the persistence checks in section 7.
