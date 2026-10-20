package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/model"
	"github.com/gin-gonic/gin"
)

func testContext(id *auth.Identity) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(auth.WithIdentity(req.Context(), id))
	c.Request = req
	c.Set("identity", id)
	return c, w
}

func TestScopedUserID(t *testing.T) {
	approver := &auth.Identity{TenantID: "t1", UserID: "u1", Source: "oidc", Groups: []string{"workflow_approver"}}
	admin := &auth.Identity{TenantID: "t1", UserID: "admin", Source: "oidc", Groups: []string{"workflow_admin"}}

	t.Run("approver own", func(t *testing.T) {
		c, _ := testContext(approver)
		got, ok := scopedUserID(c, "u1")
		if !ok || got != "u1" {
			t.Fatalf("got %q ok=%v", got, ok)
		}
	})
	t.Run("approver empty becomes own", func(t *testing.T) {
		c, _ := testContext(approver)
		got, ok := scopedUserID(c, "")
		if !ok || got != "u1" {
			t.Fatalf("got %q ok=%v", got, ok)
		}
	})
	t.Run("approver other forbidden", func(t *testing.T) {
		c, w := testContext(approver)
		if _, ok := scopedUserID(c, "u2"); ok {
			t.Fatal("expected forbidden")
		}
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", w.Code)
		}
	})
	t.Run("admin can query all", func(t *testing.T) {
		c, _ := testContext(admin)
		got, ok := scopedUserID(c, "")
		if !ok || got != "" {
			t.Fatalf("admin empty should mean all, got %q ok=%v", got, ok)
		}
		got, ok = scopedUserID(c, "u2")
		if !ok || got != "u2" {
			t.Fatalf("admin other got %q ok=%v", got, ok)
		}
	})
}

func TestForceStarterVariable(t *testing.T) {
	approver := &auth.Identity{TenantID: "t1", UserID: "u1", Source: "oidc", Groups: []string{"workflow_approver"}}
	admin := &auth.Identity{TenantID: "t1", UserID: "admin", Source: "oidc", Groups: []string{"workflow_admin"}}

	t.Run("non-admin overwritten", func(t *testing.T) {
		c, _ := testContext(approver)
		raw, err := forceStarterVariable(c, `[{"Key":"days","Value":"3"},{"Key":"starter","Value":"evil"}]`)
		if err != nil {
			t.Fatalf("force: %v", err)
		}
		var vars []model.Variable
		if err := json.Unmarshal([]byte(raw), &vars); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		got := map[string]string{}
		for _, v := range vars {
			got[v.Key] = v.Value
		}
		if got["starter"] != "u1" {
			t.Fatalf("starter = %q, want u1; vars=%v", got["starter"], got)
		}
		if got["days"] != "3" {
			t.Fatalf("days lost: %v", got)
		}
	})
	t.Run("admin keeps explicit starter", func(t *testing.T) {
		c, _ := testContext(admin)
		raw, err := forceStarterVariable(c, `[{"Key":"starter","Value":"u2"}]`)
		if err != nil {
			t.Fatalf("force: %v", err)
		}
		var vars []model.Variable
		_ = json.Unmarshal([]byte(raw), &vars)
		if len(vars) != 1 || vars[0].Value != "u2" {
			t.Fatalf("admin starter changed: %+v", vars)
		}
	})
	t.Run("invalid json", func(t *testing.T) {
		c, _ := testContext(approver)
		if _, err := forceStarterVariable(c, "not-json"); err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestRequirePermission(t *testing.T) {
	viewer := &auth.Identity{TenantID: "t1", UserID: "u1", Source: "oidc", Groups: []string{"workflow_viewer"}}
	designer := &auth.Identity{TenantID: "t1", UserID: "u2", Source: "oidc", Groups: []string{"workflow_designer"}}

	c, w := testContext(viewer)
	if _, ok := requirePermission(c, auth.PermDefWrite); ok {
		t.Fatal("viewer must not have def.write")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}

	c, _ = testContext(designer)
	if _, ok := requirePermission(c, auth.PermDefWrite); !ok {
		t.Fatal("designer should have def.write")
	}
}
