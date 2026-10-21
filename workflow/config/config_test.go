package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("EASY_WORKFLOW_AUTH_MODE", "")
	t.Setenv("EASY_WORKFLOW_OIDC_ISSUER", "")
	cfg := Load()
	if cfg.AuthMode != AuthModeOff {
		t.Fatalf("default auth mode = %q, want off", cfg.AuthMode)
	}
	if cfg.DevTenantID == "" || cfg.DevUserID == "" {
		t.Fatal("dev identity defaults must not be empty")
	}
	if cfg.ShutdownTimeout <= 0 || cfg.OIDCLeeway <= 0 {
		t.Fatalf("invalid durations: %+v", cfg)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("defaults should validate: %v", err)
	}
}

func TestLoadEnforceRequiresIssuerAndAudience(t *testing.T) {
	t.Setenv("EASY_WORKFLOW_AUTH_MODE", "enforce")
	t.Setenv("EASY_WORKFLOW_OIDC_ISSUER", "")
	t.Setenv("EASY_WORKFLOW_OIDC_AUDIENCE", "")
	cfg := Load()
	if err := cfg.Validate(); err == nil {
		t.Fatal("enforce without issuer/audience must fail")
	}

	t.Setenv("EASY_WORKFLOW_OIDC_ISSUER", "https://iam.example.com/oidc/")
	t.Setenv("EASY_WORKFLOW_OIDC_AUDIENCE", "workflow_web")
	cfg = Load()
	if cfg.OIDCIssuer != "https://iam.example.com/oidc" {
		t.Fatalf("issuer not trimmed: %q", cfg.OIDCIssuer)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("valid enforce config rejected: %v", err)
	}
}

func TestLoadDurationAndList(t *testing.T) {
	t.Setenv("EASY_WORKFLOW_OIDC_LEEWAY", "45s")
	t.Setenv("EASY_WORKFLOW_DEV_ROLES", "workflow_admin, workflow_approver")
	cfg := Load()
	if cfg.OIDCLeeway != 45*time.Second {
		t.Fatalf("leeway = %v", cfg.OIDCLeeway)
	}
	if len(cfg.DevRoles) != 2 || cfg.DevRoles[1] != "workflow_approver" {
		t.Fatalf("roles = %v", cfg.DevRoles)
	}
}
