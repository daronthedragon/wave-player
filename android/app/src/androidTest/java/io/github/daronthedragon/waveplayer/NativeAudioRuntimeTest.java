package io.github.daronthedragon.waveplayer;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
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
        YoutubeDL.getInstance().init(context);
        YoutubeDLRequest request = new YoutubeDLRequest(Collections.emptyList());
        request.addOption("--version");
        YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, "runtime-smoke");
        assertEquals(0, response.getExitCode());
        assertTrue("Bundled yt-dlp must report its version", response.getOut().trim().matches("[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}.*"));
    }

    @Test
    public void testPackagedQuickJsLaunch() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        YoutubeDL.getInstance().init(context);
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
