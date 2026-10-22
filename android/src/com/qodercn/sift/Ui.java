package com.qodercn.sift;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.text.InputType;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int PAPER = Color.rgb(243, 238, 227);
    static final int PAPER_2 = Color.rgb(251, 248, 240);
    static final int INK = Color.rgb(29, 27, 23);
    static final int INK_SOFT = Color.rgb(70, 65, 54);
    static final int MUTED = Color.rgb(111, 104, 90);
    static final int LINE = Color.rgb(218, 210, 194);
    static final int LINE_STRONG = Color.rgb(185, 174, 154);
    static final int ACCENT = Color.rgb(191, 63, 43);
    static final int ACCENT_DEEP = Color.rgb(156, 47, 30);
    static final int ERROR = Color.rgb(156, 47, 30);

    private Ui() {}

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable rounded(int fill, float radius, int stroke, float strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) {
            drawable.setStroke(Math.max(1, Math.round(strokeWidth)), stroke);
        }
        return drawable;
    }

    static TextView text(Context context, String value, float size, int color, boolean serif) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.25f);
        if (serif) {
            view.setTypeface(Typeface.create("serif", Typeface.NORMAL));
        }
        return view;
    }

    static TextView title(Context context, String value, float size) {
        TextView view = text(context, value, size, INK, true);
        view.setTypeface(Typeface.create("serif", Typeface.BOLD));
        return view;
    }

    static Button button(Context context, String label, boolean primary) {
        Button button = new Button(context);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTextColor(primary ? PAPER_2 : INK);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setMinimumHeight(dp(context, 48));
        button.setMinHeight(dp(context, 48));
        button.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        button.setElevation(0);
        button.setStateListAnimator(null);

        StateListDrawable background = new StateListDrawable();
        background.addState(
            new int[] { android.R.attr.state_pressed },
            rounded(primary ? ACCENT_DEEP : PAPER, dp(context, 2),
                primary ? ACCENT_DEEP : LINE_STRONG, dp(context, 1))
        );
        background.addState(
            new int[] {},
            rounded(primary ? ACCENT : PAPER_2, dp(context, 2),
                primary ? ACCENT : LINE_STRONG, dp(context, 1))
        );
        button.setBackground(background);
        return button;
    }

    static EditText field(Context context, String hint, int inputType) {
        EditText field = new EditText(context);
        field.setHint(hint);
        field.setHintTextColor(MUTED);
        field.setTextColor(INK);
        field.setTextSize(15);
        field.setSingleLine(true);
        field.setInputType(inputType);
        field.setBackground(rounded(PAPER_2, dp(context, 2), LINE, dp(context, 1)));
        field.setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10));
        field.setMinHeight(dp(context, 48));
        return field;
    }

    static EditText urlField(Context context, String hint) {
        return field(context, hint, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    }

    static EditText codeField(Context context, String hint) {
        return field(context, hint,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
    }

    static LinearLayout card(Context context) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 16), dp(context, 16), dp(context, 16), dp(context, 16));
        card.setBackground(rounded(PAPER_2, dp(context, 2), LINE, dp(context, 1)));
        return card;
    }

    static void applySystemBars(Activity activity) {
        Window window = activity.getWindow();
        window.setStatusBarColor(PAPER);
        window.setNavigationBarColor(PAPER);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(flags);
    }
}
