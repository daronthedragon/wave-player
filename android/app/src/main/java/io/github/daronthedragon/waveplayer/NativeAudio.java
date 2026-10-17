package io.github.daronthedragon.waveplayer;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** On-device extractor, exposed only to the main frame of WAVE's packaged player. */
final class NativeAudio implements AutoCloseable {
    private static final String ORIGIN = "https://daronthedragon.github.io";
    private static final String AUDIO_PATH = "/wave-player/__native_audio/";
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final long MAX_METADATA = 4L * 1024 * 1024;
    private static final long DEADLINE_MS = 180_000;
    private static final Map<String, String> MIMES = new HashMap<>();
    static {
        MIMES.put("m4a", "audio/mp4");
        MIMES.put("mp3", "audio/mpeg");
        MIMES.put("webm", "audio/webm");
        MIMES.put("ogg", "audio/ogg");
        MIMES.put("opus", "audio/ogg");
    }
    private final Context context;
    private final File cache;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final AtomicReference<Job> active = new AtomicReference<>();
    private final Map<String, Saved> downloads = new ConcurrentHashMap<>();
    private volatile boolean closed;

    NativeAudio(Context context) {
        this.context = context.getApplicationContext();
        cache = new File(context.getCacheDir(), "wave-online");
        // This directory contains only disposable imports. IndexedDB is never touched.
        worker.execute(() -> {
            delete(cache);
            cache.mkdirs();
        });
        timer.scheduleAtFixedRate(this::expireDownloads, 1, 1, TimeUnit.MINUTES);
    }

    void attach(WebView view) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(view, "WaveNativeAudio", java.util.Collections.singleton(ORIGIN),
                (webView, message, sourceOrigin, isMainFrame, reply) -> {
                    if (closed || !isMainFrame || !trustedOrigin(sourceOrigin) || !trustedPage(webView.getUrl())) return;
                    String raw = message.getData();
                    if (raw == null || raw.length() > 8192) return;
                    String id = "";
                    try {
                        JSONObject request = new JSONObject(raw);
                        id = request.optString("id");
                        if (!AudioLink.validRequestId(id)) return;
                        String action = request.optString("action");
                        if (action.equals("cancel")) {
                            Job job = active.get();
                            if (job != null && job.id.equals(id)) job.stopReason = "Audio import cancelled.";
                            for (Map.Entry<String, Saved> item : downloads.entrySet()) {
                                if (item.getValue().requestId.equals(id) && downloads.remove(item.getKey(), item.getValue())) delete(item.getValue().folder);
                            }
                            return;
                        }
                        if (!action.equals("import")) { failure(reply, id, "Unknown audio request."); return; }
                        String url = AudioLink.canonical(request.optString("url"));
                        if (url == null) { failure(reply, id, "Use one public YouTube video or SoundCloud track link."); return; }
                        if (downloads.size() >= 2) { failure(reply, id, "Finish saving the previous audio, then try again in a moment."); return; }
                        Job job = new Job(id, url, reply);
                        if (!active.compareAndSet(null, job)) { failure(reply, id, "Another audio import is still running."); return; }
                        worker.execute(() -> run(job));
                    } catch (Exception invalid) {
                        if (AudioLink.validRequestId(id)) failure(reply, id, "That audio request could not be read.");
                    }
                });
    }

    private void run(Job job) {
        ScheduledFuture<?> watch = timer.scheduleAtFixedRate(() -> {
            if (SystemClock.elapsedRealtime() - job.started > DEADLINE_MS) job.stopReason = "Audio import timed out. Try again on a stronger connection.";
            if (size(job.folder) > MAX_BYTES + MAX_METADATA) job.stopReason = "This audio exceeds the 64 MiB import limit.";
            if (job.stopReason != null) {
                try { YoutubeDL.getInstance().destroyProcessById(job.processId); }
                catch (RuntimeException processExited) { /* A concurrent process exit must not disable the watchdog. */ }
            }
        }, 250, 250, TimeUnit.MILLISECONDS);
        boolean keep = false;
        try {
            if (!job.folder.mkdirs()) throw new IOException("Cannot create import directory");
            PackagedExtractor.initialize(context);
            check(job);
            YoutubeDLRequest request = new YoutubeDLRequest(job.url);
            for (String flag : new String[] {"--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir",
                    "--no-progress", "--no-warnings", "--no-check-formats", "--no-allow-unplayable-formats",
                    "--write-info-json", "--no-write-playlist-metafiles", "--no-simulate"}) request.addOption(flag);
            request.addOption("--socket-timeout", "15");
            request.addOption("--retries", "1");
            request.addOption("--fragment-retries", "1");
            request.addOption("--concurrent-fragments", "1");
            request.addOption("--max-filesize", Long.toString(MAX_BYTES));
            request.addOption("--downloader", "m3u8:native");
            request.addOption("--fixup", "never");
            request.addOption("--match-filter", "duration <= 7200 & !is_live");
            request.addOption("--format", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=webm]/bestaudio[ext=ogg]/bestaudio[ext=opus]");
            request.addOption("--output", new File(job.folder, "audio.%(ext)s").getAbsolutePath());
            YoutubeDL.getInstance().execute(request, job.processId);
            check(job);
            File metadata = new File(job.folder, "audio.info.json");
            if (!metadata.isFile() || metadata.length() > MAX_METADATA) throw new IOException("Missing metadata");
            JSONObject info = new JSONObject(new String(Files.readAllBytes(metadata.toPath()), StandardCharsets.UTF_8));
            String ext = info.optString("ext");
            if (!MIMES.containsKey(ext) || info.optBoolean("is_live") || info.optDouble("duration", -1) > 7200) {
                throw new IOException("Unsupported audio");
            }
            File audio = new File(job.folder, "audio." + ext);
            if (!audio.isFile() || audio.length() == 0 || audio.length() > MAX_BYTES) throw new IOException("Invalid audio size");
            // Signed CDN URLs and provider metadata are not retained or sent to JavaScript.
            metadata.delete();
            String token = UUID.randomUUID().toString().replace("-", "");
            String title = clean(info.optString("title", "Online audio"));
            String artist = clean(info.optString("artist", info.optString("uploader", "")));
            Saved saved = new Saved(job.id, job.folder, audio, MIMES.get(ext));
            downloads.put(token, saved);
            keep = true;
            JSONObject response = new JSONObject();
            response.put("id", job.id).put("ok", true).put("title", title).put("artist", artist)
                    .put("fileName", title.replaceAll("[\\\\/:*?\"<>|]", "_") + "." + ext)
                    .put("mime", saved.mime).put("audioUrl", ORIGIN + AUDIO_PATH + token);
            send(job.reply, response);
        } catch (Exception error) {
            if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                // Debug/emulator diagnostics only. Never log raw URLs, signed
                // CDN queries, cookies, or credentials into a public CI report.
                Log.w("WAVENativeAudio", diagnostic(error));
            }
            failure(job.reply, job.id, failureMessage(job.url, job.stopReason, error));
        } finally {
            watch.cancel(false);
            if (!keep) delete(job.folder);
            active.compareAndSet(job, null);
        }
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!trustedOrigin(uri) || uri.getPath() == null || !uri.getPath().startsWith(AUDIO_PATH)) return null;
        String token = uri.getPath().substring(AUDIO_PATH.length());
        if (!"GET".equals(request.getMethod()) || request.isForMainFrame() || uri.getQuery() != null
                || !token.matches("[a-f0-9]{32}")) return unavailable();
        Saved saved = downloads.remove(token); // One-use capability, never an arbitrary file path or network proxy.
        if (saved == null) return unavailable();
        try {
            FilterInputStream body = new FilterInputStream(new FileInputStream(saved.file)) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { delete(saved.folder); }
                }
            };
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(saved.file.length()));
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(saved.mime, null, 200, "OK", headers, body);
        } catch (IOException missing) { delete(saved.folder); return unavailable(); }
    }

    private void check(Job job) throws IOException {
        if (closed || job.stopReason != null) throw new IOException("Cancelled");
    }
    private static String clean(String value) {
        String text = value.replaceAll("[\\p{Cntrl}]", "").trim();
        return text.substring(0, Math.min(text.length(), 160));
    }
    static String failureMessage(String canonicalUrl, String stopReason, Throwable error) {
        if (stopReason != null) return stopReason;
        if (canonicalUrl != null && canonicalUrl.startsWith("https://www.youtube.com/watch?v=")) {
            for (int depth = 0; error != null && depth < 3; depth++, error = error.getCause()) {
                String message = String.valueOf(error.getMessage()).toLowerCase(Locale.ROOT);
                if (message.contains("sign in to confirm") && message.contains("not a bot")) {
                    return "YouTube requires verification on this connection, so WAVE cannot retrieve this track. Import an audio file instead.";
                }
            }
        }
        return "This public track could not be retrieved on your device. Check the link and connection, or import the audio file. Private, live, restricted, or unavailable tracks are not supported.";
    }
    static String diagnostic(Throwable error) {
        StringBuilder result = new StringBuilder();
        for (int depth = 0; error != null && depth < 3; depth++, error = error.getCause()) {
            if (depth > 0) result.append("; caused by ");
            String message = String.valueOf(error.getMessage())
                    .replaceAll("(?i)https?://[^\\s]+", "[URL]")
                    .replaceAll("\\?[^\\s]+", "[QUERY]")
                    .replaceAll("/data/[^\\s]+", "[APP_PATH]")
                    .replaceAll("(?i)(authorization|cookie|token|signature|password|secret)\\s*[:=]\\s*[^\\s]+", "$1=[REDACTED]")
                    .replaceAll("[\\p{Cntrl}]", " ");
            result.append(error.getClass().getSimpleName()).append(": ")
                    .append(message, 0, Math.min(message.length(), 1200));
        }
        return result.toString();
    }
    private void failure(JavaScriptReplyProxy reply, String id, String reason) {
        try { send(reply, new JSONObject().put("id", id).put("ok", false).put("error", reason)); }
        catch (org.json.JSONException ignored) { }
    }
    private void send(JavaScriptReplyProxy reply, JSONObject response) {
        main.post(() -> {
            if (!closed) {
                try { reply.postMessage(response.toString()); }
                catch (IllegalStateException navigatedAway) { /* Temporary file expires automatically. */ }
            }
        });
    }
    private static boolean trustedOrigin(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && "daronthedragon.github.io".equalsIgnoreCase(uri.getHost()) && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private static boolean trustedPage(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return trustedOrigin(uri) && ("/wave-player/".equals(uri.getPath()) || "/wave-player/index.html".equals(uri.getPath()));
    }
    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                java.util.Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }
    private static long size(File file) {
        if (file.isFile()) return file.length();
        File[] children = file.listFiles();
        long total = 0;
        if (children != null) for (File child : children) total += size(child);
        return total;
    }
    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }
    private void expireDownloads() {
        long now = SystemClock.elapsedRealtime();
        for (Map.Entry<String, Saved> item : downloads.entrySet()) {
            if (now - item.getValue().created > 120_000 && downloads.remove(item.getKey(), item.getValue())) delete(item.getValue().folder);
        }
    }
    @Override public void close() {
        closed = true;
        Job job = active.get();
        if (job != null) job.stopReason = "Audio import cancelled.";
        worker.execute(() -> {
            for (Saved saved : downloads.values()) delete(saved.folder);
            downloads.clear();
            timer.shutdown();
        });
        worker.shutdown();
    }
    private final class Job {
        final String id, url, processId = UUID.randomUUID().toString();
        final JavaScriptReplyProxy reply;
        final File folder = new File(cache, UUID.randomUUID().toString());
        final long started = SystemClock.elapsedRealtime();
        volatile String stopReason;
        Job(String id, String url, JavaScriptReplyProxy reply) { this.id = id; this.url = url; this.reply = reply; }
    }
    private static final class Saved {
        final File folder, file;
        final String requestId, mime;
        final long created = SystemClock.elapsedRealtime();
        Saved(String requestId, File folder, File file, String mime) {
            this.requestId = requestId; this.folder = folder; this.file = file; this.mime = mime;
        }
    }
}
