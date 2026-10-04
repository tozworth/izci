package app.izci.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream

/** Android owns the grants; queue/library and managed-folder records stay in WebView IndexedDB. */
class SafDocuments(private val context: Context) {
    private val resolver get() = context.contentResolver

    fun checkedUri(value: String): Uri {
        val uri = Uri.parse(value)
        require(uri.scheme == "content" && uri.authority != null) { "Expected a content URI." }
        val granted = resolver.persistedUriPermissions.any { grant ->
            grant.isReadPermission && (grant.uri == uri ||
                (DocumentsContract.isTreeUri(grant.uri) && grant.uri.authority == uri.authority &&
                    uri.toString().startsWith("${grant.uri}/document/")))
        }
        if (!granted) throw SecurityException("File access was revoked. Select the file or folder again.")
        return uri
    }

    fun persist(uri: Uri, flags: Int) {
        val read = flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
        require(read != 0) { "The provider did not grant read access." }
        // Fail the selection if persistence is unsupported: transient access defeats this MVP.
        resolver.takePersistableUriPermission(uri, read)
    }

    fun folder(uri: Uri): JSONObject {
        val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        resolver.query(root, arrayOf(Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE), null, null, null)?.use { cursor ->
            check(cursor.moveToFirst()) { "The selected folder is unavailable." }
            check(cursor.getString(1) == Document.MIME_TYPE_DIR) { "Expected a folder." }
            return JSONObject().put("uri", uri.toString()).put("name", cursor.getString(0))
        }
        error("The selected folder is unavailable.")
    }

    fun permission(value: String, probe: Boolean): String {
        val uri = try { checkedUri(value) } catch (_: SecurityException) { return "prompt" }
        if (!probe) return "granted"
        return try { folder(uri); "granted" } catch (_: Exception) { "unavailable" }
    }

    fun stat(value: String): JSONObject {
        val uri = checkedUri(value)
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE, Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { cursor ->
            check(cursor.moveToFirst()) { "The file was moved or deleted." }
            val name = cursor.getString(0)
            val reportedSize = if (cursor.isNull(1)) -1 else cursor.getLong(1)
            val size = if (reportedSize >= 0) reportedSize else resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1
            check(size >= 0) { "The provider did not report a usable file size." }
            return document(uri, name, size, if (cursor.isNull(2)) 0 else cursor.getLong(2), resolver.getType(uri) ?: "application/octet-stream")
        }
        error("The file is unavailable.")
    }

    private fun document(uri: Uri, name: String, size: Long, modified: Long, mime: String, path: String? = null): JSONObject =
        JSONObject().put("uri", uri.toString()).put("name", name).put("size", size)
            .put("lastModified", modified).put("mime", mime).apply { if (path != null) put("path", path) }

    fun readFolder(value: String, maxDepth: Int): JSONArray {
        val tree = checkedUri(value)
        val rootName = folder(tree).getString("name")
        val result = JSONArray()
        val visited = HashSet<String>()
        fun walk(id: String, path: String, depth: Int) {
            check(visited.add(id)) { "The file provider returned a cyclic folder tree." }
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id)
            val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
                Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED)
            val cursor = resolver.query(children, columns, null, null, null) ?: error("Folder enumeration failed.")
            cursor.use {
                while (it.moveToNext()) {
                    val childId = it.getString(0)
                    val name = it.getString(1)
                    val mime = it.getString(2)
                    if (mime == Document.MIME_TYPE_DIR) {
                        if (depth < maxDepth) walk(childId, "$path/$name", depth + 1)
                    } else {
                        check(result.length() < 100_000) { "Folder contains too many files for one scan." }
                        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, childId)
                        // Metadata-only listing. File bytes are opened when playback/parsers need them.
                        val entry = if (it.isNull(3)) stat(uri.toString()).put("path", "$path/$name")
                            else document(uri, name, it.getLong(3), if (it.isNull(4)) 0 else it.getLong(4), mime, "$path/$name")
                        result.put(entry)
                    }
                }
            }
        }
        walk(DocumentsContract.getTreeDocumentId(tree), rootName, 0)
        return result
    }

    fun open(value: String, size: Long, endExclusive: Long): InputStream {
        val descriptor = resolver.openAssetFileDescriptor(checkedUri(value), "r") ?: error("The file cannot be opened.")
        val stream = try { descriptor.createInputStream() } catch (error: Exception) { descriptor.close(); throw error }
        return MediaDocumentStream(stream, size, endExclusive)
    }
}
