package desktopserver

import (
	"context"
	"errors"
	"testing"

	"github.com/huin/goupnp"
	"github.com/huin/goupnp/soap"
)

type fakeGateway struct {
	exists                bool
	port                  uint16
	local, description    string
	lease                 uint32
	adds, deletes         int
	lookupError, addError error
}

func (g *fakeGateway) GetServiceClient() *goupnp.ServiceClient { return nil }
func (g *fakeGateway) GetExternalIPAddressCtx(context.Context) (string, error) {
	return "203.0.113.42", nil
}
func (g *fakeGateway) GetSpecificPortMappingEntryCtx(context.Context, string, uint16, string) (uint16, string, bool, string, uint32, error) {
	if g.lookupError != nil {
		return 0, "", false, "", 0, g.lookupError
	}
	if !g.exists {
		fault := &soap.SOAPFaultError{}
		fault.Detail.UPnPError.Errorcode = 714
		return 0, "", false, "", 0, fault
	}
	return g.port, g.local, true, g.description, g.lease, nil
}
func (g *fakeGateway) AddPortMappingCtx(_ context.Context, _ string, _ uint16, protocol string, port uint16, local string, _ bool, description string, lease uint32) error {
	if protocol != "TCP" {
		return errors.New("wrong protocol")
	}
	g.adds++
	if g.addError != nil {
		return g.addError
	}
	g.exists, g.port, g.local, g.description, g.lease = true, port, local, description, lease
	return nil
}
func (g *fakeGateway) DeletePortMappingCtx(context.Context, string, uint16, string) error {
	g.deletes++
	g.exists = false
	return nil
}

func TestUPnPMappingLeaseAndCleanup(t *testing.T) {
	gateway := &fakeGateway{}
	mapped, cleanup, err := mapGateway(context.Background(), context.Background(), gateway, 8787, "192.168.1.42")
	if err != nil {
		t.Fatal(err)
	}
	if mapped != "http://203.0.113.42:8787" || gateway.lease != 120 || gateway.adds != 1 {
		t.Fatal("unexpected mapping")
	}
	cleanup()
	if gateway.deletes != 1 || gateway.exists {
		t.Fatal("owned mapping was not removed")
	}
}

func TestUPnPNeverOverwritesOrDeletesForeignMappings(t *testing.T) {
	for _, gateway := range []*fakeGateway{{exists: true}, {lookupError: errors.New("router unreachable")}, {addError: errors.New("finite leases unsupported")}} {
		if _, _, err := mapGateway(context.Background(), context.Background(), gateway, 8787, "192.168.1.42"); err == nil {
			t.Fatal("unexpected mapping success")
		}
		if gateway.deletes != 0 {
			t.Fatal("removed a foreign mapping")
		}
		if gateway.addError == nil && gateway.adds != 0 {
			t.Fatal("overwrote an existing or unverified mapping")
		}
	}
	gateway := &fakeGateway{}
	_, cleanup, err := mapGateway(context.Background(), context.Background(), gateway, 8787, "192.168.1.42")
	if err != nil {
		t.Fatal(err)
	}
	gateway.description = "another application"
	cleanup()
	if gateway.deletes != 0 {
		t.Fatal("removed a replaced mapping")
	}
}
