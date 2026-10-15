// Package desktopserver is the pipe-controlled, signaling-only desktop runtime.
// It imports no dedicated host, renderer, database, or media decoder.
package desktopserver

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tozworth/izci/izci-server/internal/config"
	"github.com/tozworth/izci/izci-server/internal/signaling"
)

type Options struct {
	Port           uint16   `json:"port"`
	PublicURL      string   `json:"publicUrl"`
	UPnP           bool     `json:"upnp"`
	IceURLs        []string `json:"iceUrls"`
	AllowedOrigins []string `json:"allowedOrigins"`
}

type Ready struct {
	Endpoint       string   `json:"endpoint"`
	PublicEndpoint string   `json:"publicEndpoint"`
	LANEndpoints   []string `json:"lanEndpoints"`
	SessionToken   string   `json:"sessionToken"`
	Mapping        string   `json:"mapping"`
}

func publicEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || strings.Contains(u.Path, "//") {
		return "", errors.New("invalid advertised address; use http(s)://host:port")
	}
	for _, segment := range strings.Split(u.Path, "/") {
		if segment == "v1" || segment == "." || segment == ".." {
			return "", errors.New("invalid advertised path")
		}
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return "", errors.New("invalid advertised port")
		}
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

func lanEndpoints(port uint16) []string {
	endpoints := []string{}
	addresses, _ := net.InterfaceAddrs()
	for _, address := range addresses {
		ip, _, err := net.ParseCIDR(address.String())
		if err == nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
			endpoints = append(endpoints, "http://"+net.JoinHostPort(ip.String(), strconv.Itoa(int(port))))
		}
	}
	return endpoints
}

// Run reads one bounded strict configuration line, then treats EOF (parent
// death or stop) as cancellation. stdout contains only a private readiness
// record; errors never include request bodies, credentials or signaling data.
func Run(input io.Reader, output io.Writer) error {
	reader := bufio.NewReaderSize(input, 8192)
	line, err := reader.ReadSlice('\n')
	if err != nil {
		return errors.New("missing desktop configuration")
	}
	var options Options
	decoder := json.NewDecoder(strings.NewReader(string(line)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&options); err != nil {
		return errors.New("invalid desktop configuration")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid desktop configuration")
	}
	if options.Port == 0 {
		return errors.New("invalid listen port")
	}
	if len(options.IceURLs) > 16 || len(options.AllowedOrigins) > 16 {
		return errors.New("too many providers or origins")
	}
	for _, origin := range options.AllowedOrigins {
		if _, err := config.NormalizeOrigin(origin); err != nil {
			return errors.New("invalid client origin")
		}
	}
	for _, ice := range options.IceURLs {
		if len(ice) > 256 || !(strings.HasPrefix(ice, "stun:") || strings.HasPrefix(ice, "stuns:")) {
			return errors.New("built-in signaling supports STUN providers only")
		}
	}
	advertised := ""
	if strings.TrimSpace(options.PublicURL) != "" {
		advertised, err = publicEndpoint(options.PublicURL)
		if err != nil {
			return err
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _, _ = io.Copy(io.Discard, reader); cancel() }()
	listener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", options.Port))
	if err != nil {
		return errors.New("listen port is unavailable")
	}
	defer listener.Close()
	local := fmt.Sprintf("http://127.0.0.1:%d", options.Port)
	cfg := config.Default()
	cfg.Listen = listener.Addr().String()
	cfg.PublicBaseURL = local
	cfg.Description = "izci desktop signaling"
	cfg.AllowedOrigins = append([]string{"https://tauri.localhost", "https://izci.xn--ala-hsa.net", "https://izci-pwa.web.app", "https://izci-pwa.firebaseapp.com"}, options.AllowedOrigins...)
	cfg.IceURLs = options.IceURLs
	cfg.Limits.MaxRooms = 1
	cfg.Limits.MaxOpenSockets = 24
	cfg.Limits.HostSessionTTL = config.Duration(365 * 24 * time.Hour)
	cfg.Limits.ShutdownGrace = config.Duration(2 * time.Second)
	server, token, err := signaling.NewOwned(&cfg, log.New(io.Discard, "", 0))
	if err != nil {
		return errors.New("could not initialize signaling")
	}
	lan := lanEndpoints(options.Port)
	if advertised == "" && len(lan) > 0 {
		advertised = lan[0]
	}
	if advertised == "" {
		advertised = local
	}
	mapping := "off"
	if options.UPnP {
		mapped, cleanup, err := mapPort(ctx, options.Port)
		if err != nil {
			mapping = "unavailable"
		} else {
			defer cleanup()
			mapping = "mapped"
			if options.PublicURL == "" {
				advertised = mapped
			}
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	if err := json.NewEncoder(output).Encode(Ready{local, advertised, lan, token, mapping}); err != nil {
		return errors.New("parent pipe closed")
	}
	return server.Serve(ctx, listener)
}
