# WAVE Player

A browser and downloadable offline music player with a PS3-style XMB interface: horizontal categories, a vertical selection list, and original flowing light ribbons across the screen. Built with plain HTML, CSS, and JavaScript. No runtime dependencies or Electron.

## Play, download, and install

Open [WAVE Player](https://secretobelisks.github.io/wave-player/) in a modern browser. Import your own music using the file picker or drag and drop. Audio stays on your device: this app has no upload service or account requirement.

- **Browser:** use the hosted player immediately.
- **Download:** save [WAVE-Player.html](https://secretobelisks.github.io/wave-player/downloads/WAVE-Player.html), then double-click the file to open the complete player offline in your browser. The interface, scripts, and textures are embedded in this single file.
- **Install:** use your browser's install-app option in Chrome or Edge. The browser installs a Progressive Web App (PWA) with its own launcher and window. Open the site online once so its interface can be cached, then use the installed app offline. Installation availability and menu wording vary by browser and platform.

Imported audio is saved locally in browser storage when available. Storage quotas, private browsing, file-URL storage restrictions, or clearing site data can remove saved tracks; keep your original files. The player is not a backup service.

## Navigate and listen

Use **Left / Right** to move between categories and **Up / Down** to select an item. Press **Enter** to open or play the selected item; mouse and touch controls are also available. Press **Space** to play or pause, **Shift + Left / Right** to seek five seconds, and **/** to search your music.

Open the visualizer category for three full-screen views: **Flow** layers luminous ribbons, **Spectrum** shows frequency bars, and **Orbit** surrounds the music with moving light. These original effects respond to the playing audio when the browser permits audio analysis. Press **Escape** to return to the menu. Settings include color atmospheres and reduced motion.

## Audio formats

MP3, WAV, FLAC, Ogg/Vorbis, Opus, AAC, and M4A support depends on your browser's codecs and the encoding inside each file. File extensions alone do not guarantee playback. DRM-protected tracks and uncommon formats such as some WMA or AIFF variants may require conversion. The player reports files it cannot decode; it does not claim to decode every audio format.

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

The interface and artwork are cached by the service worker on the hosted site. Imported audio is read locally and is not sent to GitHub Pages or another server. The app does not use analytics, trackers, remote fonts, or a backend. A normal site visit downloads the app's static files from its host. The standalone HTML requires no network connection.

## Artwork and attribution

All interface artwork and textures in this project are original. This is an independent project, not affiliated with or endorsed by Sony, PlayStation, or PSP. Those names belong to their respective owners. No console firmware assets, logos, or copyrighted music are bundled. Demo audio is synthesized locally.

MIT licensed. See [LICENSE](LICENSE).
