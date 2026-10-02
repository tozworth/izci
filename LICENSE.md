# izci license

Copyright (c) 2026 Yiğit Aydın

Except for the third-party components identified below, the original izci code,
documentation, and assets are licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Third-party notices

The MIT license above covers izci's original work. Third-party code, fonts,
compiled libraries, SDK material and runtime support retain their own licenses.
Full copyright notices, license texts and upstream NOTICE files are reproduced
in THIRD-PARTY-NOTICES.md. The Options license page bundles both documents, so
they can be read offline in the PWA and desktop application.

This notice snapshot was reviewed on 2026-10-02 for izci 0.3.2. Versions refer
to the current lockfiles or to identifiers embedded in vendored binaries;
they are not inferred from dependency version ranges. Dependencies removed by
tree shaking and build-time/compiler support can be included conservatively
in the notice inventory without being present in every application binary.

### Frontend, localization and fonts

- Chiptune3 0.8.4: MIT. Copyright © 2013-2024 The chiptune2.js and chiptune3
  contributers, as stated in the published package. izci vendors its JavaScript
  runtime and adds an interactive-interface bridge; the compiled libopenmpt
  library has its own license, described below.
  Source: https://github.com/DrSnuggles/chiptune
- Howler.js 2.2.4: MIT. Copyright (c) 2013-2020 James Simpson and GoldFire
  Studios, Inc. Source: https://github.com/goldfire/howler.js
- Svelte 5.56.1: MIT. Copyright (c) 2016-2025 Svelte Contributors.
  Source: https://github.com/sveltejs/svelte
- svelte-i18n 4.0.1: MIT. Copyright 2017 Christian Kaisermann.
  Source: https://github.com/kaisermann/svelte-i18n
- intl-messageformat 10.7.18: BSD-3-Clause. FormatJS's supporting parser,
  locale-matching and memoization packages use MIT; tslib uses 0BSD;
  decimal.js and deepmerge use MIT. Exact versions and notices are listed
  in THIRD-PARTY-NOTICES.md. Source: https://github.com/formatjs/formatjs
- fflate 0.8.3: MIT. Copyright (c) 2026 Arjun Barrett.
  Source: https://github.com/101arrowz/fflate
- Material Symbols font-400 0.40.2: Apache-2.0. Material Symbols are created
  by Google. Source: https://github.com/google/material-design-icons
- Workbox 7.4.1: MIT. Copyright 2018 Google LLC. Workbox supplies the PWA's
  service-worker support and is not used by the desktop service-worker stub.
  Source: https://github.com/GoogleChrome/workbox
- @tauri-apps/api 2.12.0: MIT OR Apache-2.0. Used only by the desktop frontend.
  Source: https://github.com/tauri-apps/tauri

### Mediabunny and encoder extensions

Mediabunny, @mediabunny/mp3-encoder and @mediabunny/flac-encoder are version
1.52.0 and use MPL-2.0. Their source files carry the notice:

Copyright (c) 2026-present, Vanilagy and contributors.

This Source Code Form is subject to the terms of the Mozilla Public License,
v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain
one at https://mozilla.org/MPL/2.0/.

Source for the covered code, including the encoder bridges and upstream
rebuild recipes:

https://github.com/Vanilagy/mediabunny/tree/v1.52.0
https://registry.npmjs.org/mediabunny/-/mediabunny-1.52.0.tgz
https://registry.npmjs.org/@mediabunny/mp3-encoder/-/mp3-encoder-1.52.0.tgz
https://registry.npmjs.org/@mediabunny/flac-encoder/-/flac-encoder-1.52.0.tgz

The MPL covers these components and their covered modifications. It does not
replace the licenses of LAME or libFLAC compiled into the extensions. The
original izci source files retain MIT. Third-party source distributed in
minified or compiled form remains available under its applicable source
license; the full MPL text is reproduced in THIRD-PARTY-NOTICES.md.

### LAME MP3 encoding

LAME 3.100 is bundled as WebAssembly inside @mediabunny/mp3-encoder. It is used
for MP3 export by the Converter and Editor. LAME uses the GNU Library General
Public License, version 2 or later (LGPL-2.0-or-later). Its LGPL terms remain
applicable even though the JavaScript extension's package metadata says MPL.

LAME was originally developed by Mike Cheng, subsequently developed by Mark
Taylor, and is maintained by the LAME Project. Copyright holders and additional
contributors are identified in the LAME source. The full LGPL version 2 text,
LAME's LICENSE guidance and its encoding-library license header are reproduced
in THIRD-PARTY-NOTICES.md.

Project: https://lame.sourceforge.io/
Source release: https://sourceforge.net/projects/lame/files/lame/3.100/lame-3.100.tar.gz
Upstream build recipe: https://github.com/Vanilagy/mediabunny/tree/v1.52.0/packages/mp3-encoder

The upstream encoder recipe compiles libmp3lame with:

    CFLAGS="-DNDEBUG -DNO_STDIO -O3 -msimd128"
    --disable-dependency-tracking --disable-shared --disable-gtktest
    --disable-analyzer-hooks --disable-decoder --disable-frontend

It links libmp3lame.a with the extension's MPL-licensed src/lame-bridge.c and
uses Emscripten SINGLE_FILE output to embed the WASM. The older GPL mpglib
decoder mentioned by LAME is excluded by this encoder-only recipe. The
extension README describes the complete configure, compilation, bridge,
worker and package rebuild steps. izci then bundles the extension with its
frontend; izci does not change LAME's native encoding sources.

The LGPL preserves recipients' rights to modify the library and use a modified
version. License notices and upstream links alone do not supply the required
corresponding-source or replacement/relink materials. A distributor must meet
the applicable LGPL requirements for the actual binaries it distributes.
This notice update does not claim to provide a separately downloadable,
verified corresponding-source/relink bundle, and is not a written source offer.

### FLAC encoding

The libFLAC binary in @mediabunny/flac-encoder 1.52.0 identifies itself as
"reference libFLAC git-3f1ecff8 20260304". The codec library uses the Xiph.Org
BSD 3-Clause license, with these notices:

Copyright (C) 2000-2009 Josh Coalson
Copyright (C) 2011-2025 Xiph.Org Foundation

Source: https://github.com/xiph/flac/tree/3f1ecff8
Build recipe: https://github.com/Vanilagy/mediabunny/tree/v1.52.0/packages/flac-encoder

The full COPYING.Xiph text is reproduced in THIRD-PARTY-NOTICES.md. The GPL
license used by separate FLAC command-line programs is not the license of
this embedded codec library.

### Tracker replay libraries

The embedded libopenmpt is version 0.8.4, licensed under BSD-3-Clause:

Copyright (c) 2004-2025, OpenMPT Project Developers and Contributors
Copyright (c) 1997-2003, Olivier Lapicque
All rights reserved.

Source: https://github.com/OpenMPT/openmpt/tree/libopenmpt-0.8.4
Project: https://lib.openmpt.org/

The vendored WASM identifies MINIZ, MINIMP3, STBVORBIS and PLUGINS build
features. Its additional notices include miniz (MIT), minimp3 (CC0-1.0),
stb_vorbis (MIT OR Unlicense), Ryuhei Mori's TinyFFT (BSD-2-Clause, adapted by
OpenMPT), and the public-domain Opal OPL3 emulator released by Shayde/Reality.
It uses minimp3 for embedded MP3 decoding; it is not a mpg123 build.
The applicable full licenses and source-file attribution notices are included
in THIRD-PARTY-NOTICES.md.

The HivelyTracker AHX/HVL replayer is licensed under BSD-3-Clause:

Copyright (c) 2006-2018, Pete Gordon
All rights reserved.

The replay core comes from commit f393ca7c6416f00bcb574b334a7e8b57dcb19eb2:
https://github.com/pete-gordon/hivelytracker/tree/f393ca7c6416f00bcb574b334a7e8b57dcb19eb2

izci supplies the replay wrapper and worklet. The upstream notice is also
preserved in public/vendor/hivelytracker-LICENSE.txt and alongside the server's
embedded replay library. Rebuild information lives in scripts/vendor/ahx/README.md.

### Compiled runtime support

The shipped WASM libraries use Emscripten glue/runtime code (MIT OR NCSA) and
applicable musl and LLVM C/C++ runtime support. These components retain their
individual notices, including LLVM's Apache-2.0 exception and legacy terms.
The corresponding license texts are reproduced in THIRD-PARTY-NOTICES.md.
Exact compiler revisions were not recorded for every precompiled upstream
codec; this document does not assert one shared toolchain revision.

Source: https://github.com/emscripten-core/emscripten
LLVM source: https://github.com/llvm/llvm-project

### Windows desktop shell and SDK loader

The desktop application uses Tauri, wry, tao, tray-icon, Windows API bindings,
WebView2 COM bindings, serde and other Rust dependencies. The exact resolved
Windows MSVC package inventory, including procedural macros and build-time
support, appears in THIRD-PARTY-NOTICES.md. It includes their full license and
NOTICE files, rather than applying izci's MIT license to them. MPL-licensed
dependencies retain their covered source obligations.

The Rust standard library is MIT OR Apache-2.0, with specific in-tree exceptions
and additional dependency notices. The notice snapshot includes the copyright
information and license texts supplied with the local Rust 1.98.1 toolchain,
including target-specific entries that may not be used by the Windows build.
Its source and licensing information are published with the Rust toolchain:
https://www.rust-lang.org/policies/licenses
https://github.com/rust-lang/rust

webview2-com-sys 0.39.1 supplies the statically linked WebView2 SDK loader from
Microsoft.Web.WebView2 1.0.3800.47. The SDK's BSD-3-Clause LICENSE.txt and its
complete NOTICE.txt are reproduced in THIRD-PARTY-NOTICES.md. Copyright (C)
Microsoft Corporation. All rights reserved. The SDK notice includes additional
SDK attribution; it does not imply that every SDK tool is embedded in izci.
The WebView2 browser runtime is separately installed on Windows.

SDK: https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3800.47
Bindings: https://github.com/wravery/webview2-rs

### UPX compressed-executable exception

Default Windows desktop builds use the official unmodified UPX 5.2.1 packer.
The packer is build tooling, while its decompression stub is embedded in the
compressed izci.exe. Builds made with --no-compress do not contain that stub.

UPX/UCL use GPL-2.0-or-later with a special exception for compressed programs,
including commercial executables. The exception requires the official,
unmodified stub and restricts its use to startup decompression. Both the full
GPL COPYING and the full exception in LICENSE are reproduced unchanged in
THIRD-PARTY-NOTICES.md. This exception does not relicense izci's original code.

Copyright (C) 1996-2026 Markus Franz Xaver Johannes Oberhumer
Copyright (C) 1996-2026 Laszlo Molnar
Copyright (C) 2000-2026 John F. Reiser

Source: https://github.com/upx/upx/tree/v5.2.1

### Optional signaling and dedicated-server distributions

Only signaling-enabled desktop builds embed the Go signaling child. Its Go
runtime and module notices are included in THIRD-PARTY-NOTICES.md. Ordinary
desktop builds do not embed this child or dedicated-host media dependencies.

The dedicated izci-server module has its own LICENSE.md and detailed
THIRD-PARTY-NOTICES.md under izci-server/. The server Docker image copies both
documents into /usr/share/doc/izci-server/. Debian system packages retain their
copyright/license documents under /usr/share/doc/<package>/copyright and
/usr/share/common-licenses. The Docker recipe installs FFmpeg and libopenmpt;
they are system dependencies, not linked into the CGO-disabled Go server.
The installed FFmpeg build can use LGPL or GPL terms depending on configuration.

The server notices identify module versions, SQLite and musl attribution,
the embedded Hively replayer, Debian source locations and the boundary between
notices and any separately required corresponding-source distribution.

### Maintaining these notices

When distributing a changed dependency set, update the inventory against
package-lock.json, src-tauri/Cargo.lock and izci-server/go.mod/go.sum, and inspect
the native libraries embedded in WASM and SDK packages. Package metadata alone
does not identify all embedded licenses. Preserve upstream copyright and NOTICE
text, and retain all notices applicable to compiled or generated code.
Current sources, including izci's modifications, are available at:
https://github.com/dunsparce9/izci
