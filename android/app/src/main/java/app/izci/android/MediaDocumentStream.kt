package app.izci.android

import java.io.IOException
import java.io.InputStream

/** A complete document stream: WebView applies the request's Range by calling skip(). */
class MediaDocumentStream(private val source: InputStream, private val size: Long, private val endExclusive: Long = size) : InputStream() {
    private var position = 0L

    init { require(size >= 0 && endExclusive in 0..size) }

    // WebView uses available() as the document size when resolving byte ranges,
    // including suffix ranges. A pipe's available bytes are not its total size.
    override fun available(): Int = (size - position).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

    override fun read(): Int {
        if (position >= endExclusive) return -1
        val value = source.read()
        if (value >= 0) position++
        return value
    }

    override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
        if (offset < 0 || length < 0 || offset > bytes.size - length) throw IndexOutOfBoundsException()
        if (length == 0) return 0
        if (position >= endExclusive) return -1
        val count = source.read(bytes, offset, minOf(length.toLong(), endExclusive - position).toInt())
        if (count > 0) position += count
        return count
    }

    override fun skip(count: Long): Long {
        val requested = count.coerceIn(0, endExclusive - position)
        if (requested == 0L) return 0
        // File-backed providers seek without copying; pipe-backed providers may
        // need bounded reads to discard bytes. Never bypass the descriptor's stream.
        val skipped = try { source.skip(requested) } catch (_: IOException) { 0L }
        if (skipped > 0) {
            position += skipped
            return skipped
        }
        val buffer = ByteArray(minOf(requested, 16 * 1024L).toInt())
        return read(buffer).coerceAtLeast(0).toLong()
    }

    override fun close() = source.close()
}
