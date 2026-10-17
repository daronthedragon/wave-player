package io.github.daronthedragon.waveplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Debug-only importer fixture: actual native bridge and bundled JS, without the decorative renderer. */
public final class NativeAudioTestActivity extends Activity {
    private WebView webView;
    private NativeAudio nativeAudio;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        nativeAudio = new NativeAudio(this);
        nativeAudio.attach(webView);
        BundledPlayerAssets assets = new BundledPlayerAssets(getAssets());
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse audio = nativeAudio.intercept(request);
                return audio != null ? audio : assets.intercept(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        setContentView(webView);
        // The fixture supplies only a document. Tests import direct-audio.js from
        // the real APK assets and use the real restricted native listener.
        webView.loadDataWithBaseURL("https://daronthedragon.github.io/wave-player/",
                "<!doctype html><meta charset='utf-8'><title>WAVE native importer test</title><p>Native importer verification</p>",
                "text/html", "UTF-8", "https://daronthedragon.github.io/wave-player/");
    }

    @Override protected void onDestroy() {
        if (nativeAudio != null) nativeAudio.close();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
