// Package config 集中读取工作流的运行配置。
//
// 设计原则：所有配置来自环境变量，默认值保证“本地开发可直接跑”；生产必须显式
// 设置 AUTH_MODE=enforce、OIDC_ISSUER、OIDC_AUDIENCE，否则启动时 fail-closed。
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// AuthMode 是认证模式。
//
//   - off：不校验令牌，注入开发身份（仅本地/测试；生产禁止）
//   - optional：带令牌则校验，不带令牌按匿名处理（用于迁移期）
//   - enforce：所有业务请求必须带有效令牌
type AuthMode string

const (
	AuthModeOff      AuthMode = "off"
	AuthModeOptional AuthMode = "optional"
	AuthModeEnforce  AuthMode = "enforce"
)

// Config 是工作流服务的配置。
type Config struct {
	// HTTP
	Addr            string
	ShutdownTimeout time.Duration

	// Auth / OIDC
	AuthMode        AuthMode
	OIDCIssuer      string
	OIDCAudience    string
	OIDCJWKSURL     string // 可选；为空时从 issuer 的 discovery 解析
	OIDCUserInfoURL string // 可选；access token 无 groups 时用 userinfo 补齐
	OIDCLeeway      time.Duration
	OIDCHTTPTimeout time.Duration

	// ark-iam 只读目录（M2M，API Key 换 token）
	DirectoryBaseURL      string
	DirectoryTokenURL     string
	DirectoryAPIKey       string
	DirectoryResource     string
	DirectoryTimeout      time.Duration
	DirectoryAPIKeyHeader bool

	// 附件本地存储（生产应替换为对象存储）
	AttachmentDir      string
	AttachmentMaxBytes int64
	TaskSLAHours       int64
	WebhookURL         string
	WebhookTimeout     time.Duration

	// 开发身份（仅 AuthMode=off/optional 且未带令牌时使用）
	DevTenantID string
	DevUserID   string
	DevRoles    []string

	// Feature flags（渐进式上线）
	FeatureVersioned bool
	FeatureForms     bool
	FeatureOutbox    bool
}

// Load 从环境变量读取配置。
func Load() Config {
	cfg := Config{
		Addr:                  env("EASY_WORKFLOW_API_ADDR", ":8180"),
		ShutdownTimeout:       durationEnv("EASY_WORKFLOW_SHUTDOWN_TIMEOUT", 10*time.Second),
		AuthMode:              AuthMode(strings.ToLower(env("EASY_WORKFLOW_AUTH_MODE", string(AuthModeOff)))),
		OIDCIssuer:            strings.TrimRight(env("EASY_WORKFLOW_OIDC_ISSUER", ""), "/"),
		OIDCAudience:          env("EASY_WORKFLOW_OIDC_AUDIENCE", ""),
		OIDCJWKSURL:           env("EASY_WORKFLOW_OIDC_JWKS_URL", ""),
		OIDCLeeway:            durationEnv("EASY_WORKFLOW_OIDC_LEEWAY", 30*time.Second),
		OIDCHTTPTimeout:       durationEnv("EASY_WORKFLOW_OIDC_HTTP_TIMEOUT", 5*time.Second),
		DirectoryBaseURL:      strings.TrimRight(env("EASY_WORKFLOW_DIRECTORY_BASE_URL", ""), "/"),
		DirectoryTokenURL:     env("EASY_WORKFLOW_DIRECTORY_TOKEN_URL", ""),
		DirectoryAPIKey:       env("EASY_WORKFLOW_DIRECTORY_API_KEY", ""),
		DirectoryResource:     env("EASY_WORKFLOW_DIRECTORY_RESOURCE", ""),
		DirectoryTimeout:      durationEnv("EASY_WORKFLOW_DIRECTORY_TIMEOUT", 5*time.Second),
		DirectoryAPIKeyHeader: boolEnv("EASY_WORKFLOW_DIRECTORY_API_KEY_HEADER", false),
		AttachmentDir:         env("EASY_WORKFLOW_ATTACHMENT_DIR", "./data/attachments"),
		AttachmentMaxBytes:    int64Env("EASY_WORKFLOW_ATTACHMENT_MAX_MB", 20) << 20,
		TaskSLAHours:          int64Env("EASY_WORKFLOW_TASK_SLA_HOURS", 48),
		WebhookURL:            env("EASY_WORKFLOW_WEBHOOK_URL", ""),
		WebhookTimeout:        durationEnv("EASY_WORKFLOW_WEBHOOK_TIMEOUT", 5*time.Second),
		DevTenantID:           env("EASY_WORKFLOW_DEV_TENANT", "default"),
		DevUserID:             env("EASY_WORKFLOW_DEV_USER", "dev"),
		DevRoles:              listEnv("EASY_WORKFLOW_DEV_ROLES", []string{"workflow_admin"}),
		FeatureVersioned:      boolEnv("EASY_WORKFLOW_FEATURE_VERSIONED", false),
		FeatureForms:          boolEnv("EASY_WORKFLOW_FEATURE_FORMS", false),
		FeatureOutbox:         boolEnv("EASY_WORKFLOW_FEATURE_OUTBOX", false),
	}
	if cfg.AuthMode == "" {
		cfg.AuthMode = AuthModeOff
	}
	if cfg.OIDCUserInfoURL == "" && cfg.OIDCIssuer != "" {
		cfg.OIDCUserInfoURL = strings.TrimRight(cfg.OIDCIssuer, "/") + "/userinfo"
	}
	return cfg
}

// Validate 在启动时做 fail-closed 校验。
func (c Config) Validate() error {
	switch c.AuthMode {
	case AuthModeOff, AuthModeOptional, AuthModeEnforce:
	default:
		return &ConfigError{Field: "EASY_WORKFLOW_AUTH_MODE", Reason: "must be off|optional|enforce"}
	}
	if c.AuthMode == AuthModeEnforce {
		if c.OIDCIssuer == "" {
			return &ConfigError{Field: "EASY_WORKFLOW_OIDC_ISSUER", Reason: "required when AUTH_MODE=enforce"}
		}
		if c.OIDCAudience == "" {
			return &ConfigError{Field: "EASY_WORKFLOW_OIDC_AUDIENCE", Reason: "required when AUTH_MODE=enforce"}
		}
	}
	if c.ShutdownTimeout <= 0 {
		c.ShutdownTimeout = 10 * time.Second
	}
	if c.OIDCHTTPTimeout <= 0 {
		c.OIDCHTTPTimeout = 5 * time.Second
	}
	set := 0
	for _, v := range []string{c.DirectoryBaseURL, c.DirectoryTokenURL, c.DirectoryAPIKey, c.DirectoryResource} {
		if strings.TrimSpace(v) != "" {
			set++
		}
	}
	if set > 0 && set < 4 {
		return &ConfigError{Field: "EASY_WORKFLOW_DIRECTORY_*", Reason: "base url/token url/api key/resource must be set together"}
	}
	if c.DirectoryTimeout <= 0 {
		c.DirectoryTimeout = 5 * time.Second
	}
	if c.AttachmentMaxBytes <= 0 {
		c.AttachmentMaxBytes = 20 << 20
	}
	if c.TaskSLAHours <= 0 {
		c.TaskSLAHours = 48
	}
	if c.WebhookTimeout <= 0 {
		c.WebhookTimeout = 5 * time.Second
	}
	if strings.TrimSpace(c.AttachmentDir) == "" {
		c.AttachmentDir = "./data/attachments"
	}
	return nil
}

// IsEnforced 返回是否强制认证。
func (c Config) IsEnforced() bool { return c.AuthMode == AuthModeEnforce }

// ConfigError 是配置错误。
type ConfigError struct {
	Field  string
	Reason string
}

func (e *ConfigError) Error() string {
	return "config " + e.Field + ": " + e.Reason
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return fallback
}

func int64Env(key string, fallback int64) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return v
}

func boolEnv(key string, fallback bool) bool {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func listEnv(key string, fallback []string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}
