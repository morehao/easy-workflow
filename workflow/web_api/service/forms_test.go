package service

import "testing"

func testSchema() FormSchema {
	min := 1.0
	maxLen := 20
	return FormSchema{Fields: []FormField{
		{Name: "days", Label: "天数", Type: "number", Required: true, Min: &min},
		{Name: "reason", Label: "事由", Type: "textarea", Required: true, MaxLength: &maxLen},
		{Name: "kind", Label: "类型", Type: "select", Required: true, Options: []string{"annual", "personal"}},
		{Name: "start", Label: "开始日期", Type: "date", Required: true},
	}}
}

func TestValidateFormSchemaAndData(t *testing.T) {
	s := testSchema()
	if err := validateFormSchema(s); err != nil {
		t.Fatal(err)
	}
	ok := `{"days":2,"reason":"回家","kind":"annual","start":"2026-10-21"}`
	if err := validateFormData(s, ok); err != nil {
		t.Fatalf("valid data rejected: %v", err)
	}
	bad := []string{
		`{"days":2,"reason":"回家","kind":"annual"}`,
		`{"days":0,"reason":"回家","kind":"annual","start":"2026-10-21"}`,
		`{"days":2,"reason":"回家","kind":"other","start":"2026-10-21"}`,
		`{"days":2,"reason":"回家","kind":"annual","start":"2026/10/21"}`,
		`{"days":2,"reason":"回家","kind":"annual","start":"2026-10-21","extra":1}`,
	}
	for _, raw := range bad {
		if err := validateFormData(s, raw); err == nil {
			t.Fatalf("expected error for %s", raw)
		}
	}
}

func TestValidateFormSchemaInvalid(t *testing.T) {
	cases := []FormSchema{
		{},
		{Fields: []FormField{{Name: "1bad", Label: "x", Type: "text"}}},
		{Fields: []FormField{{Name: "a", Label: "x", Type: "text"}, {Name: "a", Label: "y", Type: "text"}}},
		{Fields: []FormField{{Name: "a", Label: "x", Type: "unknown"}}},
		{Fields: []FormField{{Name: "a", Label: "x", Type: "select"}}},
	}
	for _, s := range cases {
		if err := validateFormSchema(s); err == nil {
			t.Fatalf("expected invalid schema: %+v", s)
		}
	}
}
