package io.github.daronthedragon.waveplayer;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static androidx.test.platform.app.InstrumentationRegistry.getInstrumentation;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/** Offline device/emulator smoke: both packaged native runtimes must actually execute. */
@RunWith(AndroidJUnit4.class)
public final class NativeAudioRuntimeTest {
    @Test
    public void testPackagedExtractorReplacesOlderInstallAndKeepsMatchingPayload() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        File directory = Files.createTempDirectory(context.getCacheDir().toPath(), "extractor-upgrade-").toFile();
        File target = new File(directory, "yt-dlp");
        File media = new File(directory, "user-media-sentinel");
        try {
            Files.write(target.toPath(), "old extractor".getBytes(StandardCharsets.UTF_8));
            Files.write(media.toPath(), new byte[] { 4, 2 });
            try (InputStream payload = context.getResources().openRawResource(R.raw.ytdlp)) {
                assertTrue(PackagedExtractor.install(target, payload, PackagedExtractor.SHA256));
            }
            long fixedTime = 1_600_000_000_000L;
            assertTrue(target.setLastModified(fixedTime));
            try (InputStream payload = context.getResources().openRawResource(R.raw.ytdlp)) {
                assertFalse(PackagedExtractor.install(target, payload, PackagedExtractor.SHA256));
            }
            assertEquals("A matching extractor must not be rewritten", fixedTime, target.lastModified());
            assertEquals(2, Files.readAllBytes(media.toPath()).length);
            assertEquals("No migration temporary files left behind", 2, directory.list().length);
        } finally {
            for (File child : directory.listFiles()) Files.deleteIfExists(child.toPath());
            Files.deleteIfExists(directory.toPath());
        }
    }

    @Test
    public void testDamagedPackagedExtractorCannotReplaceExistingInstall() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        File directory = Files.createTempDirectory(context.getCacheDir().toPath(), "extractor-checksum-").toFile();
        File target = new File(directory, "yt-dlp");
        byte[] old = "existing extractor".getBytes(StandardCharsets.UTF_8);
        try {
            Files.write(target.toPath(), old);
            try (InputStream damaged = new ByteArrayInputStream(new byte[] { 1, 2, 3 })) {
                try {
                    PackagedExtractor.install(target, damaged, PackagedExtractor.SHA256);
                    fail("A damaged packaged extractor must be rejected");
                } catch (IOException expected) {
                    assertTrue(expected.getMessage().contains("checksum"));
                }
            }
            assertEquals(new String(old, StandardCharsets.UTF_8), new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8));
            assertEquals("Failed migration must remove its temporary file", 1, directory.list().length);
        } finally {
            for (File child : directory.listFiles()) Files.deleteIfExists(child.toPath());
            Files.deleteIfExists(directory.toPath());
        }
    }

    @Test
    public void testYouTubeVerificationMessagePreservesCancellationAndProviderScope() {
        String youtube = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
        Exception verification = new IllegalStateException("ERROR: [youtube] Sign in to confirm you’re not a bot.");
        assertEquals("YouTube requires verification on this connection, so WAVE cannot retrieve this track. Import an audio file instead.",
                NativeAudio.failureMessage(youtube, null, verification));
        assertEquals("Audio import cancelled.", NativeAudio.failureMessage(youtube, "Audio import cancelled.", verification));
        assertFalse(NativeAudio.failureMessage("https://soundcloud.com/forss/flickermood", null, verification).contains("YouTube"));
        assertFalse(NativeAudio.failureMessage(youtube, null, new IllegalStateException("HTTP 403")).contains("verification"));
    }

    @Test
    public void testDebugDiagnosticsRedactPrivateValues() {
        String diagnostic = NativeAudio.diagnostic(new IllegalStateException(
                "Sign in required https://cdn.example/audio?token=private-token token=private-token /data/app/private-path",
                new IllegalArgumentException("cookie=private-cookie ?signature=private-signature")));
        assertTrue(diagnostic.contains("Sign in required"));
        assertTrue(diagnostic.contains("IllegalArgumentException"));
        assertFalse(diagnostic.contains("cdn.example"));
        assertFalse(diagnostic.contains("private-"));
    }

    @Test
    public void testPackagedPythonAndExtractorLaunch() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        PackagedExtractor.initialize(context);
        YoutubeDLRequest request = new YoutubeDLRequest(Collections.emptyList());
        request.addOption("--version");
        YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, "runtime-smoke");
        assertEquals(0, response.getExitCode());
        assertEquals("Updated APK must execute its pinned extractor", PackagedExtractor.VERSION, response.getOut().trim());
    }

    @Test
    public void testPackagedQuickJsLaunch() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        PackagedExtractor.initialize(context);
        File quickJs = new File(context.getApplicationInfo().nativeLibraryDir, "libqjs.so");
        assertTrue("QuickJS must be extracted as an executable", quickJs.canExecute());
        Process process = new ProcessBuilder(quickJs.getAbsolutePath(), "--eval", "console.log(6 * 7)")
                .redirectErrorStream(true).start();
        if (!process.waitFor(15, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            fail("QuickJS did not exit");
        }
        byte[] output = new byte[1024];
        int length = process.getInputStream().read(output);
        String text = length > 0 ? new String(output, 0, length, StandardCharsets.UTF_8).trim() : "";
        assertEquals("QuickJS execution failed: " + text, 0, process.exitValue());
        assertEquals("42", text);
    }
}
