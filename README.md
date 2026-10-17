# WAVE Player

A browser and downloadable offline audio/video player with a PS3-style XMB interface: horizontal categories, a vertical selection list, and flowing light ribbons based on an open-source recreation of the console's wave renderer. Built with plain HTML, CSS, and JavaScript, with a bundled FFmpeg WebAssembly converter. No package installation or Electron is required.

## Play, download, and install

Open [WAVE Player](https://daronthedragon.github.io/wave-player/) in a modern browser. Import your own audio or video using the file picker or drag and drop. Media stays on your device: this app has no upload service or account requirement.

- **Browser:** use the hosted player immediately.
- **Download:** save [WAVE-Player.html](https://daronthedragon.github.io/wave-player/downloads/WAVE-Player.html), then double-click the file to open the complete player offline in your browser. The interface, scripts, and textures are embedded in this single file.
- **Install:** use your browser's install-app option in Chrome or Edge. The browser installs a Progressive Web App (PWA) with its own launcher and window. Open the site online once so its interface can be cached, then use the installed app offline. Installation availability and menu wording vary by browser and platform.

Imported media is saved locally in browser storage when available. Storage quotas, private browsing, file-URL storage restrictions, or clearing site data can remove saved tracks; keep your original files. The player is not a backup service.

## iPhone and Android

Tap **Install** in WAVE for device-specific instructions.

- **iPhone / iPad:** open the live website in Safari, choose **Share → Add to Home Screen**, keep **Open as Web App** enabled if shown, and tap **Add**. This installs the web app; it is not an IPA or App Store download. See [Apple's installation guide](https://support.apple.com/guide/iphone/iphea86e5236/ios).
- **Android web app:** in Chrome, choose **⋮ → Add to Home screen → Install**, or use WAVE's install button when available. See [Chrome's installation guide](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).
- **Android APK:** download [WAVE-Player.apk](https://github.com/daronthedragon/wave-player/releases/latest/download/WAVE-Player.apk), open it, and allow installation from your browser when Android asks. The app loads the live WAVE website with a native file picker. First launch requires internet; cached local playback depends on WebView storage. Keep Android System WebView updated. Install future APK updates over this app to retain its library.

Phone browser, Home Screen app, and Android APK storage can be separate: import your files in the version you intend to use. No account or cloud library sync is provided.

## YouTube and SoundCloud links

Choose **+ Link** or **Online → Add a link**, paste a full YouTube video/playlist or SoundCloud track/playlist URL, optionally give it a name, and choose **Save & open player**. Up to 100 links are saved on this device. Tap a saved item to reopen it; **Remove saved link** removes the bookmark. On Android browsers that support installed web-app sharing, WAVE can also appear in the system Share menu; shared URLs are reviewed before opening.

Playback uses the visible [YouTube embedded player](https://developers.google.com/youtube/player_parameters) and [SoundCloud widget](https://developers.soundcloud.com/docs/api/html5-widget). Their own controls, availability, ads, sign-in restrictions, and background-playback rules apply. Streams require internet and are not downloaded or converted by WAVE. Local audio visualizers do not analyze embedded streams. If a provider disallows embedding, use **Open in YouTube / SoundCloud**. For SoundCloud short links, open the link first and copy the full track URL. YouTube links in the standalone HTML must be opened through the hosted app or YouTube because local files do not supply the required web origin.

## Navigate and listen

Use **Left / Right** to move between categories and **Up / Down** to select an item. Press **Enter** to open or play the selected item; mouse and touch controls are also available. Press **Space** to play or pause, **Shift + Left / Right** to seek five seconds, and **/** to search your music.

Open the visualizer category for three full-screen views: **Flow** layers luminous ribbons, **Spectrum** shows frequency bars, and **Orbit** surrounds the music with moving light. The effects respond to the playing audio when the browser permits audio analysis. Press **Escape** to return to the menu. Settings include color atmospheres and reduced motion.

## Audio, video, and local conversion

Play local audio and video through the browser's native decoder first. Common audio formats include MP3, WAV, FLAC, Ogg/Vorbis, Opus, AAC, and M4A; common video containers include MP4, WebM, and MOV. Actual support depends on the codecs inside each file and your browser.

For files the browser cannot play, choose local conversion. The bundled single-thread **FFmpeg WebAssembly** converter handles many additional formats, including common AVI and MKV combinations, and produces H.264/AAC MP4 video or stereo PCM WAV audio. Conversion never uploads your media. It runs in a cancellable worker with progress feedback; no cross-origin isolation or special hosting headers are needed.

This is broad format support, not a guarantee of every format. DRM/encryption, damaged files, unsupported codecs, browser memory limits, and some unusual streams can prevent playback or conversion. Local conversion accepts inputs up to **256 MB**, allows up to ten minutes of processing (twelve minutes total), and can be much slower than a native desktop converter. Large converted outputs can also exceed browser memory or storage limits. Keep your originals.

The standalone HTML includes the complete converter and is approximately **43 MB**. The hosted app caches the approximately 32 MB decoder for offline use after its service worker finishes installing; wait for that first online cache download before relying on offline conversion.

## Run locally

Install Node.js 22.12 or newer, download or clone this repository, then run:

```sh
npm run build
npm run dev
```

Open <http://127.0.0.1:4173>. No dependency installation is needed. The built standalone HTML works when opened directly; the development source uses JavaScript modules and needs the local server.

```sh
npm test       # Functional unit tests
npm run build # Build the site and standalone HTML into dist/
```

The development server binds only to `127.0.0.1`, serves files from this project, blocks hidden files and tooling directories, and rejects paths outside the project.

## Releases and deployment

The repository's **Releases** page provides `WAVE-Player.html` and `Wave-Player-Web.zip`, the complete static website. The **Build downloadable player** Action produces these artifacts manually or when a version tag such as `v1.0.0` is pushed. Tagged builds attach the files to a GitHub Release.

The **Publish browser player** Action deploys `dist/` to GitHub Pages on pushes to `main` or manual dispatch. In repository settings, set Pages source to **GitHub Actions**. Any HTTPS static host can serve `dist/`.

## Privacy and offline behavior

The interface and artwork are cached by the service worker on the hosted site. Imported files are read locally and are not uploaded. WAVE has no analytics or account backend. A normal site visit downloads the app's static files from its host. Opening a saved streaming link connects to YouTube or SoundCloud and their players may use cookies, analytics, and other resources under their policies. No provider player is loaded until you open a link; closing it stops playback and removes the iframe. The standalone HTML works offline for local media; online links require internet.

## Artwork and attribution

The wave rendering uses [linkev's PlayStation-3-XMB recreation](https://github.com/linkev/PlayStation-3-XMB), copyright 2025 Mart, under the MIT license, adapted for WAVE's lifecycle, themes, reduced motion, and audio response. It uses the upstream reconstruction's synthetic displacement descriptors and fitted gradient presets, not extracted Sony firmware textures. Upstream sources, license, and technical provenance are preserved in [vendor/ps3-xmb](vendor/ps3-xmb/NOTICE.md); attribution and the license are also embedded in the standalone download.

WAVE's SVG artwork directly inside `assets/` and its synthesized demo sounds are original. The separate PNG icons in `assets/ps3/` are firmware-derived PS3 interface textures from the public xmb-web reference project. Sony or their respective owners retain the rights to these images; they are excluded from WAVE's MIT license, the renderer's MIT license, and FFmpeg's GPL license. Inclusion does not grant ownership or a general redistribution license. Their provenance and rights notice are preserved in [assets/ps3/NOTICE.md](assets/ps3/NOTICE.md) and embedded in the standalone download.

This is an independent project, not affiliated with or endorsed by Sony, PlayStation, or PSP. Those names belong to their respective owners. No commercial music, Sony fonts, or boot logos are bundled.

Original WAVE source is MIT licensed; see [LICENSE](LICENSE). The bundled FFmpeg core is **GPL-2.0-or-later**, and the combined program code in the downloadable HTML is distributed under that license. This does not relicense the separately copyrighted PS3 image assets. Decoder licenses, exact file hashes, and source/build links are included in [vendor/ffmpeg/NOTICE.md](vendor/ffmpeg/NOTICE.md), with license copies also embedded in the standalone HTML.
