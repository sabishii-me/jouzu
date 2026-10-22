// Modified for deterministic Unicode conformance and bounded native scanning.
package textguard

import (
	"bytes"
	"testing"

	"golang.org/x/net/idna"
	"golang.org/x/text/unicode/norm"
)

func TestNormalizationDependencyConsumesInvalidUTF8(t *testing.T) {
	// GO-2026-5970: an invalid leading byte followed by a combining mark
	// must advance the iterator rather than loop indefinitely.
	input := "\xf3\xcc\x80"
	for _, form := range []norm.Form{norm.NFC, norm.NFD, norm.NFKC, norm.NFKD} {
		if got := form.PropertiesString(input).Size(); got != 1 {
			t.Fatalf("form %d: invalid byte size = %d, want 1", form, got)
		}
		var iter norm.Iter
		iter.InitString(form, input)
		var got []byte
		for steps := 0; !iter.Done(); steps++ {
			if steps >= len(input) {
				t.Fatalf("form %d: iterator did not finish", form)
			}
			before := iter.Pos()
			got = append(got, iter.Next()...)
			if iter.Pos() <= before {
				t.Fatalf("form %d: iterator did not advance", form)
			}
		}
		if !bytes.Equal(got, []byte(input)) {
			t.Fatalf("form %d: normalized bytes = %x, want %x", form, got, input)
		}
	}
}

func TestIDNADependencyRejectsASCIIOnlyPunycode(t *testing.T) {
	// GO-2026-5026: validation must reject a Punycode label that decodes
	// entirely to ASCII instead of treating it as an alternate hostname.
	profile := idna.New(idna.MapForLookup(), idna.Transitional(true))
	for _, input := range []string{"xn--example-", "xn--example-.com"} {
		if got, err := profile.ToUnicode(input); err == nil {
			t.Errorf("ToUnicode(%q) accepted %q", input, got)
		}
		if got, err := profile.ToASCII(input); err == nil {
			t.Errorf("ToASCII(%q) accepted %q", input, got)
		}
	}
}
