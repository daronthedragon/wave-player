package io.github.daronthedragon.waveplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

/** Bundled player, retaining its original HTTPS storage origin across app updates. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://daronthedragon.github.io/wave-player/";
    private static final int PICK_MEDIA = 21;
    private FrameLayout root;
    private WebView player;
    private View errorPanel;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> fileCallback;
    private NativeAudio nativeAudio;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            // Android 15+ enforces edge-to-edge; keep controls out of system bars.
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        player = new WebView(this);
        player.setBackgroundColor(Color.BLACK);
        root.addView(player, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = player.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // System-picker content URIs only; no storage permission.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString() + " WAVEAndroid/1");
        CookieManager.getInstance().setAcceptThirdPartyCookies(player, true);
        nativeAudio = new NativeAudio(this);
        nativeAudio.attach(player);
        BundledPlayerAssets bundledAssets = new BundledPlayerAssets(getAssets());
        // Older APKs registered a service worker. Route its requests to the same
        // bundle until the web app unregisters it; never clear the user's data.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                WebResourceResponse audio = nativeAudio.intercept(request);
                if (audio != null) return audio;
                return bundledAssets.intercept(request);
            }
        });
        player.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse audio = nativeAudio.intercept(request);
                if (audio != null) return audio;
                return bundledAssets.intercept(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return !isHttps(uri);
                if (isPlayer(uri) && !isDownload(uri)) return false;
                if (isHttps(uri) && request.hasGesture()) openBrowser(uri);
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showError();
            }
        });
        player.setDownloadListener((url, userAgent, disposition, mime, length) -> openBrowser(Uri.parse(url)));
        player.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(picker, PICK_MEDIA); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker is available on this device.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view;
                fullscreenCallback = callback;
                player.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message message) {
                if (!userGesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        openBrowser(request.getUrl());
                        view.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(popup);
                message.sendToTarget();
                return true;
            }
        });
        player.loadUrl(initialUrl(getIntent()));
    }

    private static String initialUrl(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return HOME;
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (shared == null || shared.length() == 0) return HOME;
        // Shares are data in a fixed HTTPS destination, never executable URLs or JavaScript.
        String text = shared.toString();
        if (text.length() > 8192) text = text.substring(0, 8192);
        return Uri.parse(HOME).buildUpon().appendQueryParameter("share-text", text).build().toString();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        hideFullscreen();
        if (errorPanel != null) { root.removeView(errorPanel); errorPanel = null; }
        player.loadUrl(initialUrl(intent));
    }

    private static boolean isHttps(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
    }
    private static boolean isPlayer(Uri uri) {
        return isHttps(uri) && "daronthedragon.github.io".equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getPath() != null && uri.getPath().startsWith("/wave-player/");
    }
    private static boolean isDownload(Uri uri) {
        return uri.getPath() != null && uri.getPath().startsWith("/wave-player/downloads/");
    }
    private void openBrowser(Uri uri) {
        if (!isHttps(uri)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Install a browser to open this link.", Toast.LENGTH_LONG).show();
        }
    }
    private void showError() {
        if (errorPanel != null) return;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(40, 40, 40, 40);
        panel.setBackgroundColor(Color.rgb(15, 19, 25));
        TextView message = new TextView(this);
        message.setText("WAVE couldn’t open its bundled player.\n\nRetry or install the latest APK over this app. Keep app data to preserve your library. Imported files and saved audio can play offline. New YouTube and SoundCloud imports run on this phone and require an internet connection.");
        message.setTextColor(Color.WHITE);
        message.setTextSize(18);
        panel.addView(message);
        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setOnClickListener(view -> {
            root.removeView(errorPanel);
            errorPanel = null;
            player.loadUrl(initialUrl(getIntent()));
        });
        panel.addView(retry);
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel = panel;
    }
    private void hideFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        player.setVisibility(View.VISIBLE);
        fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_MEDIA || fileCallback == null) return;
        Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result, data);
        if (selected != null) {
            // Only expose content chosen through the OS picker, never arbitrary file:// paths.
            for (Uri uri : selected) {
                if (!"content".equals(uri.getScheme())) { selected = null; break; }
            }
        }
        fileCallback.onReceiveValue(selected);
        fileCallback = null;
    }
    private void handleBack() {
        if (fullscreen != null) hideFullscreen();
        else if (errorPanel != null) finish();
        else if (player.canGoBack()) player.goBack();
        else finish();
    }
    // API 33+ uses the registered OnBackInvokedDispatcher callback; this is the API 26–32 fallback.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() { player.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (player != null) player.onResume(); }
    @Override protected void onDestroy() {
        if (nativeAudio != null) nativeAudio.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        hideFullscreen();
        root.removeView(player);
        player.destroy();
        super.onDestroy();
    }
}
