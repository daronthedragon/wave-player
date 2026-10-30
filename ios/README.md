# WAVE for iPhone and iPad

This is a native iOS application target containing WAVE's web player in Capacitor's `WKWebView`. It bundles the interface, decoder, and media tools, without Electron, a remote website shell, analytics, or an account service. Minimum iOS version: **15**.

**The CI-produced `WAVE-iOS-UNSIGNED.ipa` is not directly installable.** It is an unsigned build for the owner to sign with Apple provisioning. It is not an App Store or TestFlight release. No Apple credentials or signing keys are stored in this repository or its workflows.

## Build on a Mac

Requirements: Node.js 22+, Xcode 26.0+, Xcode command-line tools. Swift Package Manager resolves the pinned Capacitor 8.6.0 runtime; CocoaPods is not required.

```sh
# From the repository root:
npm run build
cd ios
npm ci
npm run sync
npm run open
```

In Xcode, select the **App** target, choose your Apple team under **Signing & Capabilities**, and select your connected iPhone or iPad. Run the app. Keep the bundle ID `io.github.daronthedragon.waveplayer` and signing team consistent across updates to preserve the installed app's library.

To distribute through TestFlight or the App Store, the owner must create the matching App Store Connect app, provide Apple signing, archive the app in Xcode, and complete Apple's review/distribution process. The unsigned CI artifact cannot bypass those steps.

## What the target includes

- Shared WAVE library, playlists, queue, speed settings, and visualizers.
- Imports through the web view's file chooser. Use **Browse** to choose audio/video from Files.
- Local MP3 conversion and **Keep MP3 in WAVE**, using the existing IndexedDB library.
- The existing local media converter is bundled for offline use; this makes the iOS download larger than the browser's lightweight initial interface. The 43 MB standalone HTML download is deliberately excluded from the native bundle.
- Persistent app storage at `capacitor://localhost`, separate from Safari and the Home Screen web app. Uninstalling or deleting app data removes that library; retain original files.

The native **Share / Save to Files** action writes a disposable MP3 into the app cache and opens Apple’s share sheet through official Capacitor Filesystem/Share plugins. Export is limited to 64 MiB and the temporary file is deleted after the share sheet closes. Physical-device sharing remains to be verified after signing. No native background-audio service is implemented, and uninterrupted playback while locked or suspended is not promised. The app does not include Android's Python audio extractor: YouTube/SoundCloud bookmarks cannot become audio without an accessible audio companion/backend. Do not describe this target as a direct provider downloader.

## CI output

The **iPhone and iPad app** workflow builds the simulator app, launches it in an available iPhone simulator, saves a screenshot, and builds an unsigned arm64 iPhone app. All outputs are Actions artifacts, not automatic public releases:

- `WAVE-iOS-UNSIGNED.ipa` — requires Apple signing/provisioning before device installation.
- `WAVE-iOS-Simulator.zip` — simulator build, not an iPhone IPA.
- `iphone-launch.png` — launch evidence to inspect alongside build logs; it is not a claim that file import, background audio, or provider extraction passed on a physical phone.
- Build logs and SHA-256 checksum.

Run `npm run sync` after changing the root web app. Generated web assets and dependencies stay ignored; native Swift/Xcode sources, config, and dependency lockfile are committed.

References: [Capacitor iOS requirements](https://capacitorjs.com/docs/ios), [Swift Package Manager](https://capacitorjs.com/docs/ios/spm), [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
