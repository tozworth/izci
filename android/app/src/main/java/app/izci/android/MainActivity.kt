package app.izci.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.TextView
import androidx.webkit.WebViewFeature

class MainActivity : Activity() {
    private var webView: WebView? = null
    private var bridge: SafBridge? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val content = SystemInsetLayout(this)
        setContentView(content)
        content.requestApplyInsets()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            content.addView(TextView(this).apply {
                text = "izci needs an updated Android System WebView. Update it and reopen izci."
                setPadding(24, 24, 24, 24)
            })
            return
        }
        val documents = SafDocuments(this)
        val web = WebView(this)
        webView = web
        web.setBackgroundColor(0xff1c1d1e.toInt())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.webViewClient = LocalWebClient(this, documents)
        web.webChromeClient = WebChromeClient()
        bridge = SafBridge(this, documents).also { it.attach(web) }
        content.addView(web)
        web.loadUrl("${SafBridge.APP_ORIGIN}/index.html")
    }

    @Deprecated("Activity result API is adequate for the single SAF picker in this shell.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (bridge?.onActivityResult(requestCode, resultCode, data) != true) super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Use the existing web history for Options and mobile pages.")
    override fun onBackPressed() {
        val web = webView
        if (web != null && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        bridge?.close()
        webView?.destroy()
        super.onDestroy()
    }
}
