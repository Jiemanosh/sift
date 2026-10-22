package com.qodercn.sift;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int MATCH = LinearLayout.LayoutParams.MATCH_PARENT;
    private static final int WRAP = LinearLayout.LayoutParams.WRAP_CONTENT;

    private Prefs prefs;
    private WebView webView;
    private FrameLayout overlay;
    private boolean connecting;
    private boolean pageFailed;
    private boolean reconnectShown;
    private String baseUrl;
    private String accessCode;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.applySystemBars(this);
        prefs = new Prefs(this);
        if (!loadCredentials()) {
            openSetup();
            return;
        }
        buildUi();
        connect();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!loadCredentials()) {
            openSetup();
            return;
        }
        if (webView != null) {
            reconnectShown = false;
            connect();
        }
    }

    private boolean loadCredentials() {
        baseUrl = prefs.serverUrl();
        accessCode = prefs.accessCode();
        return baseUrl != null && !baseUrl.isEmpty() && accessCode != null && !accessCode.isEmpty();
    }

    private void openSetup() {
        Intent setup = new Intent(this, SetupActivity.class);
        setup.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(setup);
        finish();
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.PAPER);

        webView = new WebView(this);
        webView.setBackgroundColor(Ui.PAPER);
        webView.setVisibility(View.INVISIBLE);
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(MATCH, MATCH));

        overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Ui.PAPER);
        root.addView(overlay, new FrameLayout.LayoutParams(MATCH, MATCH));

        setContentView(root);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " SiftAndroid/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, false);

        view.addJavascriptInterface(new Bridge(), "SiftApp");
        view.setWebViewClient(new Client());
    }

    private void connect() {
        if (connecting) return;
        connecting = true;
        pageFailed = false;
        showBusy("正在连接电脑…");
        webView.setVisibility(View.INVISIBLE);

        final String targetUrl = baseUrl;
        final String targetCode = accessCode;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final SiftHttp.Result result = SiftHttp.login(targetUrl, targetCode);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        connecting = false;
                        finishConnect(targetUrl, result);
                    }
                });
            }
        }).start();
    }

    private void finishConnect(String targetUrl, SiftHttp.Result result) {
        if (result.ok) {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setCookie(targetUrl + "/", result.cookie + "; Path=/");
            cookies.flush();
            showBusy("正在打开筛…");
            webView.loadUrl(targetUrl + "/");
            return;
        }
        if (result.status == 401) {
            showError("访问码已失效",
                "这台手机还没有连上电脑。请在电脑上打开筛，点「账号与来源 → 手机 App」重新扫码，或输入新的访问码。",
                "重新连接", this::openSetup,
                "重试", this::connect);
            return;
        }
        showError("连不上这台电脑",
            result.error,
            "重试", this::connect,
            "修改连接", this::openSetup);
    }

    private void showBusy(String message) {
        overlay.removeAllViews();
        overlay.setVisibility(View.VISIBLE);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        column.setPadding(Ui.dp(this, 32), Ui.dp(this, 32), Ui.dp(this, 32), Ui.dp(this, 32));

        TextView seal = Ui.text(this, "筛", 26, Ui.PAPER_2, true);
        seal.setGravity(Gravity.CENTER);
        seal.setBackground(Ui.rounded(Ui.ACCENT, 0, Ui.ACCENT, 0));
        LinearLayout.LayoutParams sealParams = new LinearLayout.LayoutParams(Ui.dp(this, 56), Ui.dp(this, 56));
        column.addView(seal, sealParams);

        TextView title = Ui.title(this, "SIFT", 20);
        title.setLetterSpacing(0.18f);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(WRAP, WRAP);
        titleParams.topMargin = Ui.dp(this, 16);
        column.addView(title, titleParams);

        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleSmall);
        progress.getIndeterminateDrawable().setColorFilter(Ui.ACCENT, android.graphics.PorterDuff.Mode.SRC_IN);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(Ui.dp(this, 22), Ui.dp(this, 22));
        progressParams.topMargin = Ui.dp(this, 24);
        column.addView(progress, progressParams);

        TextView label = Ui.text(this, message, 12, Ui.MUTED, false);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(WRAP, WRAP);
        labelParams.topMargin = Ui.dp(this, 12);
        column.addView(label, labelParams);

        FrameLayout.LayoutParams columnParams = new FrameLayout.LayoutParams(MATCH, WRAP);
        columnParams.gravity = Gravity.CENTER;
        overlay.addView(column, columnParams);
    }

    private void showError(String titleText, String message, String primaryLabel, Runnable primary,
                           String secondaryLabel, Runnable secondary) {
        overlay.removeAllViews();
        overlay.setVisibility(View.VISIBLE);
        webView.setVisibility(View.INVISIBLE);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(Ui.dp(this, 26), Ui.dp(this, 26), Ui.dp(this, 26), Ui.dp(this, 26));

        TextView seal = Ui.text(this, "筛", 24, Ui.PAPER_2, true);
        seal.setGravity(Gravity.CENTER);
        seal.setBackground(Ui.rounded(Ui.ACCENT, 0, Ui.ACCENT, 0));
        column.addView(seal, new LinearLayout.LayoutParams(Ui.dp(this, 50), Ui.dp(this, 50)));

        TextView title = Ui.title(this, titleText, 22);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(MATCH, WRAP);
        titleParams.topMargin = Ui.dp(this, 20);
        column.addView(title, titleParams);

        TextView body = Ui.text(this, message, 12.5f, Ui.INK_SOFT, false);
        body.setLineSpacing(0, 1.5f);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(MATCH, WRAP);
        bodyParams.topMargin = Ui.dp(this, 10);
        column.addView(body, bodyParams);

        android.widget.Button primaryButton = Ui.button(this, primaryLabel, true);
        primaryButton.setOnClickListener(view -> primary.run());
        LinearLayout.LayoutParams primaryParams = new LinearLayout.LayoutParams(MATCH, WRAP);
        primaryParams.topMargin = Ui.dp(this, 22);
        column.addView(primaryButton, primaryParams);

        if (secondary != null) {
            android.widget.Button secondaryButton = Ui.button(this, secondaryLabel, false);
            secondaryButton.setOnClickListener(view -> secondary.run());
            LinearLayout.LayoutParams secondaryParams = new LinearLayout.LayoutParams(MATCH, WRAP);
            secondaryParams.topMargin = Ui.dp(this, 10);
            column.addView(secondaryButton, secondaryParams);
        }

        FrameLayout.LayoutParams columnParams = new FrameLayout.LayoutParams(MATCH, WRAP);
        columnParams.gravity = Gravity.CENTER;
        overlay.addView(column, columnParams);
    }

    private void revealWebView() {
        overlay.removeAllViews();
        overlay.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private boolean isAppUrl(Uri uri) {
        if (uri == null) return false;
        Uri base = Uri.parse(baseUrl);
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) return false;
        return scheme.equalsIgnoreCase(base.getScheme())
            && uri.getHost() != null
            && uri.getHost().equalsIgnoreCase(base.getHost())
            && uri.getPort() == base.getPort();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "这台手机上还没有能打开此链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppUrl(uri)) return false;
            String scheme = uri.getScheme();
            if (scheme != null) {
                String lower = scheme.toLowerCase();
                if (lower.equals("http") || lower.equals("https") || lower.equals("mailto") || lower.equals("tel")) {
                    openExternal(uri);
                }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!pageFailed && url != null && url.startsWith(baseUrl)) {
                revealWebView();
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            pageFailed = true;
            String detail = error.getDescription() == null ? "" : String.valueOf(error.getDescription());
            showError("页面没有打开",
                "手机和电脑可能不在同一个 Wi-Fi，或者电脑上的筛没有运行。" + (detail.isEmpty() ? "" : "\n\n" + detail),
                "重试", MainActivity.this::connect,
                "修改连接", MainActivity.this::openSetup);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (!request.isForMainFrame()) return;
            pageFailed = true;
            if (response.getStatusCode() == 401) {
                showError("访问码已失效",
                    "这台手机和电脑的连接已经断开。请回到电脑上重新获取访问码。",
                    "重新连接", MainActivity.this::openSetup,
                    "重试", MainActivity.this::connect);
                return;
            }
            showError("页面没有打开",
                "电脑返回了 HTTP " + response.getStatusCode() + "，请稍后再试。",
                "重试", MainActivity.this::connect,
                "修改连接", MainActivity.this::openSetup);
        }
    }

    private final class Bridge {
        @JavascriptInterface
        public void connectRequired() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (reconnectShown || isFinishing() || isDestroyed()) return;
                    reconnectShown = true;
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("连接已失效")
                        .setMessage("请回到电脑上，在「账号与来源 → 手机 App」里重新获取访问码。")
                        .setPositiveButton("重新连接", (dialog, which) -> openSetup())
                        .setNegativeButton("取消", (dialog, which) -> reconnectShown = false)
                        .show();
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.removeJavascriptInterface("SiftApp");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
