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

- **Android** has been built and run on a device as a debug build (section 3), which is
  the verified path. No signed release build (section 4) has been made yet.
- **iOS** has never been built in Xcode. The project is scaffolded (Swift Package Manager,
  no CocoaPods) and the `CapApp-SPM/Package.swift` plugin paths have been fixed, but expect
  the first build to surface issues. Record anything you hit in the "iOS first-build notes"
  section at the end.

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Build and sync the web bundle](#2-build-and-sync-the-web-bundle)
3. [Android](#3-android)
4. [Android release APK (for everyday use)](#4-android-release-apk-for-everyday-use)
5. [iOS](#5-ios)
6. [Debugging the web view](#6-debugging-the-web-view)
7. [Live reload (optional)](#7-live-reload-optional)
8. [What to test on a device](#8-what-to-test-on-a-device)
9. [Troubleshooting](#9-troubleshooting)
10. [iOS first-build notes](#10-ios-first-build-notes)

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

This is a debug build, for testing only. To make the version you install for real use,
see section 4.

### Emulator

Android Studio ▸ Device Manager ▸ create a virtual device (a Pixel phone and a tablet
profile cover both layouts). Once it's running, `npx cap run android` lists it as a target.

## 4. Android release APK (for everyday use)

Section 3 makes **debug** builds, meant for developing. This section makes a **release**
build: the version you put on your own phone, or your team's, and actually use at
rehearsal and on stage. It assumes no mobile-development experience. Read each step through
before doing it.

> Nobody has made a release build of this project yet. These are the standard Android
> Studio steps; if something on your screen differs, note it in the Troubleshooting
> section (9) so the next person has it.

### 4.1 What you're making, in plain terms

- **APK** ("Android Package") is a single file that holds the whole app. Put it on an
  Android phone, tap it, and the phone installs Zamar like any other app. No app store is
  involved (installing this way is called *sideloading*).
- **Debug vs. release.** A debug build is made for developers: it can be inspected and
  debugged from a computer. A release build is the clean, final version for real use.
  Both are the same Zamar; only how they're packaged differs.
- **Signing key (keystore).** Android only installs apps that are *signed*, which means
  they're stamped with a private digital key that proves who made them. You create
  the key once and it's stored in a file ending in **`.jks`**. The key has two passwords
  (one for the file, one for the key inside it) and a short name called an **alias**.
- **Why the key matters so much.** A phone only accepts an **update** to Zamar if it's
  signed with **the same key** as the copy already installed. If you lose the `.jks` file
  or forget its password, you can never update the app on anyone's phone again. They would
  have to uninstall Zamar, which **deletes all their songs, setlists and annotations**, and
  install a newly signed copy. Step 4.6 covers how to keep it safe.
- **Version code.** A whole number inside the app (currently `1`) that must go up with
  every update you hand out. Step 4.9 covers this.

### 4.2 Install the tools (once per computer)

You need three free programs. Install each with its default options.

1. **Node.js**, which builds Zamar's screens. Download the **LTS** version from
   [nodejs.org](https://nodejs.org) and run the installer.
2. **Git**, which downloads the project's code. Download it from
   [git-scm.com](https://git-scm.com/downloads). (Macs often have it already; the first
   time you type `git` in Terminal, macOS offers to install it.)
3. **Android Studio**, which turns the project into an APK. Download it from
   [developer.android.com/studio](https://developer.android.com/studio). Open it once after
   installing. A setup wizard runs: pick **Standard**, accept the licence agreements, and
   let it download the Android SDK (this takes a while). It comes with everything else it
   needs, including Java.

You'll type commands into a **terminal**, a window where you type commands instead of
clicking:

- **Windows:** press Start, type `PowerShell`, open **Windows PowerShell**.
- **Mac:** press ⌘ Space, type `Terminal`, press Return.

Type or paste each command below, press Enter, and wait until the terminal is ready for
the next one (a blinking cursor on a fresh line). Red or yellow `WARN` lines during
`npm install` are normal. Only a line containing `ERR!` or `error` means something failed.

To check the installs worked, run each of these. Each should print a version number:

```
node --version
npm --version
git --version
```

If one says "not recognized" or "command not found", close the terminal, open a new one
and try again (installers only take effect in new windows). If it still fails, restart the
computer.

### 4.3 Get the code (once)

In the terminal, go to the folder where you want the project, then download it. For
example, to put it in your Documents folder:

```
cd Documents
git clone https://github.com/djisvalle/Zamar.git
cd Zamar
```

The repository is private, so Git may ask you to sign in to GitHub. Follow its prompts.
You now have a `Zamar` folder, and your terminal is "inside" it. **Every command in the
rest of this section must be run from inside the `Zamar` folder.** If you open a new
terminal later, first run `cd Documents/Zamar` (or wherever you put it).

Next time, instead of cloning again, get the latest code with:

```
git pull
```

### 4.4 Build Zamar's screens and copy them into the Android project

Each time you make a release (and after every `git pull`), run these three commands inside
the `Zamar` folder:

```
npm install
npm run build
npx cap sync android
```

What they do:

- `npm install` downloads the libraries Zamar is built from into a `node_modules` folder.
  It takes a few minutes the first time and is quick after that.
- `npm run build` checks the code and builds Zamar's screens into the `dist` folder. It
  should end with a line like `✓ built in …`. If it prints `error` lines instead, stop:
  the code itself has a problem that needs fixing before you can make a release.
- `npx cap sync android` copies `dist` into the Android project (the `android` folder).
  It should end with `Sync finished`.

Skipping this step is the most common mistake. The APK only ever contains what the last
sync copied in.

### 4.5 Open the project in Android Studio

1. Open Android Studio.
2. On the welcome screen click **Open** (or, if a project is already open, **File ▸
   Open…**).
3. Find the `Zamar` folder, select the **`android`** folder inside it (not `Zamar`
   itself), and click **Open** (Windows) or **Open**/**Choose** (Mac).
4. If asked whether to **trust the project**, choose **Trust Project**.
5. Wait. Along the bottom edge of the window, Android Studio shows progress while it
   "syncs Gradle" (Gradle is Android's build tool). The first time it can take 5–15
   minutes as it downloads build tools. It's done when the progress bar at the bottom
   disappears and there's no red error in the **Build** panel.
6. If a yellow bar or popup offers to install a missing SDK platform or accept licences,
   click the link and accept. (The project needs **Android SDK Platform 36**.) If it offers
   to *upgrade* the Android Gradle Plugin, choose **Don't ask for this project** or
   dismiss it, because upgrades are a code change that should be done on purpose, not
   during a release.

(`npx cap open android` does the same from the terminal, but on some computers it can't
find Android Studio. Opening the folder by hand always works.)

### 4.6 Create your signing key (first release only)

Do this **once, ever**, for Zamar. For every later release, skip to 4.7 and pick the same
key.

First, make a safe folder for the key **outside** the `Zamar` folder, for example
`Documents/zamar-signing`. Never put the key inside the `Zamar` folder, where it could be
uploaded to GitHub by accident.

Then, in Android Studio:

1. In the menu bar choose **Build ▸ Generate Signed App Bundle or APK…** (some versions
   write it **Generate Signed Bundle / APK…**).
2. Choose **APK** and click **Next**.
3. The **Module** should say `app`. Under **Key store path** click **Create new…**.
4. Fill in the **New Key Store** window:
   - **Key store path:** click the folder icon, go to your `zamar-signing` folder, and
     name the file `zamar-release.jks`.
   - **Password / Confirm:** the key store password. Make it strong and **write it down**
     (see below).
   - **Key ▸ Alias:** `zamar`.
   - **Key ▸ Password / Confirm:** the key password. Using the same password as the key
     store is fine and makes life easier.
   - **Validity (years):** leave the default (25) or higher. The key must outlive the app.
   - **Certificate:** fill in at least **First and Last Name** (your name or your church's
     / team's name). Organization, City, State and Country Code (e.g. `US`) are optional.
     Nobody using the app sees these.
5. Click **OK**. You're returned to the previous window with the fields filled in.

**Back up the key now, before going further.** Save:

- the file `zamar-release.jks`,
- the key store password,
- the alias (`zamar`),
- the key password.

Good places are a password manager (most can store a file as an attachment) plus one
other copy, such as a private cloud drive folder or a USB stick kept somewhere safe.
Don't email it around or put it anywhere shared. Anyone who has the file and passwords
can make apps that phones will accept as updates to Zamar.

### 4.7 Build the signed APK

Continuing in the same window (or, for later releases, **Build ▸ Generate Signed App
Bundle or APK… ▸ APK ▸ Next**):

1. **Key store path:** your `zamar-release.jks`. For later releases, click **Choose
   existing…** and select it.
2. Enter the **key store password**, the **alias** `zamar`, and the **key password**.
   Ticking **Remember passwords** is fine on your own computer.
3. Click **Next**.
4. **Destination Folder:** leave the default (it ends in `android/app`).
5. **Build Variants:** select **release** (not debug).
6. Click **Create** (or **Finish**).

Android Studio builds for a minute or two. When it's done, a notice appears in the bottom
right corner saying the APK was generated. Click **locate** in it to open the folder. The
file is:

```
Zamar/android/app/release/app-release.apk
```

That's the app. Rename a copy to something clearer, like `Zamar-1.0.apk`, if you like.
(Git is set to ignore `.apk` files, so it won't be uploaded to GitHub. If `git status`
later lists other files in `android/app/release/`, don't commit them either.)

If the build fails instead, click the **Build** tab at the bottom of the window to see the
error, and check Troubleshooting (section 9).

### 4.8 Install it on a phone

**If the phone already has a debug build of Zamar** (from section 3), you must uninstall
that first. The debug and release builds are signed with different keys, so Android
refuses to install one over the other ("App not installed" or "package conflicts with an
existing package"). **Uninstalling deletes everything stored in Zamar on that phone:
songs, setlists, annotations and settings.** Zamar has no backup-and-restore yet, so
anything you need from the debug copy has to be carried over by hand: use Export to save
songs as PDF or MusicXML files, then bring them back one at a time with Import after
installing the release build (Import doesn't read ChordPro files, and setlists aren't
imported, so note those down). This only happens once: later release updates keep all
data.

Then get the APK onto the phone. Any of these works:

- **Cloud drive:** upload `app-release.apk` to Google Drive (or similar), open it on the
  phone and tap the file.
- **USB cable:** connect the phone, choose **File transfer** in the notification that
  appears on the phone, and copy the APK into its **Download** folder. Open it from the
  phone's **Files** app.
- **Email/chat to yourself:** works too, though some email services block APK
  attachments.

When you tap the APK:

1. The first time, Android says installing from this source isn't allowed. Tap
   **Settings**, turn on **Allow from this source** for the app you opened it from (e.g.
   Drive or Files), then go back.
2. Tap **Install**.
3. **Google Play Protect** may warn that it doesn't recognise the app, because it didn't
   come from the Play Store. Tap **More details ▸ Install anyway** (the exact wording
   varies by phone). If it offers to "send the app for scanning", either answer is fine.
4. Tap **Open**, or find Zamar in the app drawer.

No USB debugging or Developer options are needed for this; those are only for section 3.

To give Zamar to other people, send them the same APK file and they follow these steps.
Everyone must get their copies from builds signed with your one key.

### 4.9 Releasing an update later

When there's a new version of Zamar to hand out:

1. Get the latest code: `git pull` in the `Zamar` folder.
2. **Increase the version code.** In Android Studio's left panel, open **app ▸ build.gradle**
   (Android Studio may show it as `build.gradle (Module: app)`; the file is
   `android/app/build.gradle`). Find these lines:

   ```
   versionCode 1
   versionName "1.0"
   ```

   Raise `versionCode` by one (`1` → `2`, then `3`, and so on, never reusing a number) and
   set `versionName` to whatever label you want people to see, e.g. `"1.1"`. Save the
   file. This is a code change, so commit it (or ask the developer to) so the next release
   starts from the right number. If you forget this step, phones may refuse the update, and
   there's no way to tell the old and new versions apart.
3. Redo 4.4 (`npm install`, `npm run build`, `npx cap sync android`).
4. In Android Studio choose **File ▸ Sync Project with Gradle Files**, then redo 4.7,
   picking **the same `zamar-release.jks`** and passwords.
5. Install the new APK over the old one as in 4.8. **Don't uninstall first.** Installing
   over the top keeps all songs and setlists. Android says **Update** instead of
   **Install**.

### 4.10 Good to know

- **Release builds can't be inspected** with `chrome://inspect` (section 6). For
  investigating a problem, use a debug build from section 3.
- **Google Play needs a different file.** The Play Store takes an **Android App Bundle**
  (`.aab`), not an APK. It's the same wizard with **Android App Bundle** chosen in 4.7, plus
  a Play Console developer account and a store listing. Signing with the same key still
  applies. For handing the app to your own team, the APK is all you need.

## 5. iOS

> Unverified: nobody has run these steps on this project yet. They are the standard
> Capacitor + Xcode flow; see section 10 for what to record.

### First-time setup

```
npm install
npm run cap:sync
npx cap open ios        # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:

1. Wait for **Swift Package Manager** to resolve packages (status in the top bar). It
   fetches `capacitor-swift-pm` 8.5.0 from GitHub and links the two local plugin packages
   from `node_modules`. If resolution fails, see [Troubleshooting](#9-troubleshooting).
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

## 6. Debugging the web view

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

## 7. Live reload (optional)

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

## 8. What to test on a device

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
- [ ] MusicXML renders and re-engraves when the key changes, including a pure respelling
      (C♯ ↔ D♭, F♯ ↔ G♭, B ↔ C♭): the key signature and notes follow the chip.
- [ ] Large PDFs render all pages without running out of memory.

**Tuner (real microphone)**

The Tuner has only been tried in a desktop browser, so this is its first real run.

- [ ] First visit shows Zamar's own mic sheet, then the OS permission prompt. Allowing it
      starts listening straight away, with no extra tap.
- [ ] Guitar preset: each open string reads within a few cents of a clip-on or
      phone tuner, and Auto follows the string being played. Repeat with Chromatic on a
      voice or keyboard, and with Bass for the low E (about 41 Hz).
- [ ] The needle settles on a sustained note instead of jittering, and goes back to
      "Listening for a note…" about a second after the note stops.
- [ ] Denying the prompt shows "Microphone is off" with this platform's Settings path.
      Allowing the mic in the OS Settings and tapping Try again starts listening.
- [ ] The OS mic indicator (iOS orange dot, Android green chip) disappears when you
      leave the Tuner tab and when the app goes to the background, and listening resumes
      on return.
- [ ] iOS: after using the Tuner, audio elsewhere on the phone (music, a call) isn't
      left quieter or routed to the earpiece.

**Performance and power**

- [ ] Scrolling long lists and switching tabs feels smooth on an older device.
- [ ] The app survives being backgrounded for a while and reopened.

Note anything platform-specific with the device model and OS version.

## 9. Troubleshooting

**`npx cap sync` fails or the app shows a blank white screen.** Check that `dist/` exists
and is fresh (`npm run build`). A blank screen with a JavaScript error is easiest to
diagnose through web view inspection (section 6).

**iOS: Swift package resolution fails.** Run `npm install` so `node_modules/` exists (the
plugin packages are local paths into it), then `npx cap sync ios`, then in Xcode
File ▸ Packages ▸ **Reset Package Caches**. The Capacitor package itself is fetched from
GitHub, so the Mac needs network access.

**iOS: signing errors ("No account for team", "Failed to register bundle identifier").**
Pick a Team in Signing & Capabilities; for a free account, use a unique bundle ID locally
(section 5).

**iOS: "Could not launch" / "device is locked" / Developer Mode prompts.** Unlock the
device, enable Developer Mode, and trust the developer certificate (section 5).

**Android: Gradle sync fails on a JDK or SDK version.** In Android Studio ▸ Settings ▸
Build Tools ▸ Gradle, use the bundled JDK, and install SDK Platform 36 from the SDK
Manager.

**Android: device not listed.** Run `adb devices`. If it shows `unauthorized`, re-plug and
accept the prompt on the phone; if it's missing, try another cable or port (some cables
are charge-only).

**Android release: "App not installed" or "package conflicts with an existing
package".** The phone has a copy of Zamar signed with a different key: a debug build, or a
release signed with another `.jks`. Uninstall it first (this deletes its data, see section
4.8). If it's a release you signed yourself, you picked the wrong key file in 4.7.

**Android release: an update is refused.** The `versionCode` is lower than the installed
copy's. Raise it above the installed version (section 4.9).

**Android release: "Keystore was tampered with, or password was incorrect".** The key
store password is wrong. Check your saved copy (section 4.6).

**Android Studio: "Generate Signed App Bundle or APK" is greyed out or missing.** Gradle
sync hasn't finished, or you opened the `Zamar` folder instead of `Zamar/android`
(section 4.5).

**The app on the device doesn't have my latest change.** You skipped `npm run cap:sync`
(or `npx cap copy`) after changing web code. The native project only ever sees the last
synced `dist/`.

## 10. iOS first-build notes

Fill this in during the first real Xcode build, so the next person doesn't rediscover it:

- Date, Mac, Xcode version:
- Did package resolution succeed first time?
- Build errors and fixes:
- Simulator run:
- Device run (model, iOS version):
- Anything from the checklist in section 8 that behaved differently from Android:

Things likely to come up, worth checking first:

- **Photo import on iOS.** The photo picker comes from a web `<input type="file"
  accept="image/*">`, which on iOS can offer "Take Photo". Using the camera from an app
  whose `Info.plist` has no `NSCameraUsageDescription` terminates the app, so `Info.plist`
  now carries that key and `NSPhotoLibraryUsageDescription`. Check that "Take Photo" shows
  the camera permission prompt and that a taken photo imports.
- **SQLite on iOS.** The `@capacitor-community/sqlite` plugin has never run on iOS in this
  project. Watch the Xcode console on first launch for plugin or database-open errors, and
  confirm the persistence checks in section 8.
