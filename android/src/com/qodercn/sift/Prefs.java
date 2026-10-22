package com.qodercn.sift;

import android.content.Context;
import android.content.SharedPreferences;

final class Prefs {
    private static final String FILE = "sift";
    private static final String KEY_URL = "server_url";
    private static final String KEY_CODE = "access_code";

    private final SharedPreferences prefs;

    Prefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String serverUrl() {
        return prefs.getString(KEY_URL, "");
    }

    String accessCode() {
        return prefs.getString(KEY_CODE, "");
    }

    void save(String url, String code) {
        prefs.edit()
            .putString(KEY_URL, url)
            .putString(KEY_CODE, code)
            .apply();
    }
}
