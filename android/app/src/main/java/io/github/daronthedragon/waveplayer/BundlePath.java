package io.github.daronthedragon.waveplayer;

/** Pure path validation, also exercised by the build's dependency-free Java test. */
final class BundlePath {
    private BundlePath() {}

    static String resolve(String decodedPath) {
        if (decodedPath == null || !decodedPath.startsWith("/wave-player/")) return null;
        String relative = decodedPath.substring("/wave-player/".length());
        if (relative.isEmpty()) return "index.html";
        // Reject decoded separators, secondary escaping, traversal and empty
        // segments. AssetManager only receives a canonical relative path.
        if (relative.indexOf('\\') >= 0 || relative.indexOf('%') >= 0) return null;
        for (int i = 0; i < relative.length(); i++) {
            if (relative.charAt(i) < 32 || relative.charAt(i) == 127) return null;
        }
        for (String segment : relative.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        if (relative.equals("index.html") || relative.equals("manifest.webmanifest")
                || relative.equals("sw.js") || relative.equals("LICENSE")
                || relative.startsWith("src/") || relative.startsWith("assets/")
                || relative.startsWith("vendor/")) return relative;
        return null;
    }
}
