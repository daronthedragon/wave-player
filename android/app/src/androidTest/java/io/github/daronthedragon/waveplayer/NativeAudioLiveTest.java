package io.github.daronthedragon.waveplayer;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static androidx.test.platform.app.InstrumentationRegistry.getInstrumentation;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

/** Optional real-provider check: bundled JS -> native listener -> provider -> playable media File. */
@RunWith(AndroidJUnit4.class)
public final class NativeAudioLiveTest {
    @Test
    public void testSoundCloudThroughBundledPlayer() throws Exception {
        assumeTrue("Enable waveLiveAudio to run provider network checks", WaveTestRunner.liveAudio);
        importTrack("https://soundcloud.com/forss/flickermood");
    }
    @Test
    public void testYouTubeThroughBundledPlayer() throws Exception {
        assumeTrue("Enable waveLiveAudio to run provider network checks", WaveTestRunner.liveAudio);
        importTrack("https://www.youtube.com/watch?v=M7lc1UVf-VE");
    }
    private void importTrack(String url) throws Exception {
        Intent launch = new Intent(getInstrumentation().getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = getInstrumentation().startActivitySync(launch);
        try {
            AtomicReference<WebView> found = new AtomicReference<>();
            getInstrumentation().runOnMainSync(() -> found.set(findWebView(activity.getWindow().getDecorView())));
            WebView view = found.get();
            assertNotNull("Bundled WebView must exist", view);
            long readyDeadline = SystemClock.elapsedRealtime() + 30_000;
            while (!"true".equals(evaluate(view, "typeof WaveNativeAudio === 'object' && typeof WaveNativeAudio.postMessage === 'function'"))) {
                assertTrue("Native listener did not initialize", SystemClock.elapsedRealtime() < readyDeadline);
                SystemClock.sleep(100);
            }
            // This test covers media import and decoding, not visual rendering.
            // The CI emulator uses a software GPU; stop the decorative canvas
            // animation so it cannot starve extraction or crash that GPU backend.
            evaluate(view, "window.requestAnimationFrame=() => 0; document.querySelectorAll('canvas').forEach(c => c.style.display='none'); true;");
            evaluate(view, "window.__waveLiveResult={pending:true}; import('https://daronthedragon.github.io/wave-player/src/direct-audio.js').then(m => m.fetchNativeAudioFile({url:"
                    + JSONObject.quote(url) + ",title:'Runtime test'})).then(f => new Promise((resolve,reject) => {"
                    + "const audio=new Audio(), objectUrl=URL.createObjectURL(f); let settled=false;"
                    + "const finish=(error) => { if(settled)return; settled=true; clearTimeout(timeout);"
                    + "const duration=audio.duration; audio.onloadedmetadata=null; audio.onerror=null;"
                    + "audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(objectUrl);"
                    + "if(error)reject(error); else if(!Number.isFinite(duration)||duration<=0)reject(new Error('Audio metadata has no finite positive duration'));"
                    + "else resolve({size:f.size,type:f.type,name:f.name,duration}); };"
                    + "const timeout=setTimeout(() => finish(new Error('Audio metadata did not load within 15 seconds')),15000);"
                    + "audio.preload='metadata'; audio.onloadedmetadata=() => finish();"
                    + "audio.onerror=() => finish(new Error('Downloaded audio cannot be decoded (media error '+(audio.error?.code||0)+')'));"
                    + "audio.src=objectUrl; audio.load();"
                    + "})).then(result => { window.__waveLiveResult=result; })"
                    + ".catch(e => { window.__waveLiveResult={error:e.message}; }); true;");
            long deadline = SystemClock.elapsedRealtime() + 210_000;
            JSONObject result;
            do {
                result = new JSONObject(evaluate(view, "window.__waveLiveResult"));
                if (!result.optBoolean("pending")) break;
                assertTrue("Native import did not complete", SystemClock.elapsedRealtime() < deadline);
                SystemClock.sleep(500);
            } while (true);
            assertFalse("Provider refused import: " + result.optString("error"), result.has("error"));
            assertTrue("Audio bytes must reach JavaScript", result.optLong("size") > 1000);
            assertTrue("Audio import must be bounded", result.optLong("size") <= 64L * 1024 * 1024);
            assertTrue("A supported audio type must be returned", result.optString("type").startsWith("audio/"));
            double duration = result.optDouble("duration", Double.NaN);
            assertTrue("WebView must parse a finite positive media duration", Double.isFinite(duration) && duration > 0);
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }
    private String evaluate(WebView view, String script) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> { result.set(value); ready.countDown(); }));
        assertTrue("WebView evaluation timed out", ready.await(15, TimeUnit.SECONDS));
        return result.get();
    }
    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                WebView found = findWebView(group.getChildAt(index));
                if (found != null) return found;
            }
        }
        return null;
    }
}
