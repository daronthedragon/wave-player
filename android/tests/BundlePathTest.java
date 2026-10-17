package io.github.daronthedragon.waveplayer;

/** Dependency-free contract tests for the boundary between HTTPS and APK files. */
public final class BundlePathTest {
    public static void main(String[] args) {
        expect("/wave-player/", "index.html");
        expect("/wave-player/index.html", "index.html");
        expect("/wave-player/src/main.js", "src/main.js");
        expect("/wave-player/vendor/ffmpeg/ffmpeg-core.wasm", "vendor/ffmpeg/ffmpeg-core.wasm");
        expect("/wave-player/assets/ps3/xmb_icon_001.png", "assets/ps3/xmb_icon_001.png");
        expect("/wave-player/sw.js", "sw.js");
        for (String invalid : new String[] {null, "/other/index.html", "/wave-player-evil/index.html",
                "/wave-player/src/../index.html", "/wave-player/src/./main.js", "/wave-player/src//main.js",
                "/wave-player/src/", "/wave-player/src\\main.js", "/wave-player/src/%2e%2e/main.js",
                "/wave-player/src/\u0000main.js", "/wave-player/downloads/WAVE-Player.html",
                "/wave-player/server/config.json", "/wave-player/.env", "/wave-player/.tmp/key.jks"}) {
            expect(invalid, null);
        }
        System.out.println("Bundled asset path boundaries passed (21 cases).");
    }
    private static void expect(String path, String expected) {
        String actual = BundlePath.resolve(path);
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Unexpected asset path for " + path + ": " + actual);
        }
    }
}
