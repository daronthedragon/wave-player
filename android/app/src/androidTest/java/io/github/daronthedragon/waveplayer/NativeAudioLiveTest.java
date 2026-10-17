package io.github.daronthedragon.waveplayer;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.test.InstrumentationTestCase;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Optional real-provider check: bundled JS -> scoped native listener -> provider -> File. */
@SuppressWarnings("deprecation")
public final class NativeAudioLiveTest extends InstrumentationTestCase {
    public void testSoundCloudThroughBundledPlayer() throws Exception {
        if (WaveTestRunner.liveAudio) importTrack("https://soundcloud.com/forss/flickermood");
    }
    public void testYouTubeThroughBundledPlayer() throws Exception {
        if (WaveTestRunner.liveAudio) importTrack("https://www.youtube.com/watch?v=M7lc1UVf-VE");
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
            evaluate(view, "window.__waveLiveResult={pending:true}; import('./src/direct-audio.js').then(m => m.fetchNativeAudioFile({url:"
                    + JSONObject.quote(url) + ",title:'Runtime test'})).then(f => { window.__waveLiveResult={size:f.size,type:f.type,name:f.name}; })"
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
