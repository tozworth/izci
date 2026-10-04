package app.izci.android

data class ByteRange(val start: Long, val endExclusive: Long) {
    val length get() = endExclusive - start

    companion object {
        /** One RFC 9110 byte range. Invalid/multiple/unsatisfiable ranges fail closed. */
        fun parse(header: String, size: Long): ByteRange? {
            if (size <= 0) return null
            val match = Regex("bytes=(\\d*)-(\\d*)").matchEntire(header.trim()) ?: return null
            val (first, last) = match.destructured
            if (first.isEmpty()) {
                val suffix = last.toLongOrNull()?.takeIf { it > 0 } ?: return null
                return ByteRange((size - suffix).coerceAtLeast(0), size)
            }
            val start = first.toLongOrNull()?.takeIf { it >= 0 && it < size } ?: return null
            val end = if (last.isEmpty()) size else {
                val inclusive = last.toLongOrNull()?.takeIf { it >= start } ?: return null
                if (inclusive >= size - 1) size else inclusive + 1
            }
            return ByteRange(start, end)
        }
    }
}
