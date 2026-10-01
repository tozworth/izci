package desktopserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestPipeLifetimeAndGuestDiscovery(t *testing.T) {
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()
	input, parent := io.Pipe()
	output, child := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- Run(input, child); _ = child.Close() }()
	defer parent.Close()
	options := Options{Port: uint16(port), PublicURL: "http://192.168.1.42:8787", IceURLs: []string{}, AllowedOrigins: []string{}}
	if err := json.NewEncoder(parent).Encode(options); err != nil {
		t.Fatal(err)
	}
	var ready Ready
	if err := json.NewDecoder(output).Decode(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.SessionToken == "" || ready.Mapping != "off" || ready.PublicEndpoint != options.PublicURL {
		t.Fatal("incomplete private readiness record")
	}
	client := http.Client{Timeout: 2 * time.Second}
	// Only non-secret info is available publicly; bootstrap has no public URL.
	response, err := client.Get(ready.Endpoint + "/v1/info")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatal(response.StatusCode)
	}
	_ = response.Body.Close()
	response, err = client.Post(ready.Endpoint+"/v1/host/sessions", "application/json", strings.NewReader(`{"hostKey":"`+strings.Repeat("a", 64)+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatal("public host login was enabled")
	}
	_ = response.Body.Close()
	// The private pipe bearer uses the existing browser host protocol.
	request, _ := http.NewRequest(http.MethodPost, ready.Endpoint+"/v1/rooms", strings.NewReader(`{"capacity":4}`))
	request.Header.Set("Authorization", "Bearer "+ready.SessionToken)
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		t.Fatal("owner could not create room:", response.StatusCode)
	}
	_ = response.Body.Close()
	_ = parent.Close()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("server survived parent pipe closure")
	}
	if response, err := client.Get(ready.Endpoint + "/v1/info"); err == nil {
		response.Body.Close()
		t.Fatal("server still reachable after stop")
	}
}

func TestBootstrapRejectsInvalidConfiguration(t *testing.T) {
	for _, input := range []string{
		`{"port":0}`, `{"port":8787,"unknown":true}`, `{"port":8787} {}`,
		`{"port":8787,"publicUrl":"http://user:secret@host"}`,
		`{"port":8787,"allowedOrigins":["*"]}`, `{"port":8787,"iceUrls":["turn:host"]}`,
	} {
		if err := Run(strings.NewReader(input+"\n"), &bytes.Buffer{}); err == nil {
			t.Fatal("accepted invalid bootstrap")
		}
	}
}
