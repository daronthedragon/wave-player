package io.github.daronthedragon.waveplayer;

import android.content.Context;
import android.test.InstrumentationTestCase;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

/** Offline device/emulator smoke: both packaged native runtimes must actually execute. */
@SuppressWarnings("deprecation")
public final class NativeAudioRuntimeTest extends InstrumentationTestCase {
    public void testPackagedPythonAndExtractorLaunch() throws Exception {
        Context context = getInstrumentation().getTargetContext();
        YoutubeDL.getInstance().init(context);
        YoutubeDLRequest request = new YoutubeDLRequest(Collections.emptyList());
        request.addOption("--version");
        YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, "runtime-smoke");
        assertEquals(0, response.getExitCode());
        assertTrue("Bundled yt-dlp must report its version", response.getOut().trim().matches("[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}.*"));
    }

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
