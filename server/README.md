# Direct audio companion

This service obtains an actual audio file for a public YouTube video or SoundCloud track. WAVE imports that file into its existing music engine, so the normal timeline, volume, queue and visualizer work without a provider iframe.

The website alone cannot do this: GitHub Pages only serves static files, and provider page URLs are not audio files. The companion must be running on the same computer, or an operator must provide an HTTPS backend. An Android APK or iPhone home-screen installation does not include a Python server.

## Run locally

Install Python 3.10+ and a supported JavaScript runtime for YouTube: Node.js 22+ or Deno. Use the current yt-dlp dependency because providers change their delivery systems.

From the repository root, on Windows PowerShell:

```powershell
python -m venv server/.venv
server/.venv/Scripts/python -m pip install -r server/requirements.txt
server/.venv/Scripts/python server/audio_server.py
```

On macOS or Linux:

```sh
python3 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
server/.venv/bin/python server/audio_server.py
```

If your runtime is outside PATH, pass `--js-runtime "node:C:/path/to/node.exe"` (or `--js-runtime deno`). No FFmpeg is required by this companion: it selects an existing audio-only M4A, MP3, WebM, Ogg or Opus stream, with M4A preferred. Availability and browser codec support vary by track.

The service listens only on **http://127.0.0.1:4181**. Open the local WAVE website and use its Audio server setting with that address. `http://localhost:4181` also works. Keep this terminal running while loading links. Existing imported files use WAVE's local library storage.

For this development workspace only, dependencies may instead be installed to the ignored `.tmp/audio-python` directory and exposed through `PYTHONPATH`. That is not required for ordinary installations.

## API

`GET /health` responds with `{"status":"ok","service":"wave-audio","version":1}`. This is a server health check, not a guarantee that a provider will accept a particular track.

`POST /resolve`, with `Content-Type: application/json`:

```json
{"url":"https://soundcloud.com/forss/flickermood"}
```

The response contains a relative, temporary file URL:

```json
{"audioUrl":"/audio/<random-token>","title":"Flickermood","artist":"Forss","mime":"audio/mp4","fileName":"Flickermood.m4a"}
```

`GET /audio/<random-token>` returns the entire audio file with its MIME type. Resolve `audioUrl` against the configured server address. WAVE fetches it as a Blob and imports it as a File; this endpoint does not implement streaming range requests. Errors are JSON `{"error":"description"}` with a non-2xx status. Concurrent-limit errors return 429, deadline errors 504. Closing the resolve connection cancels an active download.

Limits: two simultaneous downloads, 64 MiB per audio file, two-hour recorded duration, three-minute request deadline, and 30-minute file expiry. The cache accepts 20 finished tracks (up to two concurrent completions may finish beyond that threshold), with at most 64 MiB plus metadata per active job. Files are stored in a fresh OS temporary directory; periodic cleanup deletes expired entries. Restarting the server invalidates all file tokens. No permanent download history is kept by the companion.

Only single YouTube video URLs and full `soundcloud.com/artist/track` URLs are accepted. Playlists, SoundCloud short links, live broadcasts, authenticated/private content and arbitrary URLs are unsupported. There are no cookies, login credentials or DRM overrides. Use audio you are permitted to access and save. Provider availability is not guaranteed; update with `python -m pip install --upgrade -r server/requirements.txt` using the virtual environment's Python.

## Phones and a hosted backend

`127.0.0.1` on a phone means the phone itself, not your PC. To use direct audio on phones, an operator needs an HTTPS backend that the phone can reach. This repository does **not** automatically publish or pay for one. Safari, Android and desktop browsers may also restrict a public website accessing a loopback service; using the local website avoids that cross-network requirement.

An operator can place an HTTPS reverse proxy on the same machine as the companion, forwarding only `/health`, `/resolve` and `/audio/…` to loopback:

```sh
python server/audio_server.py --public-base https://audio.example.com
```

`--public-base` adds that exact trusted Host; it does not bind a public port or create hosting. The existing WAVE origin `https://daronthedragon.github.io` is allowed. Additional website origins require an explicit `--allow-origin https://player.example.com`. The proxy should preserve its Host header and the browser's Origin. Configure WAVE's Audio server setting with the HTTPS origin.

The built-in HTTP server is a local companion, not a hardened multi-user hosting platform. Before exposing it, implement authentication or equivalent access control at the proxy, rate limits, HTTPS, bandwidth/storage quotas, and request timeouts over 180 seconds. An Origin allowlist is not authentication: non-browser clients can omit or forge Origin. Do not publish an unrestricted proxy for everyone. Cached file tokens grant temporary access to that one file.

Default browser origins: `http://localhost` and `http://127.0.0.1` on ports 4173, 4177 or 4180, plus `https://daronthedragon.github.io`. Other Host/Origin values are rejected; `Origin: null` is rejected. A standalone `file://` copy should instead be served by a local web server.

## Checks

```sh
python -m unittest discover -s server -p 'test_*.py' -v
```

Tests run an isolated fake downloader to verify real HTTP file transfer, URL restrictions, Host/Origin checks, preflights, bounded concurrency, expiration, errors, size checks, cancellation and child-process timeouts. They do not contact providers or prove that every provider track works.

Implementation references: [yt-dlp installation and CLI documentation](https://github.com/yt-dlp/yt-dlp), [JavaScript runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
