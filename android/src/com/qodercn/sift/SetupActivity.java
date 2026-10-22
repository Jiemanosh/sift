package com.qodercn.sift;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.PorterDuff;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputFilter;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.URI;

public class SetupActivity extends Activity {
    private static final int MATCH = LinearLayout.LayoutParams.MATCH_PARENT;
    private static final int WRAP = LinearLayout.LayoutParams.WRAP_CONTENT;

    private Prefs prefs;
    private EditText urlInput;
    private EditText codeInput;
    private Button connectButton;
    private ProgressBar progress;
    private TextView statusView;
    private boolean connecting;
    private boolean autoConnect;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.applySystemBars(this);
        prefs = new Prefs(this);
        buildUi();

        boolean paired = applyPairIntent(getIntent());
        if (!paired) {
            urlInput.setText(prefs.serverUrl());
            codeInput.setText(prefs.accessCode());
        }
        if (autoConnect) {
            urlInput.post(new Runnable() {
                @Override
                public void run() {
                    attemptConnect();
                }
            });
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyPairIntent(intent);
        if (autoConnect) {
            autoConnect = false;
            urlInput.post(new Runnable() {
                @Override
                public void run() {
                    attemptConnect();
                }
            });
        }
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Ui.PAPER);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(Ui.dp(this, 26), Ui.dp(this, 30), Ui.dp(this, 26), Ui.dp(this, 34));
        scroll.addView(root, new ScrollView.LayoutParams(MATCH, WRAP));
        setContentView(scroll);

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.HORIZONTAL);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        TextView seal = Ui.text(this, "筛", 26, Ui.PAPER_2, true);
        seal.setGravity(Gravity.CENTER);
        seal.setBackground(Ui.rounded(Ui.ACCENT, 0, Ui.ACCENT, 0));
        LinearLayout.LayoutParams sealParams = new LinearLayout.LayoutParams(Ui.dp(this, 48), Ui.dp(this, 48));
        brand.addView(seal, sealParams);

        LinearLayout brandCopy = new LinearLayout(this);
        brandCopy.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams brandCopyParams = new LinearLayout.LayoutParams(WRAP, WRAP);
        brandCopyParams.leftMargin = Ui.dp(this, 12);
        TextView brandName = Ui.title(this, "SIFT", 20);
        brandName.setLetterSpacing(0.16f);
        brandCopy.addView(brandName);
        brandCopy.addView(Ui.text(this, "只看你关注的人", 11, Ui.MUTED, false));
        brand.addView(brandCopy, brandCopyParams);
        root.addView(brand, new LinearLayout.LayoutParams(MATCH, WRAP));

        TextView title = Ui.title(this, "在手机上打开筛", 28);
        addWithTop(root, title, 24);
        TextView lead = Ui.text(this, "手机只读。B站 / 知乎 的登录和同步仍然在电脑上完成。", 13, Ui.INK_SOFT, false);
        addWithTop(root, lead, 8);

        LinearLayout guide = Ui.card(this);
        addWithTop(root, guide, 22);
        guide.addView(stepRow("1", "电脑上打开筛，点「账号与来源 → 手机 App」"));
        guide.addView(stepRow("2", "让手机和电脑连上同一个 Wi-Fi"));
        guide.addView(stepRow("3", "扫码会自动填入；也可以手动输入下面的地址和访问码"));

        root.addView(fieldLabel("电脑地址"));
        urlInput = Ui.urlField(this, "http://192.168.1.7:8787");
        urlInput.setFilters(new InputFilter[] { new InputFilter.LengthFilter(200) });
        urlInput.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        addWithTop(root, urlInput, 7);

        root.addView(fieldLabel("访问码"));
        codeInput = Ui.codeField(this, "ABCD-EFGH");
        codeInput.setFilters(new InputFilter[] { new InputFilter.LengthFilter(12) });
        codeInput.setImeOptions(EditorInfo.IME_ACTION_DONE);
        codeInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                attemptConnect();
                return true;
            }
            return false;
        });
        addWithTop(root, codeInput, 7);

        connectButton = Ui.button(this, "连接", true);
        connectButton.setOnClickListener(view -> attemptConnect());
        addWithTop(root, connectButton, 22);

        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER_VERTICAL);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleSmall);
        progress.getIndeterminateDrawable().setColorFilter(Ui.ACCENT, PorterDuff.Mode.SRC_IN);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(Ui.dp(this, 18), Ui.dp(this, 18));
        progressParams.rightMargin = Ui.dp(this, 8);
        statusRow.addView(progress, progressParams);
        statusView = Ui.text(this, "", 11.5f, Ui.MUTED, false);
        statusView.setLineSpacing(0, 1.5f);
        statusRow.addView(statusView, new LinearLayout.LayoutParams(0, WRAP, 1));
        addWithTop(root, statusRow, 12);

        TextView note = Ui.text(this,
            "访问码相当于这扇门的钥匙，只在你的电脑和手机之间使用。不要在公共 Wi-Fi 下开启。以后长按桌面上的「筛」图标，可以回到这里修改连接。",
            10.5f, Ui.MUTED, false);
        note.setPadding(Ui.dp(this, 12), Ui.dp(this, 11), Ui.dp(this, 12), Ui.dp(this, 11));
        note.setBackground(Ui.rounded(Ui.PAPER, 0, Ui.LINE, Ui.dp(this, 1)));
        addWithTop(root, note, 24);

        urlInput.requestFocus();
    }

    private void addWithTop(LinearLayout parent, View view, int topDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(MATCH, WRAP);
        params.topMargin = Ui.dp(this, topDp);
        parent.addView(view, params);
    }

    private TextView fieldLabel(String value) {
        TextView label = Ui.text(this, value, 11, Ui.MUTED, false);
        label.setLetterSpacing(0.06f);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(MATCH, WRAP);
        params.topMargin = Ui.dp(this, 17);
        label.setLayoutParams(params);
        return label;
    }

    private LinearLayout stepRow(String number, String text) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.TOP);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(MATCH, WRAP);
        rowParams.bottomMargin = Ui.dp(this, 8);
        row.setLayoutParams(rowParams);

        TextView index = Ui.text(this, number, 10, Ui.ACCENT, false);
        index.setGravity(Gravity.CENTER);
        index.setBackground(Ui.rounded(Ui.PAPER_2, 999, Ui.LINE_STRONG, Ui.dp(this, 1)));
        LinearLayout.LayoutParams indexParams = new LinearLayout.LayoutParams(Ui.dp(this, 20), Ui.dp(this, 20));
        indexParams.rightMargin = Ui.dp(this, 9);
        row.addView(index, indexParams);

        TextView copy = Ui.text(this, text, 11.5f, Ui.INK_SOFT, false);
        row.addView(copy, new LinearLayout.LayoutParams(0, WRAP, 1));
        return row;
    }

    private boolean applyPairIntent(Intent intent) {
        if (intent == null) return false;
        Uri data = intent.getData();
        String url = null;
        String code = null;
        if (data != null && "sift".equals(data.getScheme()) && "pair".equals(data.getHost())) {
            url = data.getQueryParameter("url");
            code = data.getQueryParameter("code");
        }
        if (url == null) url = intent.getStringExtra("url");
        if (code == null) code = intent.getStringExtra("code");
        if (url == null && code == null) return false;
        if (url != null) urlInput.setText(url);
        if (code != null) codeInput.setText(code);
        autoConnect = url != null && !url.trim().isEmpty() && code != null && !code.trim().isEmpty();
        return autoConnect;
    }

    private void attemptConnect() {
        if (connecting) return;
        String rawUrl = urlInput.getText().toString().trim();
        int hash = rawUrl.indexOf('#');
        if (hash >= 0) {
            String fragment = rawUrl.substring(hash + 1).trim();
            if (codeInput.getText().toString().trim().isEmpty() && !fragment.isEmpty()) {
                codeInput.setText(fragment);
            }
            rawUrl = rawUrl.substring(0, hash);
        }
        String baseUrl = normalizeBaseUrl(rawUrl);
        String code = normalizeCode(codeInput.getText().toString());
        if (baseUrl == null) {
            showError("电脑地址不正确，请填成 http://192.168.1.7:8787 这样。", urlInput);
            return;
        }
        if (code == null) {
            showError("访问码应为 8 位，例如 ABCD-EFGH。", codeInput);
            return;
        }

        hideKeyboard();
        connecting = true;
        connectButton.setEnabled(false);
        connectButton.setAlpha(0.6f);
        connectButton.setText("正在连接…");
        progress.setVisibility(View.VISIBLE);
        statusView.setTextColor(Ui.MUTED);
        statusView.setText("正在确认访问码…");

        final String targetUrl = baseUrl;
        final String targetCode = code;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final SiftHttp.Result result = SiftHttp.login(targetUrl, targetCode);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing()) return;
                        finishConnect(targetUrl, targetCode, result);
                    }
                });
            }
        }).start();
    }

    private void finishConnect(String baseUrl, String code, SiftHttp.Result result) {
        connecting = false;
        connectButton.setEnabled(true);
        connectButton.setAlpha(1f);
        connectButton.setText("连接");
        progress.setVisibility(View.GONE);

        if (result.ok) {
            prefs.save(baseUrl, code);
            statusView.setTextColor(Ui.ACCENT);
            statusView.setText("连接成功，正在打开…");
            Intent main = new Intent(this, MainActivity.class);
            main.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(main);
            finish();
            return;
        }

        showError(result.error, result.status == 401 ? codeInput : urlInput);
    }

    private void showError(String message, View focus) {
        statusView.setTextColor(Ui.ERROR);
        statusView.setText(message);
        if (focus != null) focus.requestFocus();
    }

    private void hideKeyboard() {
        InputMethodManager manager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (manager != null) {
            manager.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);
        }
    }

    static String normalizeBaseUrl(String input) {
        String text = String.valueOf(input == null ? "" : input).trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "http://" + text;
        try {
            URI uri = new URI(text);
            String scheme = uri.getScheme();
            if (scheme == null) return null;
            scheme = scheme.toLowerCase();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
            if (uri.getUserInfo() != null) return null;
            String host = uri.getHost();
            if (host == null || host.isEmpty()) return null;
            if (host.startsWith("[") || host.contains(":")) return null;
            if (!host.matches("[A-Za-z0-9.-]+")) return null;
            int port = uri.getPort();
            if (port == -1) port = 8787;
            if (port < 1 || port > 65535) return null;
            URI base = new URI(scheme, null, host.toLowerCase(), port, null, null, null);
            return base.toString();
        } catch (Exception error) {
            return null;
        }
    }

    static String normalizeCode(String input) {
        String raw = String.valueOf(input == null ? "" : input)
            .toUpperCase()
            .replaceAll("[^A-Z0-9]", "");
        if (!raw.matches("[A-HJ-NP-Z2-9]{8}")) return null;
        return raw.substring(0, 4) + "-" + raw.substring(4);
    }
}
