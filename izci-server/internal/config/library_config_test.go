package config

import (
	"testing"
)

func TestLibraryRootsValidation(t *testing.T) {
	valid := `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/data/music","include":["**/*.mp3","*.flac"],"exclude":["drafts/**"]}],"scanConcurrency":4}}`
	if _, err := Load([]byte(valid)); err != nil {
		t.Fatalf("valid roots: %v", err)
	}
	cases := []struct {
		name string
		doc  string
	}{
		{"duplicate-mount", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/a"},{"name":"music","path":"/b"}]}}`},
		{"case-overlap", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"Music","path":"/a"},{"name":"music","path":"/b"}]}}`},
		{"prefix-overlap", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/a"},{"name":"music/rock","path":"/b"}]}}`},
		{"case-prefix-overlap", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"Music","path":"/a"},{"name":"music/rock","path":"/b"}]}}`},
		{"fs-overlap", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"a","path":"/data/music"},{"name":"b","path":"/data/music/sub"}]}}`},
		{"bad-name", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"bad name!","path":"/a"}]}}`},
		{"empty-path", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":""}]}}`},
		{"absolute-include", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/a","include":["/music/**"]}]}}`},
		{"dot-exclude", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/a","exclude":["../secret/**"]}]}}`},
		{"duplicate-pattern", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[{"name":"music","path":"/a","include":["**","**"]}]}}`},
		{"bad-concurrency", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"scanConcurrency":0}}`},
		{"too-many-roots", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[` + repeatRoot(65) + `]}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Load([]byte(tc.doc)); err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func repeatRoot(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ","
		}
		s += `{"name":"r` + itoa(i) + `","path":"/p` + itoa(i) + `"}`
	}
	return s
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for i > 0 {
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	return s
}

func TestSourceTransferValidation(t *testing.T) {
	if _, err := Load([]byte(`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"always","maxBytes":100}}`)); err != nil {
		t.Fatalf("always: %v", err)
	}
	if _, err := Load([]byte(`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"threshold","maxBytes":1024}}`)); err != nil {
		t.Fatalf("threshold: %v", err)
	}
	for _, doc := range []string{
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"sometimes","maxBytes":100}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"threshold","maxBytes":0}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"always","maxBytes":-1}}`,
	} {
		if _, err := Load([]byte(doc)); err == nil {
			t.Errorf("expected error for %s", doc)
		}
	}
}

func TestCatalogValidation(t *testing.T) {
	if _, err := Load([]byte(`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","catalog":{"maxItemsPerCollection":100,"maxTotalItems":200}}`)); err != nil {
		t.Fatalf("valid catalog: %v", err)
	}
	for _, doc := range []string{
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","catalog":{"maxItemsPerCollection":0,"maxTotalItems":100}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","catalog":{"maxItemsPerCollection":100,"maxTotalItems":999999}}`,
	} {
		if _, err := Load([]byte(doc)); err == nil {
			t.Errorf("expected error for %s", doc)
		}
	}
}

func TestUnknownFieldsRejected(t *testing.T) {
	for _, doc := range []string{
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","library":{"roots":[],"bogus":1}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","sourceTransfer":{"mode":"always","maxBytes":1,"bogus":1}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","database":{"path":"x","bogus":1}}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","catalog":{"maxItemsPerCollection":1,"maxTotalItems":1,"bogus":1}}`,
	} {
		if _, err := Load([]byte(doc)); err == nil {
			t.Errorf("expected unknown-field error for %s", doc)
		}
	}
}
