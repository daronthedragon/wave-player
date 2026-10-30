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

The native **Share / Save to Files** action writes a disposable MP3 into the app cache and opens Apple’s share sheet through official Capacitor Filesystem/Share plugins. Export is limited to 64 MiB and the temporary file is deleted after the share sheet closes. Physical-device sharing remains to be verified after signing. No native background-audio service is implemented, and uninterrupted playback while locked or suspended is not promised.

## On-device YouTube importing

The native target includes [YouTubeKit 0.4.10](https://github.com/alexeichhorn/YouTubeKit/tree/0.4.10), pinned through Swift Package Manager. WAVE explicitly enables only its local extraction method; the optional hosted fallback is never enabled. Public individual videos are resolved on the phone and their audio-only M4A stream is downloaded with URLSession. The downloaded file enters WAVE's existing library/conversion flow. A download must contain decodable audio, be at most 64 MiB, and be no longer than two hours. MP3 export is an additional local conversion.

The importer checks YouTube input hosts and Google video CDN download/redirect hosts, streams downloads to the app cache, transfers bounded 256 KiB chunks to the player, and cleans temporary files after import. Cancellation and a three-minute JavaScript timeout are supported. Provider restrictions and changes can still prevent extraction; compile success alone is not proof of live playback. SoundCloud importing is not currently implemented in this iOS target. The website/PWA cannot use the native bridge.

YouTubeKit is MIT licensed; its notice is in `licenses/YouTubeKit-MIT.txt` and bundled into the app's web resources. The app does not include the Android Python runtime.

## CI output

The **iPhone and iPad app** workflow builds the simulator app, launches it in an available iPhone simulator, saves a screenshot, and builds an unsigned arm64 iPhone app. All outputs are Actions artifacts, not automatic public releases:

- `WAVE-iOS-UNSIGNED.ipa` — requires Apple signing/provisioning before device installation.
- `WAVE-iOS-Simulator.zip` — simulator build, not an iPhone IPA.
- `iphone-launch.png` — launch evidence to inspect alongside build logs; it is not a claim that file import, background audio, or provider extraction passed on a physical phone.
- Build logs and SHA-256 checksum.

A Debug simulator launch with `-wave-audio-diagnostic` runs an explicit live YouTube resolve/download probe and checks the downloaded audio using AVURLAsset. It writes `Library/Caches/wave-ios-diagnostic.json` inside the app data container. A provider failure is recorded as a failure, not treated as successful playback. This argument has no effect in Release builds.

Run `npm run sync` after changing the root web app. Generated web assets and dependencies stay ignored; native Swift/Xcode sources, config, and dependency lockfile are committed.

References: [Capacitor iOS requirements](https://capacitorjs.com/docs/ios), [Swift Package Manager](https://capacitorjs.com/docs/ios/spm), [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
