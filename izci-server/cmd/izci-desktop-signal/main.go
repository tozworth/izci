package main

import (
	"github.com/dunsparce9/izci/izci-server/internal/desktopserver"
	"os"
)

func main() {
	if err := desktopserver.Run(os.Stdin, os.Stdout); err != nil {
		// Only static bootstrap errors, never server logs or credentials.
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
