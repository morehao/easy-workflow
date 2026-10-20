package auth

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// MiddlewareConfig 是 Gin 认证中间件配置。
type MiddlewareConfig struct {
	// Mode: off / optional / enforce。
	Mode string
	// Verifier 为空时，enforce 模式下所有请求 503（fail-closed），不会裸奔。
	Verifier *Verifier
	// DevIdentity 在 off 模式或 optional 模式无令牌时注入；可为 nil。
	DevIdentity *Identity
	// SkipPaths 是不做认证的路径前缀（健康检查/Swagger/静态资源）。
	SkipPaths []string
}

// Middleware 返回 Gin 认证中间件。
func Middleware(cfg MiddlewareConfig) gin.HandlerFunc {
	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	if mode == "" {
		mode = "off"
	}
	skips := cfg.SkipPaths
	if len(skips) == 0 {
		skips = []string{"/healthz", "/readyz", "/swagger", "/favicon.ico"}
	}
	return func(c *gin.Context) {
		if shouldSkip(c.Request.URL.Path, skips) {
			c.Next()
			return
		}
		raw := bearer(c.GetHeader("Authorization"))
		if raw == "" {
			switch mode {
			case "enforce":
				abortJSON(c, http.StatusUnauthorized, "WF_UNAUTHENTICATED", "missing bearer token")
				return
			case "optional":
				setIdentity(c, Anonymous())
				c.Next()
				return
			default: // off
				id := cfg.DevIdentity
				if id == nil {
					id = &Identity{TenantID: "default", UserID: "dev", Source: "dev", Groups: []string{"workflow_admin"}}
				}
				setIdentity(c, id)
				c.Next()
				return
			}
		}

		if cfg.Verifier == nil {
			// 有令牌但没有验签器：enforce 下 fail-closed；optional 下也拒绝，避免“看似认证”。
			abortJSON(c, http.StatusServiceUnavailable, "WF_AUTH_UNAVAILABLE", "token verifier is not configured")
			return
		}
		id, err := cfg.Verifier.Verify(c.Request.Context(), raw)
		if err == nil && id != nil && !id.IsMachine && len(id.Groups) == 0 && cfg.Verifier.cfg.UserInfoURL != "" {
			info, uerr := cfg.Verifier.UserInfo(c.Request.Context(), raw)
			if uerr != nil {
				abortJSON(c, http.StatusServiceUnavailable, "WF_USERINFO_UNAVAILABLE", "userinfo endpoint unavailable")
				return
			}
			id.Groups = stringSlice(info["groups"])
		}
		if err != nil {
			status := http.StatusUnauthorized
			code := "WF_INVALID_TOKEN"
			msg := "invalid or expired token"
			if errors.Is(err, ErrKeyUnavailable) {
				status = http.StatusServiceUnavailable
				code = "WF_AUTH_UNAVAILABLE"
				msg = "authentication key source unavailable"
			}
			abortJSON(c, status, code, msg)
			return
		}
		setIdentity(c, id)
		c.Next()
	}
}

// RequireAuthenticated 要求有效身份。
func RequireAuthenticated() gin.HandlerFunc {
	return func(c *gin.Context) {
		if id := Current(c); !id.IsAuthenticated() {
			abortJSON(c, http.StatusUnauthorized, "WF_UNAUTHENTICATED", "authentication required")
			return
		}
		c.Next()
	}
}

// RequirePermission 要求指定权限。
func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := Current(c)
		if !id.IsAuthenticated() {
			abortJSON(c, http.StatusUnauthorized, "WF_UNAUTHENTICATED", "authentication required")
			return
		}
		if !id.Can(permission) {
			abortJSON(c, http.StatusForbidden, "WF_FORBIDDEN", "permission denied")
			return
		}
		c.Next()
	}
}

// RequirePerson 要求自然人身份（机器凭证不能执行审批动作）。
func RequirePerson() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := Current(c)
		if !id.IsPerson() {
			abortJSON(c, http.StatusForbidden, "WF_PERSON_REQUIRED", "a person identity is required")
			return
		}
		c.Next()
	}
}

// RequireTenant 要求令牌携带 tenant_id。
func RequireTenant() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := Current(c)
		if !id.IsAuthenticated() {
			abortJSON(c, http.StatusUnauthorized, "WF_UNAUTHENTICATED", "authentication required")
			return
		}
		if id.TenantID == "" {
			abortJSON(c, http.StatusForbidden, "WF_TENANT_REQUIRED", "tenant scope is required")
			return
		}
		c.Next()
	}
}

// Current 从 Gin context 取身份。
func Current(c *gin.Context) *Identity {
	if c == nil {
		return Anonymous()
	}
	if id, ok := c.Get("identity"); ok {
		if v, ok := id.(*Identity); ok && v != nil {
			return v
		}
	}
	if id := FromContext(c.Request.Context()); id != nil {
		return id
	}
	return Anonymous()
}

func setIdentity(c *gin.Context, id *Identity) {
	if id == nil {
		id = Anonymous()
	}
	c.Set("identity", id)
	c.Request = c.Request.WithContext(WithIdentity(c.Request.Context(), id))
}

func bearer(header string) string {
	header = strings.TrimSpace(header)
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return ""
}

func shouldSkip(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if p == "" {
			continue
		}
		if path == p || strings.HasPrefix(path, strings.TrimRight(p, "/")+"/") {
			return true
		}
	}
	return false
}

func abortJSON(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{
		"code":    code,
		"message": message,
	})
}
