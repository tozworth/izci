package desktopserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"strconv"
	"time"

	"github.com/huin/goupnp"
	"github.com/huin/goupnp/dcps/internetgateway2"
	"github.com/huin/goupnp/soap"
)

type gateway interface {
	GetServiceClient() *goupnp.ServiceClient
	GetExternalIPAddressCtx(context.Context) (string, error)
	GetSpecificPortMappingEntryCtx(context.Context, string, uint16, string) (uint16, string, bool, string, uint32, error)
	AddPortMappingCtx(context.Context, string, uint16, string, uint16, string, bool, string, uint32) error
	DeletePortMappingCtx(context.Context, string, uint16, string) error
}

func mapPort(parent context.Context, port uint16) (string, func(), error) {
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	// Discover all three common IGD service types concurrently within one bound.
	results := make(chan []gateway, 3)
	go func() {
		clients, _, _ := internetgateway2.NewWANIPConnection1ClientsCtx(ctx)
		var out []gateway
		for _, c := range clients {
			out = append(out, c)
		}
		results <- out
	}()
	go func() {
		clients, _, _ := internetgateway2.NewWANIPConnection2ClientsCtx(ctx)
		var out []gateway
		for _, c := range clients {
			out = append(out, c)
		}
		results <- out
	}()
	go func() {
		clients, _, _ := internetgateway2.NewWANPPPConnection1ClientsCtx(ctx)
		var out []gateway
		for _, c := range clients {
			out = append(out, c)
		}
		results <- out
	}()
	for range 3 {
		select {
		case <-ctx.Done():
			return "", nil, errors.New("UPnP unavailable")
		case clients := <-results:
			for _, client := range clients {
				mapped, cleanup, err := mapGateway(ctx, parent, client, port, client.GetServiceClient().LocalAddr().String())
				if err == nil {
					return mapped, cleanup, nil
				}
			}
		}
	}
	return "", nil, errors.New("UPnP unavailable")
}

func mapGateway(ctx, parent context.Context, client gateway, port uint16, local string) (string, func(), error) {
	// Never overwrite an existing mapping, even one for this computer.
	_, _, _, _, _, err := client.GetSpecificPortMappingEntryCtx(ctx, "", port, "TCP")
	var fault *soap.SOAPFaultError
	if !errors.As(err, &fault) || fault.Detail.UPnPError.Errorcode != 714 {
		return "", nil, errors.New("UPnP unavailable")
	}
	ip, err := client.GetExternalIPAddressCtx(ctx)
	if err != nil || net.ParseIP(ip) == nil || net.ParseIP(ip).IsUnspecified() {
		return "", nil, errors.New("UPnP unavailable")
	}
	if net.ParseIP(local) == nil {
		return "", nil, errors.New("UPnP unavailable")
	}
	// Short renewable lease also cleans up after an ungraceful app exit.
	var identifier [8]byte
	if _, err := rand.Read(identifier[:]); err != nil {
		return "", nil, errors.New("UPnP unavailable")
	}
	description := "izci signaling " + hex.EncodeToString(identifier[:])
	ownsMapping := func(ctx context.Context) bool {
		internalPort, internalClient, _, label, _, err := client.GetSpecificPortMappingEntryCtx(ctx, "", port, "TCP")
		return err == nil && internalPort == port && internalClient == local && label == description
	}
	add := func(ctx context.Context) error {
		return client.AddPortMappingCtx(ctx, "", port, "TCP", port, local, true, description, 120)
	}
	if add(ctx) != nil {
		return "", nil, errors.New("UPnP unavailable")
	}
	renewCtx, stop := context.WithCancel(parent)
	done := make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTicker(60 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-timer.C:
				attempt, cancel := context.WithTimeout(renewCtx, 3*time.Second)
				if ownsMapping(attempt) {
					_ = add(attempt)
				}
				cancel()
			}
		}
	}()
	return "http://" + net.JoinHostPort(ip, strconv.Itoa(int(port))), func() {
		stop()
		<-done
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if ownsMapping(ctx) {
			_ = client.DeletePortMappingCtx(ctx, "", port, "TCP")
		}
	}, nil
}
