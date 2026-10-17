"""Protocol/process tests use a local fake downloader; no provider network calls."""
import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from audio_server import AudioServer, Resolver, ResolveError, canonical_url

FAKE = '''import json, pathlib, sys, time
folder = pathlib.Path(sys.argv[sys.argv.index('--output') + 1]).parent
url = sys.argv[-1]
if 'slowtrack11' in url: time.sleep(20)
if 'failure1111' in url: sys.exit(1)
(folder / 'audio.m4a').write_bytes(b'FAKE_AUDIO_BYTES')
(folder / 'audio.info.json').write_text(json.dumps({'title':'Test track', 'artist':'Test artist', 'duration':42, 'ext':'m4a'}))
'''


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        script = Path(self.temp.name) / "fake.py"
        script.write_text(FAKE)
        self.resolver = Resolver(Path(self.temp.name) / "cache", command=[sys.executable, str(script)], timeout=2)
        self.server = AudioServer(("127.0.0.1", 0), self.resolver)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.resolver.stopping.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=5)
        request_headers = {"Origin": "http://127.0.0.1:4180"}
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        request_headers.update(headers or {})
        connection.request(method, path, json.dumps(body) if body is not None else None, request_headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_download_and_fetch_actual_binary(self):
        status, headers, body = self.request("POST", "/resolve", {"url": "https://youtu.be/abcdefghijk"})
        self.assertEqual(status, 200, body)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4180")
        result = json.loads(body)
        self.assertEqual(result["title"], "Test track")
        self.assertEqual(result["mime"], "audio/mp4")
        status, headers, audio = self.request("GET", "/audio/" + result["audioUrl"].split("/")[-1])
        self.assertEqual(status, 200)
        self.assertEqual(audio, b"FAKE_AUDIO_BYTES")
        self.assertEqual(headers["Content-Type"], "audio/mp4")

    def test_untrusted_host_and_origin_rejected(self):
        for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"}, {"Host": "evil.example"}):
            status, _, _ = self.request("GET", "/health", headers=headers)
            self.assertEqual(status, 403)

    def test_explicit_proxy_host_and_origin_allowed(self):
        self.server.public_base = "https://audio.example.com"
        self.server.origins = self.server.origins | {"https://player.example.com"}
        status, headers, _ = self.request("GET", "/health", headers={"Host": "audio.example.com", "Origin": "https://player.example.com"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://player.example.com")

    def test_local_tools_without_origin_allowed(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1])
        connection.request("GET", "/health")
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.read()
        connection.close()

    def test_preflight_and_missing_token(self):
        status, headers, _ = self.request("OPTIONS", "/resolve")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(self.request("GET", "/audio/" + "a" * 32)[0], 404)

    def test_non_json_cannot_trigger_download(self):
        status, _, _ = self.request("POST", "/resolve", {"url": "https://youtu.be/abcdefghijk"}, {"Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_timeout_kills_child_and_removes_partial_files(self):
        self.resolver.timeout = 0.2
        status, _, _ = self.request("POST", "/resolve", {"url": "https://youtu.be/slowtrack11"})
        self.assertEqual(status, 504)
        self.assertEqual(list(self.resolver.cache.iterdir()), [])

    def test_provider_failure_and_invalid_input(self):
        self.assertEqual(self.request("POST", "/resolve", {"url": "https://youtu.be/failure1111"})[0], 422)
        self.assertEqual(self.request("POST", "/resolve", {"url": "http://localhost/secret"})[0], 400)

    def test_file_size_limit_checked_even_when_downloader_ignores_it(self):
        self.resolver.max_bytes = 5
        self.assertEqual(self.request("POST", "/resolve", {"url": "https://youtu.be/abcdefghijk"})[0], 422)
        self.assertEqual(list(self.resolver.cache.iterdir()), [])

    def test_concurrency_is_bounded(self):
        self.resolver.slots.acquire()
        self.resolver.slots.acquire()
        try:
            self.assertEqual(self.request("POST", "/resolve", {"url": "https://youtu.be/abcdefghijk"})[0], 429)
        finally:
            self.resolver.slots.release()
            self.resolver.slots.release()

    def test_expiry_removes_cached_file(self):
        self.resolver.ttl = -1
        token, entry = self.resolver.resolve("https://soundcloud.com/forss/flickermood")
        self.assertIsNone(self.resolver.get(token))
        self.assertFalse(entry.path.exists())

    def test_cancellation_removes_partial_download(self):
        with self.assertRaisesRegex(ResolveError, "cancelled"):
            self.resolver.resolve("https://youtu.be/slowtrack11", disconnected=lambda: True)
        self.assertEqual(list(self.resolver.cache.iterdir()), [])


class URLTests(unittest.TestCase):
    def test_canonicalizes_single_tracks(self):
        self.assertEqual(canonical_url("https://youtu.be/abcdefghijk?t=20"), "https://www.youtube.com/watch?v=abcdefghijk")
        self.assertEqual(canonical_url("https://m.soundcloud.com/forss/flickermood?utm_source=x"), "https://soundcloud.com/forss/flickermood")

    def test_rejects_other_hosts_private_urls_and_playlists(self):
        for url in ("http://youtube.com/watch?v=abcdefghijk", "https://youtube.com.evil.test/watch?v=abcdefghijk",
                    "https://youtube.com@evil.test/abc", "https://youtube.com:444/watch?v=abcdefghijk",
                    "https://youtube.com/playlist?list=abc", "https://soundcloud.com/forss/sets/abc",
                    "https://on.soundcloud.com/abc", "file:///C:/secret", "https://127.0.0.1/secret", None):
            with self.subTest(url=url), self.assertRaises(ResolveError):
                canonical_url(url)


if __name__ == "__main__":
    unittest.main()
