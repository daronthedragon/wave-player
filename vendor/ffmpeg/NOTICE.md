# Bundled FFmpeg WebAssembly decoder

WAVE includes unmodified `ffmpeg-core.js` and `ffmpeg-core.wasm` from the official
**@ffmpeg/core 0.12.10**, single-thread UMD distribution. Files were downloaded
from <https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz>.

The core is **GPL-2.0-or-later**, not covered by WAVE's MIT license. See the
included `COPYING.GPLv2`. The ffmpeg.wasm JavaScript bindings/build wrapper are
MIT licensed; see `LICENSE.wrapper`. FFmpeg and its linked codec libraries
retain their respective copyright and license notices in the upstream sources.
No warranty is provided. The combined program code in the downloadable HTML
containing this GPL decoder is distributed under GPL-2.0-or-later; WAVE's
independently distributed original source remains available under MIT.
Separately copyrighted PS3 image assets are not relicensed by these code
licenses. See `assets/ps3/NOTICE.md` for their provenance and rights notice.

## Source and build information

- WAVE source, including its conversion worker and standalone bundler:
  <https://github.com/secretobelisks/wave-player>
- ffmpeg.wasm source/build scripts at release v12.15 (core 0.12.10):
  <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1>
- Source archive:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz>
- Core build recipe, codec source repositories, branches, and build flags:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile>
- FFmpeg source n5.1.4:
  <https://github.com/FFmpeg/FFmpeg/tree/n5.1.4>
- FFmpeg source archive:
  <https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n5.1.4.tar.gz>

The upstream build recipe includes x264, x265, libvpx, LAME, Ogg, Theora, Opus,
Vorbis, zlib, libwebp, FreeType, FriBidi, HarfBuzz, libass, and zimg. Its Dockerfile
identifies the repositories and versions for these dependencies. Emscripten
3.1.40 produces the single-thread WebAssembly core. Rebuild instructions are in
the upstream repository's contribution documentation and build scripts.

## Integrity

SHA-256:

```text
b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21  ffmpeg-core.js
9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7  ffmpeg-core.wasm
```

The upstream npm package metadata is preserved in `package-metadata.json`.
WAVE does not use the `@ffmpeg/ffmpeg` npm wrapper; its local worker invokes the
core directly. All conversion happens on the user's device.
