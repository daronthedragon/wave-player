# WAVE for Android

WAVE bundles its player interface and decoder in the APK, so it opens offline on the first launch. Android 8 or newer is required. Keep Android System WebView updated.

The bundled files are served inside WebView at the original `https://daronthedragon.github.io/wave-player/` origin. Existing IndexedDB media, playlists and localStorage settings therefore survive an APK update installed over the previous release with the same signing key. The app never clears that data during startup or updates. Its library is separate from Chrome's library. Clearing app data or uninstalling deletes the app library; keep a separate copy of your original media files.

Imported files and audio already saved from a link remain on the device for offline playback. Retrieving new YouTube or SoundCloud audio requires an internet connection and a configured HTTPS audio server. Public server hosting is not bundled or provided by this APK; a localhost address refers to the phone itself. Use another app's Share menu and choose WAVE Player to send a link to the player's review form. Confirm it there before adding or retrieving the audio. Background/lock-screen playback is not promised; this is not a native background media service.

Only the Internet permission is requested. Files are selected with Android's system picker, without access to the whole media library. HTTPS links outside the player open in your browser. There is no JavaScript-to-native bridge, HTTP content, arbitrary intent handling, or certificate bypass. Asset requests are limited to the app's fixed HTTPS origin and validated package paths; private server files and desktop downloads are excluded from the APK.

## Build

Install Node.js 22+, JDK 17+, Gradle 8.13, Android SDK platform 36 and build tools 35.0.0. Set `ANDROID_HOME`, then run from the repository root:

```sh
npm run build
cd android
gradle lintDebug assembleDebug
```

Gradle copies the built `dist` shell into generated APK assets and fails with a clear message if it has not been built. Run `npm run build` again after web changes. Open `android/` in Android Studio to run on a device. The app version comes from the root `package.json`; increase that semantic version before releasing an update.

Both Android workflows build the web assets before compiling Android. They also run a dependency-free Java test covering asset path traversal, escaping, downloads and private-path rejection.

## Release signing

The `Android APK` workflow builds version tags and supports manually building an existing tag. It lints an unsigned release APK and saves the `WAVE-Android-Unsigned` Actions artifact. `Android checks` produces the same artifact on relevant main pushes. Workflows never receive or upload the private signing key. The unsigned artifact is not an installable public download.

Download the artifact and sign it locally on Windows:

```powershell
./android/sign-apk.ps1 -InputApk ./app-release-unsigned.apk
```

The helper expects private metadata at `.tmp/android-signing/signing.json` with `keystorePath`, `keyAlias`, `storePassword`, and `keyPassword`. It uses the official Android build tools from `.tmp/android-tooling/android-15` by default; pass `-BuildTools` to use your SDK's `build-tools/35.0.0` directory. It aligns the APK, signs with passwords passed through temporary environment variables, verifies its signature and alignment, and writes `.tmp/android-release/WAVE-Player.apk` plus its SHA-256 file. Upload only those two output files to the GitHub release.

Keep the key and passwords backed up privately: every future update must use the same key. Never commit them. Debug APKs use a different key and cannot update a release installation in place.

To sideload, download the release APK, allow installation from the browser/file manager when Android asks, then open the APK. Future releases can be installed over the app when signed with the same key, preserving its library. Do not uninstall the previous release to update it.
