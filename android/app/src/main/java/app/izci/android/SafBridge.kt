package app.izci.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

class SafBridge(private val activity: Activity, private val documents: SafDocuments) {
    private val main = Handler(Looper.getMainLooper())
    private val workers = Executors.newFixedThreadPool(2)
    private data class Request(val id: String, val reply: JavaScriptReplyProxy)
    private data class Picker(val request: Request, val method: String, val expectedUri: String?)
    private var picker: Picker? = null

    fun attach(webView: WebView) {
        WebViewCompat.addWebMessageListener(webView, "izciSaf", setOf(APP_ORIGIN)) { _, message, origin, isMainFrame, reply ->
            if (!isMainFrame || origin.toString() != APP_ORIGIN) return@addWebMessageListener
            val body = try { JSONObject(message.data ?: return@addWebMessageListener) } catch (_: Exception) { return@addWebMessageListener }
            val id = body.optString("id")
            if (id.length !in 1..64) return@addWebMessageListener
            val request = Request(id, reply)
            val method = body.optString("method")
            val args = body.optJSONObject("args") ?: JSONObject()
            try {
                when (method) {
                    "pickFiles", "pickFolder", "requestFolderPermission" -> openPicker(request, method, args.optString("uri").ifEmpty { null })
                    else -> background(request) {
                        when (method) {
                            "statFile" -> documents.stat(args.getString("uri"))
                            "readFolder" -> documents.readFolder(args.getString("uri"), args.getInt("maxDepth").also { require(it in 0..64) })
                            "queryFolderPermission" -> documents.permission(args.getString("uri"), args.optBoolean("probe"))
                            else -> error("Unknown Android file operation.")
                        }
                    }
                }
            } catch (error: Exception) {
                fail(request, error)
                Toast.makeText(activity, error.message ?: "Android file selection failed.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun openPicker(request: Request, method: String, expectedUri: String?) {
        check(picker == null) { "Another file picker is already open." }
        if (method == "requestFolderPermission") {
            require(expectedUri != null)
            if (documents.permission(expectedUri, true) == "granted") { succeed(request, "granted"); return }
        }
        val intent = if (method == "pickFiles") {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*" // Tracker formats often have no registered Android MIME type.
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        } else Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            if (expectedUri != null) putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(expectedUri))
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        picker = Picker(request, method, expectedUri)
        try { activity.startActivityForResult(intent, PICK_DOCUMENTS) }
        catch (error: Exception) { picker = null; throw error }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != PICK_DOCUMENTS) return false
        val selection = picker ?: return true
        picker = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            if (selection.method == "requestFolderPermission") succeed(selection.request, "denied")
            else fail(selection.request, Exception("File selection cancelled."), "AbortError")
            return true
        }
        background(selection.request, showError = true) {
            if (selection.method == "pickFiles") {
                val uris = LinkedHashSet<Uri>()
                data.data?.let { uris.add(it) }
                data.clipData?.let { clips -> for (index in 0 until clips.itemCount) uris.add(clips.getItemAt(index).uri) }
                check(uris.isNotEmpty()) { "The provider returned no files." }
                JSONArray().apply { for (uri in uris) { documents.persist(uri, data.flags); put(documents.stat(uri.toString())) } }
            } else {
                val uri = data.data ?: error("The provider returned no folder.")
                if (selection.expectedUri != null && selection.expectedUri != uri.toString()) {
                    error("Select the same folder to restore its access. Add a different folder using Add folder.")
                }
                documents.persist(uri, data.flags)
                if (selection.method == "requestFolderPermission") { documents.folder(uri); "granted" }
                else documents.folder(uri)
            }
        }
        return true
    }

    private fun background(request: Request, showError: Boolean = false, operation: () -> Any) {
        workers.execute {
            try { val value = operation(); main.post { succeed(request, value) } }
            catch (error: Exception) { main.post {
                fail(request, error)
                if (showError && !activity.isDestroyed) Toast.makeText(activity, error.message ?: "Android file selection failed.", Toast.LENGTH_LONG).show()
            } }
        }
    }
    private fun succeed(request: Request, value: Any) {
        if (!activity.isDestroyed) request.reply.postMessage(JSONObject().put("id", request.id).put("result", value).toString())
    }
    private fun fail(request: Request, error: Exception, name: String = if (error is SecurityException) "NotAllowedError" else "NotReadableError") {
        if (!activity.isDestroyed) request.reply.postMessage(JSONObject().put("id", request.id)
            .put("error", JSONObject().put("name", name).put("message", error.message ?: "Android file operation failed.")).toString())
    }
    fun close() { workers.shutdownNow(); picker = null }

    companion object {
        const val APP_ORIGIN = "https://appassets.androidplatform.net"
        private const val PICK_DOCUMENTS = 4101
    }
}
