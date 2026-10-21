package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func testEngine(mode string, verifier *Verifier) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(Middleware(MiddlewareConfig{
		Mode:        mode,
		Verifier:    verifier,
		DevIdentity: &Identity{TenantID: "dev-tenant", UserID: "dev-user", Source: "dev", Groups: []string{"workflow_admin"}},
	}))
	e.GET("/process/who", func(c *gin.Context) {
		id := Current(c)
		c.JSON(http.StatusOK, gin.H{
			"tenant": id.TenantID, "user": id.UserID, "auth": id.IsAuthenticated(),
			"source": id.Source, "groups": id.Groups,
		})
	})
	e.GET("/process/admin", RequirePermission(PermAdmin), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	e.GET("/process/act", RequirePermission(PermTaskAct), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	e.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	return e
}

func do(e *gin.Engine, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func TestMiddlewareOffInjectsDevIdentity(t *testing.T) {
	e := testEngine("off", nil)
	w := do(e, "/process/who", "")
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["user"] != "dev-user" || body["tenant"] != "dev-tenant" {
		t.Fatalf("unexpected dev identity: %v", body)
	}
}

func TestMiddlewareEnforceRejectsAnonymous(t *testing.T) {
	e := testEngine("enforce", nil)
	w := do(e, "/process/who", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without token, got %d", w.Code)
	}
	// 有令牌但没配验签器：必须 fail-closed 503，不能当成 401/放行。
	if w := do(e, "/process/who", "not-a-jwt"); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when verifier missing, got %d", w.Code)
	}
}

func TestMiddlewareEnforceValidTokenAndPermissions(t *testing.T) {
	key := newTestKey(t)
	srv := jwksServer(t, key, "kid-1")
	v := testVerifier(t, srv.URL)
	e := testEngine("enforce", v)
	token := signTestToken(t, key, "kid-1", baseClaims())

	w := do(e, "/process/who", token)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["tenant"] != "t-1" || body["user"] != "u-1" {
		t.Fatalf("unexpected identity: %v", body)
	}

	// workflow_approver 没有 workflow.admin，但可以审批任务。
	if w := do(e, "/process/act", token); w.Code != http.StatusOK {
		t.Fatalf("approver should have task.act, got %d", w.Code)
	}
	if w := do(e, "/process/admin", token); w.Code != http.StatusForbidden {
		t.Fatalf("approver should not be admin, got %d", w.Code)
	}
}

func TestMiddlewareSkipsHealth(t *testing.T) {
	e := testEngine("enforce", nil)
	if w := do(e, "/healthz", ""); w.Code != http.StatusOK {
		t.Fatalf("healthz should be skipped, got %d", w.Code)
	}
}
