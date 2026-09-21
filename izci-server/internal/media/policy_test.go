package media

import (
	"testing"
)

func TestPolicyModes(t *testing.T) {
	always := Policy{Mode: ModeAlways, MaxBytes: 100}
	if always.ModeFor("stream", 1000) != "source-file" {
		t.Errorf("always stream")
	}
	if always.ModeFor("module", 1<<30) != "source-file" {
		t.Errorf("always module huge")
	}
	if always.ModeFor("video", 100) != "source-file" {
		t.Errorf("always video")
	}
	if always.ModeFor("image", 100) != "none" {
		t.Errorf("always image must be none")
	}
	never := Policy{Mode: ModeNever}
	if never.ModeFor("stream", 10) != "none" {
		t.Errorf("never must refuse even small files")
	}
	if never.ModeFor("module", 10) != "none" {
		t.Errorf("never module")
	}
	th := Policy{Mode: ModeThreshold, MaxBytes: 100}
	if th.ModeFor("stream", 50) != "source-file" {
		t.Errorf("threshold under")
	}
	if th.ModeFor("stream", 100) != "source-file" {
		t.Errorf("threshold at boundary transfers")
	}
	if th.ModeFor("stream", 101) != "none" {
		t.Errorf("threshold over must be none (no renderer in Phase 2)")
	}
	if th.ModeFor("image", 10) != "none" {
		t.Errorf("threshold image none")
	}
	if (Policy{}).ModeFor("stream", 10) != "none" {
		t.Errorf("unknown mode must be none, never silently transfer")
	}
}

func TestProbeNeverFails(t *testing.T) {
	d := Probe()
	if d.HivelyVersion == "" {
		t.Fatalf("built-in Hively version must be reported")
	}
	_ = d.RenderAvailable()
	_ = d.Describe()
	if len(d.SourceTransferServiceable()) == 0 {
		t.Fatalf("must list source-transferable families")
	}
}
