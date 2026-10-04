package app.izci.android

import android.content.Context
import android.graphics.Insets
import android.os.Build
import android.view.WindowInsets
import android.widget.FrameLayout

/** Keep the WebView's actual bounds clear of system UI, including fixed web controls. */
class SystemInsetLayout(context: Context) : FrameLayout(context) {
    init {
        setBackgroundColor(0xff1c1d1e.toInt())
        setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val types = WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout()
                val safe = insets.getInsets(types)
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                // Deliver zeroed insets to WebView so newer versions don't inset twice,
                // while still receiving updates when the keyboard or system bars change.
                WindowInsets.Builder(insets)
                    .setInsets(types, Insets.NONE)
                    .setInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(), Insets.NONE)
                    .setDisplayCutout(null)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                @Suppress("DEPRECATION")
                val remaining = insets.consumeSystemWindowInsets()
                if (Build.VERSION.SDK_INT >= 28) {
                    @Suppress("DEPRECATION")
                    remaining.consumeDisplayCutout()
                } else remaining
            }
        }
    }
}
