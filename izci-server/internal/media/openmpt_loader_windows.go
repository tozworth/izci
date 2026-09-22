package media

import "golang.org/x/sys/windows"

var openmptLibraryNames = []string{"libopenmpt.dll"}

func openOpenMPTLibrary(name string) (uintptr, error) {
	handle, err := windows.LoadLibrary(name)
	return uintptr(handle), err
}
