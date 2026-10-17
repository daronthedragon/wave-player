# Android distribution notices

The Android APK combines WAVE with **youtubedl-android 0.18.1**, which is licensed under the GNU General Public License version 3. The combined APK is distributed under GPL-3.0. Original WAVE source files remain available under their existing MIT license; that permission is not removed. The included web decoder retains its existing notices in `vendor/ffmpeg/`.

The full GPL text is included at [`app/src/main/assets/licenses/GPL-3.0.txt`](app/src/main/assets/licenses/GPL-3.0.txt) and inside the APK. WAVE's complete Android integration and build instructions are available in this repository at the same release tag as the APK: <https://github.com/daronthedragon/wave-player>. No warranty is provided.

## Extractor and runtimes

- **youtubedl-android 0.18.1** — copyright its upstream contributors; GPL-3.0. Source and native build instructions: <https://github.com/yausername/youtubedl-android/tree/0.18.1>. Source archive: <https://github.com/yausername/youtubedl-android/archive/refs/tags/0.18.1.tar.gz>. Published dependency: `io.github.junkfood02.youtubedl-android:library:0.18.1` and its `common:0.18.1` dependency on Maven Central. WAVE uses these published packages without modifying them.
- **yt-dlp 2026.08.19**, with **yt-dlp-ejs 0.8.0** — WAVE overrides the Android library's older `res/raw/ytdlp` resource with the unchanged official zipimport executable from <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19>. SHA-256: `1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6`. Sources: <https://github.com/yt-dlp/yt-dlp/tree/2026.08.19> and <https://github.com/yt-dlp/ejs/tree/0.8.0>. Both use the Unlicense; the EJS bundle also contains Meriyah 6.1.4 (ISC) and Astring 1.9.0 (MIT). Their notices remain in the original bundled JavaScript and are copied into `app/src/main/assets/licenses/yt-dlp-ejs-dependencies.txt`. The Unlicense texts and upstream's complete supplementary third-party notice collection are also bundled there; that collection covers additional upstream distribution variants and does not imply WAVE includes every listed component.
- The extractor stays fixed until an APK update. WAVE verifies the packaged SHA-256 and atomically replaces the wrapper's private cached extractor when it differs, including when upgrading an older installed APK. It never downloads executable updates at runtime and never modifies user media or playlists during this migration. The wrapper and native runtime dependencies remain unchanged.
- **CPython, QuickJS, and Python native dependencies** — native executables and their runtime files are included in the upstream Android package for ARM64, ARMv7, x86, and x86-64. Upstream source/build recipe: <https://github.com/yausername/youtubedl-android/blob/0.18.1/BUILD_PYTHON.md>; package source recipes: <https://github.com/termux/termux-packages>. CPython: <https://github.com/python/cpython> (Python Software Foundation license); QuickJS: <https://bellard.org/quickjs/> (MIT). The Android library bundles the native runtime; WAVE does not require a separate Python or JavaScript installation.

## Java and Android libraries

- **AndroidX WebKit 1.14.0**, AppCompat, and AndroidX Core — Apache-2.0; <https://android.googlesource.com/platform/frameworks/support/>.
- **Kotlin standard library** — Apache-2.0; <https://github.com/JetBrains/kotlin>.
- **Jackson** — Apache-2.0; <https://github.com/FasterXML/jackson>.
- **Apache Commons IO** — Apache-2.0; <https://github.com/apache/commons-io>.

Gradle resolves the pinned Android library and its transitive dependencies from Maven Central and Google Maven. `gradle :app:dependencies` records the resolved dependency graph. Sources, licenses, notices, and native build instructions for the extractor are linked above; preserve them when redistributing the APK or a modified build.
