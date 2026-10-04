package app.izci.android

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

class MediaDocumentStreamTest {
    private val bytes = ByteArray(256) { it.toByte() }

    @Test fun webViewSeeksOnceFromDocumentStart() {
        MediaDocumentStream(ByteArrayInputStream(bytes), bytes.size.toLong(), 48).use { stream ->
            val range = ByteRange.parse("bytes=40-47", stream.available().toLong())!!
            assertEquals(40L, stream.skip(range.start))
            val body = ByteArray(range.length.toInt())
            assertEquals(8, stream.read(body))
            assertArrayEquals(bytes.copyOfRange(40, 48), body)
            assertEquals(208, stream.available())
            assertEquals(-1, stream.read())
            assertEquals(-1, stream.read(ByteArray(32)))
        }
    }

    @Test fun suffixAndTailRangesUseWholeDocumentSize() {
        MediaDocumentStream(ByteArrayInputStream(bytes), bytes.size.toLong()).use { stream ->
            val range = ByteRange.parse("bytes=-4", stream.available().toLong())!!
            assertEquals(252L, stream.skip(range.start))
            assertEquals(252, stream.read())
            assertArrayEquals(bytes.copyOfRange(253, 256), stream.readBytes())
            assertEquals(0, stream.available())
            assertEquals(-1, stream.read())
            assertEquals(0, stream.read(ByteArray(0)))
        }
    }

    @Test fun pipesReportDocumentSizeAndSkipUsingBoundedReads() {
        for (throwsOnSkip in listOf(false, true)) {
            var closed = false
            val pipe = object : ByteArrayInputStream(bytes) {
                override fun available() = 0
                override fun skip(count: Long): Long {
                    if (throwsOnSkip) throw IOException("Not seekable")
                    return 0
                }
                override fun close() { closed = true }
            }
            MediaDocumentStream(pipe, 100).use { stream ->
                assertEquals(100, stream.available())
                var skipped = 0L
                while (skipped < 40) skipped += stream.skip(40 - skipped)
                assertEquals(40, stream.read())
                assertEquals(59, stream.readBytes().size)
                assertEquals(-1, stream.read())
            }
            assertTrue(closed)
        }
    }

    @Test fun boundedStreamDoesNotReadOutsideTheDocumentOrLoopAtEof() {
        MediaDocumentStream(ByteArrayInputStream(bytes), 8).use { stream ->
            assertEquals(0L, stream.skip(-1))
            assertEquals(8L, stream.skip(Long.MAX_VALUE))
            assertEquals(0L, stream.skip(1))
            assertEquals(-1, stream.read())
        }
        val truncated = object : ByteArrayInputStream(ByteArray(0)) {
            override fun skip(count: Long) = 0L
        }
        MediaDocumentStream(truncated, 100).use { stream ->
            assertEquals(0L, stream.skip(10))
            assertEquals(-1, stream.read())
        }
    }
}
