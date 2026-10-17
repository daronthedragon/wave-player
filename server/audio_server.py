"""Loopback-only WAVE audio companion. Run with Python 3.10+ and yt-dlp."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import secrets
import select
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ORIGINS = frozenset({"https://daronthedragon.github.io", *(
    f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (4173, 4177, 4180)
)})
MIMES = {"m4a": "audio/mp4", "mp3": "audio/mpeg", "webm": "audio/webm", "ogg": "audio/ogg", "opus": "audio/ogg"}
MAX_BYTES = 64 * 1024 * 1024
MAX_DURATION = 7200
TIMEOUT = 180
TTL = 1800


class ResolveError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def canonical_url(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise ResolveError("Enter a YouTube video or full SoundCloud track URL.", 400)
    try:
        url = urlsplit(value.strip())
        if url.scheme != "https" or url.username or url.password or url.port not in (None, 443):
            raise ValueError()
        host = url.hostname
        parts = url.path.strip("/").split("/")
        video = None
        if host in {"youtu.be", "www.youtu.be"} and len(parts) == 1:
            video = parts[0]
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
            if url.path == "/watch":
                video = parse_qs(url.query).get("v", [None])[0]
            elif len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}:
                video = parts[1]
        if video and re.fullmatch(r"[a-zA-Z0-9_-]{11}", video):
            return f"https://www.youtube.com/watch?v={video}"
        if host in {"soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"} and len(parts) == 2:
            if all(re.fullmatch(r"[a-zA-Z0-9_-]+", part) for part in parts) and parts[0] not in {"discover", "search", "you", "stream", "charts"} and parts[1] not in {"sets", "tracks", "likes", "reposts", "albums", "popular-tracks"}:
                return "https://soundcloud.com/" + "/".join(parts)
    except ValueError:
        pass
    raise ResolveError("Use a single YouTube video or full soundcloud.com/artist/track link. Playlists and short SoundCloud links are not supported.", 400)


@dataclass
class CachedAudio:
    path: Path
    expires: float
    title: str
    artist: str
    mime: str


class Resolver:
    def __init__(self, cache, command=None, timeout=TIMEOUT, max_bytes=MAX_BYTES, ttl=TTL, js_runtime="node"):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.command = command or [sys.executable, "-m", "yt_dlp"]
        self.timeout, self.max_bytes, self.ttl = timeout, max_bytes, ttl
        self.js_runtime = js_runtime
        self.slots = threading.BoundedSemaphore(2)
        self.lock = threading.Lock()
        self.entries = {}
        self.stopping = threading.Event()

    def cleanup(self):
        with self.lock:
            expired = [token for token, entry in self.entries.items() if entry.expires <= time.monotonic()]
            for token in expired:
                entry = self.entries.pop(token)
                shutil.rmtree(entry.path.parent, ignore_errors=True)

    def get(self, token):
        self.cleanup()
        with self.lock:
            return self.entries.get(token)

    def resolve(self, url, disconnected=lambda: False):
        url = canonical_url(url)
        self.cleanup()
        if not self.slots.acquire(blocking=False):
            raise ResolveError("Two tracks are already loading. Try again shortly.", 429)
        folder = Path(tempfile.mkdtemp(prefix="track-", dir=self.cache))
        process = None
        succeeded = False
        try:
            # Cache is bounded in addition to individual downloads; never delete an active job.
            with self.lock:
                if len(self.entries) >= 20:
                    raise ResolveError("Audio cache is full. Try again after cached tracks expire.", 429)
            arguments = self.command + [
                "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir", "--no-progress",
                "--no-warnings", "--no-check-formats", "--no-allow-unplayable-formats",
                "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1",
                "--concurrent-fragments", "1", "--max-filesize", str(self.max_bytes),
                "--downloader", "m3u8:native", "--fixup", "never",
                "--js-runtimes", self.js_runtime,
                "--match-filter", f"duration <= {MAX_DURATION} & !is_live",
                "--format", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=webm]/bestaudio[ext=ogg]/bestaudio[ext=opus]",
                "--write-info-json", "--no-write-playlist-metafiles", "--no-simulate",
                "--output", str(folder / "audio.%(ext)s"), "--", url,
            ]
            # Output goes to a bounded, watched file, never an unconsumed PIPE.
            with (folder / "process.log").open("wb") as log:
                process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), start_new_session=os.name != "nt")
                deadline = time.monotonic() + self.timeout
                while process.poll() is None:
                    if self.stopping.is_set() or disconnected():
                        raise ResolveError("Audio request was cancelled.", 499)
                    if time.monotonic() >= deadline:
                        raise ResolveError("The provider took too long. Try another track.", 504)
                    try:
                        size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
                    except FileNotFoundError:
                        # The downloader atomically renames completed fragments.
                        # Recheck the bounded folder on the next polling cycle.
                        time.sleep(0.1)
                        continue
                    if size > self.max_bytes + 4 * 1024 * 1024:
                        raise ResolveError("Track exceeds the 64 MB download limit.", 413)
                    time.sleep(0.1)
            if process.returncode:
                raise ResolveError("The provider could not supply this audio. It may be unavailable, restricted, or require a newer yt-dlp. Try another public track.")
            info_file = folder / "audio.info.json"
            if not info_file.is_file() or info_file.stat().st_size > 4 * 1024 * 1024:
                raise ResolveError("The provider did not return usable audio metadata.")
            info = json.loads(info_file.read_text(encoding="utf-8"))
            duration = info.get("duration")
            if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= MAX_DURATION or info.get("is_live"):
                raise ResolveError("Only recorded audio up to two hours is supported.")
            ext = info.get("ext")
            if ext not in MIMES:
                raise ResolveError("No browser-compatible audio format was available.")
            path = folder / f"audio.{ext}"
            if not path.is_file() or not 0 < path.stat().st_size <= self.max_bytes:
                raise ResolveError("No audio was downloaded, or it exceeded the 64 MB limit.")
            token = secrets.token_urlsafe(24)
            entry = CachedAudio(path, time.monotonic() + self.ttl,
                str(info.get("title") or "Online audio")[:200], str(info.get("artist") or info.get("uploader") or "")[:200], MIMES[ext])
            # Keep only the playable file, not provider responses or signed source URLs.
            info_file.unlink(missing_ok=True)
            (folder / "process.log").unlink(missing_ok=True)
            with self.lock:
                self.entries[token] = entry
            succeeded = True
            return token, entry
        except (OSError, json.JSONDecodeError) as error:
            raise ResolveError("The audio companion could not prepare this track. Check its Python and yt-dlp installation.", 502) from error
        finally:
            try:
                if process is not None and process.poll() is None:
                    try:
                        if os.name == "nt":
                            # Kill only this downloader's tree, including its JavaScript runtime.
                            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                    process.kill()
                    process.wait(timeout=10)
            finally:
                if not succeeded:
                    shutil.rmtree(folder, ignore_errors=True)
                self.slots.release()


class AudioServer(ThreadingHTTPServer):
    # Shutdown waits for handlers to observe stopping and terminate their children
    # before the temporary cache directory is removed (especially on Windows).
    daemon_threads = False
    request_queue_size = 8

    def __init__(self, address, resolver, public_base=None, extra_origins=()):
        self.resolver = resolver
        self.origins = ORIGINS | frozenset(extra_origins)
        self.public_base = public_base
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "WAVEAudio/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass  # Do not log source URLs or opaque audio tokens.

    def allowed(self):
        port = self.server.server_address[1]
        hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if self.server.public_base:
            hosts.add(urlsplit(self.server.public_base).netloc)
        if self.headers.get("Host") not in hosts:
            self.reply(403, {"error": "Untrusted Host."})
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in self.server.origins:
            self.reply(403, {"error": "This website is not allowed to use the audio companion."})
            return False
        return True

    def send_headers(self, status, mime, length):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def reply(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_headers(status, "application/json; charset=utf-8", len(body))
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def do_OPTIONS(self):
        if self.allowed():
            self.send_headers(204, "text/plain", 0)

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == "/health":
            self.reply(200, {"status": "ok", "service": "wave-audio", "version": 1})
            return
        match = re.fullmatch(r"/audio/([A-Za-z0-9_-]{32})", self.path)
        entry = self.server.resolver.get(match[1]) if match else None
        if entry is None:
            self.reply(404, {"error": "Audio expired or was not found. Load the link again."})
            return
        try:
            with entry.path.open("rb") as audio:
                self.send_headers(200, entry.mime, entry.path.stat().st_size)
                shutil.copyfileobj(audio, self.wfile, 64 * 1024)
        except (FileNotFoundError, BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def disconnected(self):
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    def do_POST(self):
        if not self.allowed():
            return
        if self.path != "/resolve":
            self.reply(404, {"error": "Not found."})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json" or self.headers.get("Transfer-Encoding"):
            self.reply(415, {"error": "Send an application/json request."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ResolveError("Request body is too large or missing.", 413)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
            token, entry = self.server.resolver.resolve(payload.get("url"), self.disconnected)
            self.reply(200, {"audioUrl": f"/audio/{token}", "title": entry.title,
                "artist": entry.artist, "mime": entry.mime, "fileName": f"{entry.title.replace('/', '_').replace(chr(92), '_')}.{entry.path.suffix[1:]}"})
        except ResolveError as error:
            self.reply(error.status, {"error": str(error)})
        except (ValueError, UnicodeDecodeError, socket.timeout):
            self.reply(400, {"error": "Invalid JSON request."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4181)
    parser.add_argument("--js-runtime", default="node", help="yt-dlp runtime, e.g. node:C:/path/to/node.exe (Node 22+), or deno")
    parser.add_argument("--public-base", help="Explicit HTTPS origin of your reverse proxy, e.g. https://audio.example.com")
    parser.add_argument("--allow-origin", action="append", default=[], help="Additional exact HTTPS website origin to allow")
    options = parser.parse_args()
    if not 1 <= options.port <= 65535:
        parser.error("port must be between 1 and 65535")
    for value in [options.public_base, *options.allow_origin]:
        if value is None:
            continue
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            parser.error("public-base and allow-origin must be exact HTTPS origins without a trailing slash")
    # Unique private cache; startup never traverses/removes arbitrary user directories.
    with tempfile.TemporaryDirectory(prefix="wave-audio-") as cache:
        resolver = Resolver(cache, js_runtime=options.js_runtime)
        server = AudioServer(("127.0.0.1", options.port), resolver, options.public_base, options.allow_origin)
        def cleanup():
            while not resolver.stopping.wait(30):
                resolver.cleanup()
        threading.Thread(target=cleanup, daemon=True).start()
        print(f"WAVE audio companion: http://127.0.0.1:{options.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            resolver.stopping.set()
            server.server_close()


if __name__ == "__main__":
    main()
