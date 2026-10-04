package app.izci.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

class LocalWebClient(private val context: Context, private val documents: SafDocuments) : WebViewClient() {
    private val assets = WebViewAssetLoader.Builder().addPathHandler("/") { path ->
        try {
            val name = if (path.isEmpty()) "index.html" else path
            val mime = when (name.substringAfterLast('.')) {
                "js", "mjs" -> "text/javascript"
                "wasm" -> "application/wasm"
                "map", "json" -> "application/json"
                else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.')) ?: "application/octet-stream"
            }
            WebResourceResponse(mime, null, context.assets.open("web/$name"))
        } catch (_: Exception) { empty(404, "Not Found") }
    }.build()

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.scheme != "https" || url.host != "appassets.androidplatform.net" || url.port != -1) return null
        if (url.path != "/__saf") return assets.shouldInterceptRequest(url) ?: empty(404, "Not Found")
        if (request.isForMainFrame || request.method != "GET") return empty(403, "Forbidden")
        val value = url.getQueryParameter("uri") ?: return empty(400, "Bad Request")
        return try {
            val info = documents.stat(value)
            val size = info.getLong("size")
            val header = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
            val range = if (header == null) ByteRange(0, size) else ByteRange.parse(header, size)
            if (range == null) return empty(416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$size"))
            val headers = mutableMapOf("Accept-Ranges" to "bytes", "Content-Length" to range.length.toString(), "Cache-Control" to "no-store")
            if (header != null) headers["Content-Range"] = "bytes ${range.start}-${range.endExclusive - 1}/$size"
            WebResourceResponse(info.getString("mime"), null, if (header == null) 200 else 206,
                // WebView seeks the returned stream according to the request's Range,
                // even for our 206 response. Pre-seeking would apply the offset twice.
                if (header == null) "OK" else "Partial Content", headers, documents.open(value, size, range.endExclusive))
        } catch (_: SecurityException) { empty(403, "Forbidden") }
        catch (_: Exception) { empty(404, "Not Found") }
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (uri.scheme == "https" && uri.host == "appassets.androidplatform.net" && uri.port == -1 &&
            (uri.path == "/" || uri.path == "/index.html")) return false
        if (request.isForMainFrame && (uri.scheme == "https" || uri.scheme == "http") && uri.host != "appassets.androidplatform.net") {
            try { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { /* No browser installed. */ }
        }
        return true
    }

    private fun empty(status: Int, reason: String, headers: Map<String, String> = emptyMap()) =
        WebResourceResponse("text/plain", "UTF-8", status, reason, headers, ByteArrayInputStream(byteArrayOf()))
}
