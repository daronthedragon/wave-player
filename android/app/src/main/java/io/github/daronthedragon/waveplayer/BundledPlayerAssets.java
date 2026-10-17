package io.github.daronthedragon.waveplayer;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

/** Serves only packaged app files at the stable origin used by existing libraries. */
final class BundledPlayerAssets {
    private final AssetManager assets;

    BundledPlayerAssets(AssetManager assets) { this.assets = assets; }

    WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"daronthedragon.github.io".equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        String path = uri.getPath(); // Decode exactly once before validating path segments.
        if (path == null || !path.startsWith("/wave-player/")) return null;
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) {
            return error(405, "Method Not Allowed");
        }
        String relative = BundlePath.resolve(path);
        if (relative == null) return error(404, "Not Found");
        try {
            InputStream body = assets.open("wave/" + relative, AssetManager.ACCESS_STREAMING);
            if ("HEAD".equals(request.getMethod())) {
                body.close();
                body = new ByteArrayInputStream(new byte[0]);
            }
            String mime = mimeType(relative);
            boolean text = mime.startsWith("text/") || mime.equals("application/javascript")
                    || mime.equals("application/json") || mime.equals("application/manifest+json")
                    || mime.equals("image/svg+xml");
            return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"), body);
        } catch (IOException missing) {
            // Missing or rejected files never fall through to an unrelated hosted
            // version: every installed shell uses its own matching modules.
            return error(404, "Not Found");
        }
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private static String mimeType(String path) {
        String name = path.toLowerCase(Locale.ROOT);
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".webmanifest")) return "application/manifest+json";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".wasm")) return "application/wasm";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        if (name.endsWith(".ttf")) return "font/ttf";
        if (name.endsWith(".mp3")) return "audio/mpeg";
        if (name.endsWith(".mp4")) return "video/mp4";
        if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith("license")) return "text/plain";
        return "application/octet-stream";
    }
}
