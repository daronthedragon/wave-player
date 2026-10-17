# WAVE for Android

This small native shell opens `https://daronthedragon.github.io/wave-player/` in Android System WebView. It uses the same library and interface as the website, with an Android file picker, fullscreen video, Back navigation, and a retry screen. Android 8 or newer is required. Keep Android System WebView updated.

Use another app's Share menu and choose WAVE Player to send a YouTube or SoundCloud link into the player's review form. Links are not added or played until you confirm them there.

The APK needs internet access for the first visit and for YouTube/SoundCloud embeds. The website's service worker can cache the player for later offline visits. Imported media is stored in this app's own WebView storage; it is separate from Chrome's library. Clearing app data or uninstalling deletes that library. Streaming providers can restrict embedded playback. Background/lock-screen playback is not promised; this is not a native background media service.

Only the Internet permission is requested. Files are selected with Android's system picker; the app does not request access to your whole media library. HTTPS links outside the hosted player open in your browser. There is no JavaScript-to-native bridge, HTTP content, arbitrary intent handling, or certificate bypass.

## Build

Install JDK 17+, Gradle 8.13, Android SDK platform 36 and build tools 35.0.0. Set `ANDROID_HOME`, then from this directory run:

```sh
gradle lintDebug assembleDebug
```

Open this directory in Android Studio to run on a device. The app version comes from the root `package.json`. Increase that semantic version before releasing an update.

## Release signing

The `Android APK` workflow runs on version tags and can also build an existing version tag manually. Without hosted signing secrets it builds and lints an unsigned APK and saves it as the `WAVE-Android-Unsigned` Actions artifact. That unsigned file is never published as an installable download. The `Android checks` workflow also produces this unsigned artifact on main pushes.

To keep the signing key entirely on your computer, download that artifact, then use the local signing helper on Windows:

```powershell
./android/sign-apk.ps1 -InputApk ./app-release-unsigned.apk
```

The helper expects private metadata at `.tmp/android-signing/signing.json` with `keystorePath`, `keyAlias`, `storePassword`, and `keyPassword`. It uses the official Android build tools from `.tmp/android-tooling/android-15` by default; pass `-BuildTools` to use your SDK's `build-tools/35.0.0` directory. It aligns the APK, signs with passwords passed through temporary environment variables, verifies the signature and alignment, and writes `.tmp/android-release/WAVE-Player.apk` plus its SHA-256 file. Upload only those two output files to the GitHub release. Keep the key and metadata private.

Optionally, to sign and publish entirely inside Actions, configure these encrypted repository secrets. When all are configured, the release workflow signs, verifies, and attaches `WAVE-Player.apk` and its SHA-256 file to the GitHub release:

- `WAVE_ANDROID_KEYSTORE_BASE64`: base64 of the private JKS/PKCS12 signing keystore
- `WAVE_ANDROID_KEYSTORE_PASSWORD`: keystore password
- `WAVE_ANDROID_KEY_ALIAS`: signing alias
- `WAVE_ANDROID_KEY_PASSWORD`: key password

For a local release build, expose those passwords as `WAVE_KEYSTORE_PASSWORD`, `WAVE_KEY_ALIAS`, `WAVE_KEY_PASSWORD` and the absolute keystore path as `WAVE_KEYSTORE_PATH`, then run `gradle lintRelease assembleRelease`. Without a keystore the local release output is unsigned; the release workflow skips publication without the signing secret.

Keep the signing key and passwords backed up privately: every future update must use the same key. Never commit them. Debug APKs use a different key and cannot update a release installation in place.

To sideload, download the release APK, allow installation from the browser/file manager when Android asks, then open the APK. Android may warn because the app is distributed outside Google Play. Future releases can be installed over the app when signed with the same key.
