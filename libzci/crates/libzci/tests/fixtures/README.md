# Image fixtures

`lossless.jxl` is generated from the project's own deterministic 128x128 PNG at
`../../../libzci-native/tests/fixtures/cache-source.png`: each RGBA pixel at
row y is `[y, 100, 200, 255]`. This fixture contains no third-party image content.

Recipe (FFmpeg 8.1.1 full build with libjxl):

```powershell
ffmpeg -hide_banner -loglevel error -y -i libzci/crates/libzci-native/tests/fixtures/cache-source.png -frames:v 1 -c:v libjxl -distance 0 -effort 1 libzci/crates/libzci/tests/fixtures/lossless.jxl
```

Tests verify decoded pixels rather than requiring bit-identical future encoder
output. The fixture retains its opaque alpha channel.

`jxl-conformance/` contains `bench_oriented_brg` from the
[JPEG XL Project conformance corpus](https://github.com/libjxl/conformance/tree/b1d0f990b03e57bf6d137c365cd5dc8b470b9191/testcases/bench_oriented_brg),
commit `b1d0f990b03e57bf6d137c365cd5dc8b470b9191`. Its BSD license is retained
in that directory. This case has codestream orientation 5 and a nonstandard
BRG ICC profile. The test compares the shared sRGB output against its 8-bit
PNG reference with at most one code-value difference; it does not claim the
full floating-point conformance tolerances from `test.json`.

SHA-256:

- `input.jxl`: `e223fed907c6238622b2b6ec1c80609050c9d2db4d759cf3ca6f0db304cbb82a`
- `ref.png`: `908d2bc9656a824b69071484e15a81b62e2be67dde2ac87708747222c0949f7f`
