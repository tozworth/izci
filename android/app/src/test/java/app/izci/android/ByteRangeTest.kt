package app.izci.android

import org.junit.Assert.*
import org.junit.Test

class ByteRangeTest {
    @Test fun handlesClosedOpenAndSuffixRanges() {
        assertEquals(ByteRange(4, 9), ByteRange.parse("bytes=4-8", 12))
        assertEquals(ByteRange(4, 12), ByteRange.parse("bytes=4-", 12))
        assertEquals(ByteRange(9, 12), ByteRange.parse("bytes=-3", 12))
        assertEquals(ByteRange(0, 12), ByteRange.parse("bytes=-99", 12))
        assertEquals(ByteRange(4, 12), ByteRange.parse("bytes=4-99", 12))
        assertEquals(ByteRange(1, Long.MAX_VALUE), ByteRange.parse("bytes=1-9223372036854775807", Long.MAX_VALUE))
    }
    @Test fun rejectsMalformedUnsatisfiableAndMultipleRanges() {
        for (header in listOf("bytes=12-", "bytes=8-4", "bytes=-0", "bytes=-", "bytes=0-1,4-8", "items=0-1", "bytes=x-2", "bytes=99999999999999999999-")) {
            assertNull(header, ByteRange.parse(header, 12))
        }
        assertNull(ByteRange.parse("bytes=0-", 0))
    }
}
