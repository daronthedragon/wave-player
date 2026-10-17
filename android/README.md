# WAVE for Android

WAVE bundles its player interface and decoder in the APK, so it opens offline on the first launch. Android 8 or newer is required. Keep Android System WebView updated.

The bundled files are served inside WebView at the original `https://daronthedragon.github.io/wave-player/` origin. Existing IndexedDB media, playlists and localStorage settings therefore survive an APK update installed over the previous release with the same signing key. The app never clears that data during startup or updates. Its library is separate from Chrome's library. Clearing app data or uninstalling deletes the app library; keep a separate copy of your original media files.

Imported files and audio already saved from a link remain on the device for offline playback. This APK retrieves new public YouTube and SoundCloud tracks directly on the phone using its bundled yt-dlp, Python, and QuickJS runtimes. There is no shared WAVE server, server address, account, or hosting setup. An internet connection is required for new imports. Use another app's Share menu and choose WAVE Player to send a link to the player's review form, then confirm the import and playlist. Private, live, restricted, unavailable, or provider-blocked tracks may fail. Imports are limited to one track at a time, two hours, 64 MiB, and three minutes of retrieval time. Provider changes can require an updated APK. Background/lock-screen playback is not promised; this is not a native background media service.

Only the Internet permission is requested. Files are selected with Android's system picker, without access to the whole media library. HTTPS links outside the player open in your browser. A scoped AndroidX WebMessage listener accepts import/cancel messages only from the main frame of WAVE's bundled HTTPS page. It validates YouTube/SoundCloud track URLs again in native code; it does not expose shell commands, paths, cookies, credentials, or arbitrary URL fetching. Completed audio is passed to the existing IndexedDB library through a one-use random-token URL intercepted inside WebView. Temporary native files are deleted after transfer or after a short expiry. Asset requests are limited to the app's fixed HTTPS origin and validated package paths; private server files and desktop downloads are excluded from the APK.

The GitHub Pages version can be installed as a home-screen app and retains local files and playlists, but browser/iPhone security restrictions prevent it from running the APK's native extractor. The website does not silently send links to a public proxy. See [Android distribution notices](THIRD_PARTY_NOTICES.md) for the combined APK's GPL-3.0 license and dependency sources.

## Build

Install Node.js 22+, JDK 17+, Gradle 8.13, Android SDK platform 36 and build tools 35.0.0. Set `ANDROID_HOME`, then run from the repository root:

```sh
npm run build
cd android
gradle lintDebug assembleDebug
```

Gradle copies the built `dist` shell into generated APK assets and fails with a clear message if it has not been built. Run `npm run build` again after web changes. Open `android/` in Android Studio to run on a device. The app version comes from the root `package.json`; increase that semantic version before releasing an update.

The app's `res/raw/ytdlp` overrides the wrapper's older resource with the official yt-dlp 2026.08.19 zipimport executable, including EJS 0.8.0. `PackagedExtractor` verifies its pinned SHA-256 before atomically installing it in the wrapper's private extractor directory. This also upgrades the cached extractor on existing installations; an APK resource replacement alone would only fix fresh installs. Matching extractor files are left untouched. No executable code is fetched during app use, and the migration never clears WebView storage or user media. See the pinned source, checksum, and licenses in `THIRD_PARTY_NOTICES.md`.

Both Android workflows build the web assets before compiling Android. They also run a dependency-free Java test covering asset path traversal, escaping, downloads and private-path rejection.

`AudioLinkTest.java` tests the native request boundary, including host confusion, ports, credentials, playlists, traversal, control characters, and command-like request IDs. `gradle connectedDebugAndroidTest` runs device/emulator smoke tests proving the packaged Python/extractor and QuickJS executables launch. The tests assert the exact extractor version, replacement of an old extractor, preservation of an unchanged extractor, and rejection of a damaged update without losing the existing file. These tests do not need provider access. To additionally verify the complete bundled JavaScript → native bridge → provider → returned audio File flow, run:

```sh
gradle connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.waveLiveAudio=true
```

Those optional live tests retrieve the public SoundCloud `forss/flickermood` and YouTube `M7lc1UVf-VE` samples. They fail when the provider refuses access from the test device/network, rather than treating metadata or an error response as playable audio. A physical phone should also be tested before claiming all devices are supported.

## Release signing

The `Android APK` workflow builds version tags and supports manually building an existing tag. It lints an unsigned release APK and saves the `WAVE-Android-Unsigned` Actions artifact. `Android checks` produces the same artifact on relevant main pushes. Workflows never receive or upload the private signing key. The unsigned artifact is not an installable public download.

Download the artifact and sign it locally on Windows:

```powershell
./android/sign-apk.ps1 -InputApk ./app-release-unsigned.apk
```

The helper expects private metadata at `.tmp/android-signing/signing.json` with `keystorePath`, `keyAlias`, `storePassword`, and `keyPassword`. It uses the official Android build tools from `.tmp/android-tooling/android-15` by default; pass `-BuildTools` to use your SDK's `build-tools/35.0.0` directory. It aligns the APK, signs with passwords passed through temporary environment variables, verifies its signature and alignment, and writes `.tmp/android-release/WAVE-Player.apk` plus its SHA-256 file. Upload only those two output files to the GitHub release.

Keep the key and passwords backed up privately: every future update must use the same key. Never commit them. Debug APKs use a different key and cannot update a release installation in place.

To sideload, download the release APK, allow installation from the browser/file manager when Android asks, then open the APK. Future releases can be installed over the app when signed with the same key, preserving its library. Do not uninstall the previous release to update it.
