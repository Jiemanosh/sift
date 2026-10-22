package com.qodercn.sift;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

final class SiftHttp {
    private SiftHttp() {}

    static final class Result {
        final boolean ok;
        final String cookie;
        final String error;
        final int status;

        private Result(boolean ok, String cookie, String error, int status) {
            this.ok = ok;
            this.cookie = cookie;
            this.error = error;
            this.status = status;
        }

        static Result success(String cookie) {
            return new Result(true, cookie, null, 200);
        }

        static Result failure(int status, String error) {
            return new Result(false, null, error, status);
        }
    }

    static Result login(String baseUrl, String code) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl + "/api/mobile/login");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("POST");
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("content-type", "application/json; charset=utf-8");
            connection.setRequestProperty("accept", "application/json");
            connection.setRequestProperty("user-agent", "SiftAndroid/1.0");

            byte[] body = new JSONObject()
                .put("code", code)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int status = connection.getResponseCode();
            String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            if (status == 200) {
                String cookie = findCookie(connection);
                if (cookie == null || cookie.isEmpty()) {
                    return Result.failure(0, "电脑没有返回登录凭证，请重试");
                }
                return Result.success(cookie);
            }
            String message = parseError(text);
            return Result.failure(status, message != null ? message : "连接失败（HTTP " + status + "）");
        } catch (UnknownHostException error) {
            return Result.failure(0, "找不到电脑地址，请检查是否填对");
        } catch (SocketTimeoutException error) {
            return Result.failure(0, "连接超时，请确认手机和电脑在同一个 Wi-Fi，且筛正在运行");
        } catch (ConnectException error) {
            return Result.failure(0, "连不上电脑，请确认地址、端口和电脑上的筛");
        } catch (Exception error) {
            String message = error.getMessage();
            return Result.failure(0, message == null || message.isEmpty() ? "连接失败，请重试" : "连接失败：" + message);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String findCookie(HttpURLConnection connection) {
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String value : entry.getValue()) {
                if (value != null && value.startsWith("sift_mobile=")) {
                    int semicolon = value.indexOf(';');
                    return semicolon >= 0 ? value.substring(0, semicolon) : value;
                }
            }
        }
        return null;
    }

    private static String parseError(String text) {
        if (text == null || text.isEmpty()) return null;
        try {
            String message = new JSONObject(text).optString("error", "");
            return message.isEmpty() ? null : message;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String read(InputStream input) {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                output.write(buffer, 0, count);
                if (output.size() > 64 * 1024) break;
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }
}
