package library

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVirtualPathContainment(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "music")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "song.mp3"), "audio")
	vp, err := VirtualPathFor("/music", root, filepath.Join(root, "song.mp3"))
	if err != nil || vp != "/music/song.mp3" {
		t.Fatalf("virtual path = %q, err=%v", vp, err)
	}
	// Nested file.
	writeFile(t, filepath.Join(root, "rock", "deep.flac"), "audio")
	vp, err = VirtualPathFor("/music", root, filepath.Join(root, "rock", "deep.flac"))
	if err != nil || vp != "/music/rock/deep.flac" {
		t.Fatalf("nested virtual path = %q, err=%v", vp, err)
	}
	// Outside file must be rejected.
	outside := filepath.Join(dir, "other.mp3")
	writeFile(t, outside, "audio")
	if _, err := VirtualPathFor("/music", root, outside); err == nil {
		t.Fatalf("outside file must be rejected")
	}
	// Symlink escaping the root must be rejected.
	link := filepath.Join(root, "escape.mp3")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	if _, err := VirtualPathFor("/music", root, link); err == nil {
		t.Fatalf("escaping symlink must be rejected")
	}
	// Symlink inside the root resolves within.
	inner := filepath.Join(root, "inner.mp3")
	writeFile(t, inner, "audio")
	innerLink := filepath.Join(root, "sub", "link.mp3")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(inner, innerLink); err == nil {
		vp, err = VirtualPathFor("/music", root, innerLink)
		if err != nil {
			t.Fatalf("inner symlink must resolve: %v", err)
		}
		if vp != "/music/sub/link.mp3" {
			t.Fatalf("inner symlink virtual path = %q", vp)
		}
	}
}

func TestScanPinsAllowedSymlinkTarget(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "music")
	target := filepath.Join(root, "target.mp3")
	writeFile(t, target, "audio")
	link := filepath.Join(root, "alias.mp3")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	resolved, err := ResolveRoots([]Root{{Mount: "/music", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	files, err := Scan(resolved, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f.VirtualPath == "/music/alias.mp3" && f.AbsPath != target {
			t.Fatalf("symlink source path was not pinned: %q", f.AbsPath)
		}
	}
}

func TestScanSkipsUnsupportedAndDotfiles(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "music")
	writeFile(t, filepath.Join(root, "song.mp3"), "audio")
	writeFile(t, filepath.Join(root, "notes.txt"), "text")
	writeFile(t, filepath.Join(root, ".hidden.mp3"), "audio")
	writeFile(t, filepath.Join(root, ".hidden", "nested.mp3"), "audio")
	writeFile(t, filepath.Join(root, "track.mod"), "module")
	writeFile(t, filepath.Join(root, "tune.ahx"), "hively")
	writeFile(t, filepath.Join(root, "clip.mp4"), "video")
	resolved, err := ResolveRoots([]Root{{Mount: "/music", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	files, err := Scan(resolved, 4)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, f := range files {
		got[f.VirtualPath] = true
	}
	for _, want := range []string{"/music/song.mp3", "/music/track.mod", "/music/tune.ahx", "/music/clip.mp4"} {
		if !got[want] {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	if got["/music/notes.txt"] || got["/music/.hidden.mp3"] || got["/music/.hidden/nested.mp3"] {
		t.Errorf("unsupported/dotfiles must be skipped: %v", got)
	}
}

func TestScanInclusionRules(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "music")
	writeFile(t, filepath.Join(root, "root.mp3"), "audio")
	writeFile(t, filepath.Join(root, "album", "keep.flac"), "audio")
	writeFile(t, filepath.Join(root, "album", "skip.mp3"), "audio")
	writeFile(t, filepath.Join(root, "drafts", "keep.flac"), "audio")
	resolved, err := ResolveRoots([]Root{{
		Mount: "/music", Path: root,
		Include: []string{"**/*.flac", "root.mp3"},
		Exclude: []string{"drafts/**"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	files, err := Scan(resolved, 2)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, file := range files {
		got[file.VirtualPath] = true
	}
	if !got["/music/root.mp3"] || !got["/music/album/keep.flac"] || len(got) != 2 {
		t.Fatalf("filtered files = %v", got)
	}
}

func TestValidateGlob(t *testing.T) {
	for _, pattern := range []string{"**", "**/*.mp3", "album/?rack.flac", "*.mod"} {
		if err := ValidateGlob(pattern); err != nil {
			t.Errorf("ValidateGlob(%q): %v", pattern, err)
		}
	}
	for _, pattern := range []string{"", "/music/**", "../secret/**", "a//b", `a\b`, "[ab].mp3"} {
		if err := ValidateGlob(pattern); err == nil {
			t.Errorf("ValidateGlob(%q) succeeded", pattern)
		}
	}
}

func TestScanDoesNotFollowOutsideSymlinkDir(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "music")
	outside := filepath.Join(dir, "outside")
	writeFile(t, filepath.Join(outside, "secret.mp3"), "audio")
	writeFile(t, filepath.Join(root, "ok.mp3"), "audio")
	if err := os.Symlink(outside, filepath.Join(root, "linkdir")); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	resolved, err := ResolveRoots([]Root{{Mount: "/music", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	files, err := Scan(resolved, 4)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f.VirtualPath == "/music/linkdir/secret.mp3" {
			t.Fatalf("must not descend into outside symlink dir")
		}
	}
	if len(files) != 1 || files[0].VirtualPath != "/music/ok.mp3" {
		t.Fatalf("expected only ok.mp3, got %v", files)
	}
}

func TestInferKindParity(t *testing.T) {
	cases := map[string]string{
		"mp3": "stream", "wav": "stream", "flac": "stream", "ogg": "stream", "opus": "stream",
		"mod": "module", "xm": "module", "s3m": "module", "it": "module", "mo3": "module",
		"ahx": "module", "hvl": "module",
		"mp4": "video", "m4v": "video", "mov": "video", "webm": "video", "mkv": "video",
		"jpg": "image", "jpeg": "image", "png": "image", "webp": "image", "avif": "image",
		"txt": "", "": "",
	}
	for ext, want := range cases {
		if got := InferKind(ext); got != want {
			t.Errorf("InferKind(%q) = %q, want %q", ext, got, want)
		}
	}
	if !IsHively("ahx") || !IsHively("HVL") || IsHively("mod") {
		t.Errorf("IsHively mismatch")
	}
}

func TestVirtualMountsOverlap(t *testing.T) {
	if !VirtualMountsOverlap("/music", "/music") {
		t.Errorf("equal mounts overlap")
	}
	if !VirtualMountsOverlap("/music", "/music/rock") {
		t.Errorf("prefix mounts overlap")
	}
	if VirtualMountsOverlap("/music", "/modules") {
		t.Errorf("sibling mounts must not overlap")
	}
}
