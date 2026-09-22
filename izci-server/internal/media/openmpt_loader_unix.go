//go:build !windows

package media

import "github.com/ebitengine/purego"

var openmptLibraryNames = []string{"libopenmpt.so.0", "libopenmpt.so"}

func openOpenMPTLibrary(name string) (uintptr, error) {
	return purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_GLOBAL)
}
