package library

import (
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode"
)

// ValidateGlob checks one root-relative library inclusion pattern. Patterns
// use slash separators, '*' within one path segment, '?' for one character,
// and '**' across directories. Absolute paths, dot segments, character
// classes, and escapes are rejected to keep configuration portable.
func ValidateGlob(pattern string) error {
	if pattern == "" || len(pattern) > 256 {
		return fmt.Errorf("must contain 1-256 characters")
	}
	if strings.HasPrefix(pattern, "/") || strings.HasSuffix(pattern, "/") || strings.Contains(pattern, "\\") {
		return fmt.Errorf("must be a slash-separated relative pattern")
	}
	if strings.ContainsAny(pattern, "[]") {
		return fmt.Errorf("character classes are not supported")
	}
	for _, r := range pattern {
		if unicode.IsControl(r) {
			return fmt.Errorf("must not contain control characters")
		}
	}
	for _, segment := range strings.Split(pattern, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("must not contain empty or dot segments")
		}
	}
	return nil
}

type pathFilter struct {
	include []*regexp.Regexp
	exclude []*regexp.Regexp
}

func newPathFilter(include, exclude []string) (*pathFilter, error) {
	f := &pathFilter{}
	var err error
	f.include, err = compileGlobs(include)
	if err != nil {
		return nil, err
	}
	f.exclude, err = compileGlobs(exclude)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func compileGlobs(patterns []string) ([]*regexp.Regexp, error) {
	out := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		if err := ValidateGlob(pattern); err != nil {
			return nil, fmt.Errorf("invalid glob %q: %w", pattern, err)
		}
		expr := globRegexp(pattern)
		re, err := regexp.Compile(expr)
		if err != nil {
			return nil, fmt.Errorf("invalid glob %q: %w", pattern, err)
		}
		out = append(out, re)
	}
	return out, nil
}

func globRegexp(pattern string) string {
	var b strings.Builder
	runes := []rune(pattern)
	// A pattern without a slash applies to a basename anywhere in the root.
	if !strings.Contains(pattern, "/") {
		b.WriteString(`^(?:.*/)?`)
	} else {
		b.WriteByte('^')
	}
	for i := 0; i < len(runes); i++ {
		switch runes[i] {
		case '*':
			if i+1 < len(runes) && runes[i+1] == '*' {
				i++
				if i+1 < len(runes) && runes[i+1] == '/' {
					i++
					b.WriteString(`(?:.*/)?`)
				} else {
					b.WriteString(`.*`)
				}
			} else {
				b.WriteString(`[^/]*`)
			}
		case '?':
			b.WriteString(`[^/]`)
		default:
			b.WriteString(regexp.QuoteMeta(string(runes[i])))
		}
	}
	b.WriteByte('$')
	return b.String()
}

func (f *pathFilter) allows(relativePath string) bool {
	relativePath = path.Clean(strings.TrimPrefix(relativePath, "/"))
	included := len(f.include) == 0
	for _, re := range f.include {
		if re.MatchString(relativePath) {
			included = true
			break
		}
	}
	if !included {
		return false
	}
	for _, re := range f.exclude {
		if re.MatchString(relativePath) {
			return false
		}
	}
	return true
}
