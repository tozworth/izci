package library

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Root ties a virtual mount to a filesystem directory.
type Root struct {
	Mount   string   // canonical "/music"
	Path    string   // configured filesystem path (may be relative)
	Abs     string   // absolute cleaned path for scanning
	Include []string // root-relative globs; empty includes all supported files
	Exclude []string // root-relative globs; exclusion wins
}

// ResolveRoots validates configured roots against the live filesystem:
// every path must exist and be a directory, and resolved locations must not
// overlap (which would scan one file under two virtual mounts).
func ResolveRoots(configured []Root) ([]Root, error) {
	out := make([]Root, 0, len(configured))
	for _, r := range configured {
		abs, err := filepath.Abs(r.Path)
		if err != nil {
			return nil, fmt.Errorf("library: root %q: %v", r.Mount, err)
		}
		fi, err := os.Stat(abs)
		if err != nil {
			return nil, fmt.Errorf("library: root %q (%s): %v", r.Mount, r.Path, err)
		}
		if !fi.IsDir() {
			return nil, fmt.Errorf("library: root %q (%s) is not a directory", r.Mount, r.Path)
		}
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			resolved = abs
		}
		if _, err := newPathFilter(r.Include, r.Exclude); err != nil {
			return nil, fmt.Errorf("library: root %q: %v", r.Mount, err)
		}
		out = append(out, Root{Mount: r.Mount, Path: r.Path, Abs: resolved, Include: append([]string(nil), r.Include...), Exclude: append([]string(nil), r.Exclude...)})
	}
	// Filesystem overlap after symlink resolution.
	for i := range out {
		for j := range out {
			if i == j {
				continue
			}
			rel, err := filepath.Rel(out[j].Abs, out[i].Abs)
			if err == nil && (rel == "." || (!strings.HasPrefix(rel, "..") && rel != "..")) {
				// out[i] sits inside out[j].
				return nil, fmt.Errorf("library: roots %q and %q overlap on disk", out[i].Mount, out[j].Mount)
			}
		}
	}
	return out, nil
}

// ScannedFile is one supported file found during a walk.
type ScannedFile struct {
	Root        Root
	AbsPath     string
	VirtualPath string
	Name        string
	Extension   string
	Kind        string
	Size        int64
	MtimeNs     int64
	FileKey     string
	QuickHash   string
	Title       string
	Artist      string
}

// Scan walks every root, infers kind/extension, and returns supported files
// sorted by virtual path. Concurrency bounds parallel stat/hash work; symlink
// directories resolving outside their root are never descended, and files
// resolving outside are skipped.
func Scan(roots []Root, concurrency int) ([]ScannedFile, error) {
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > 64 {
		concurrency = 64
	}
	var mu sync.Mutex
	var files []ScannedFile
	var firstErr error
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var walkErrMu sync.Mutex
	setFirstErr := func(err error) {
		if err == nil {
			return
		}
		walkErrMu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		walkErrMu.Unlock()
	}

	for _, root := range roots {
		root := root
		filter, err := newPathFilter(root.Include, root.Exclude)
		if err != nil {
			return nil, fmt.Errorf("library: root %q: %v", root.Mount, err)
		}
		err = filepath.WalkDir(root.Abs, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				// A partial snapshot must never reconcile as authoritative: a
				// transient permission or I/O error would otherwise look like
				// deletion and erase catalog/queue state.
				setFirstErr(fmt.Errorf("library: walk %q: %w", root.Mount, err))
				return nil
			}
			// Never follow a symlinked directory outside its root.
			if d.IsDir() {
				if p != root.Abs && strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				if d.Type()&os.ModeSymlink != 0 || isSymlink(p) {
					resolved, evalErr := filepath.EvalSymlinks(p)
					if evalErr != nil {
						return filepath.SkipDir
					}
					rel, relErr := filepath.Rel(root.Abs, resolved)
					if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
						return filepath.SkipDir
					}
				}
				return nil
			}
			// Skip symlinked files that escape the root; VirtualPathFor
			// enforces this authoritatively below.
			name := d.Name()
			// Skip dotfiles and hidden bookkeeping.
			if strings.HasPrefix(name, ".") {
				return nil
			}
			relative, relErr := filepath.Rel(root.Abs, p)
			if relErr != nil || !filter.allows(filepath.ToSlash(relative)) {
				return nil
			}
			ext := InferExtension(name)
			kind := InferKind(ext)
			if kind == "" {
				return nil // unsupported extension
			}
			virtual, verr := VirtualPathFor(root.Mount, root.Abs, p)
			if verr != nil {
				return nil // escapes root: skip
			}
			// Pin the resolved in-root target in the catalog. Keeping a symlink
			// path would let it be retargeted outside the root after the scan but
			// before source transfer.
			resolvedPath, resolveErr := filepath.EvalSymlinks(p)
			if resolveErr != nil {
				return nil
			}
			sem <- struct{}{}
			wg.Add(1)
			go func(absPath, vPath, fname, fext, fkind string) {
				defer wg.Done()
				defer func() { <-sem }()
				fi, statErr := os.Stat(absPath)
				if statErr != nil {
					setFirstErr(fmt.Errorf("library: stat %q: %w", vPath, statErr))
					return
				}
				if fi.IsDir() {
					return
				}
				size := fi.Size()
				mtimeNs := fi.ModTime().UnixNano()
				fkey := FileKeyFor(absPath, fi)
				qh := QuickContentHash(absPath)
				title, artist := InferTitleArtist(fname)
				mu.Lock()
				files = append(files, ScannedFile{
					Root: root, AbsPath: absPath, VirtualPath: vPath,
					Name: fname, Extension: fext, Kind: fkind,
					Size: size, MtimeNs: mtimeNs, FileKey: fkey,
					QuickHash: qh, Title: title, Artist: artist,
				})
				mu.Unlock()
			}(resolvedPath, virtual, name, ext, kind)
			return nil
		})
		if err != nil {
			setFirstErr(err)
		}
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	sort.Slice(files, func(i, j int) bool { return files[i].VirtualPath < files[j].VirtualPath })
	return files, nil
}

func isSymlink(p string) bool {
	fi, err := os.Lstat(p)
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeSymlink != 0
}
