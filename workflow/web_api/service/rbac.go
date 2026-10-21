package service

import (
	"net/http"
	"sort"
	"strings"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

const rolePermissionNone = "__none__"

// ResolveRolePermission 是 auth.PermissionResolver 的 DB 实现。
// 某个角色在 wf_role_permission 中有行时以 DB 为准；没有行时回退默认映射。
func ResolveRolePermission(tenantID string, groups []string, permission string) (bool, bool) {
	if tenantID == "" || len(groups) == 0 || permission == "" {
		return false, false
	}
	var rows []database.RolePermission
	if err := DB.Where("tenant_id=? AND role IN ?", tenantID, groups).Find(&rows).Error; err != nil {
		// DB 故障时回退默认映射，不让权限服务整体不可用。
		return false, false
	}
	if len(rows) == 0 {
		return false, false
	}
	byRole := make(map[string][]string, len(groups))
	for _, r := range rows {
		byRole[r.Role] = append(byRole[r.Role], r.Permission)
	}
	for _, g := range groups {
		perms, configured := byRole[g]
		if !configured {
			perms = auth.DefaultRolePermissions[g]
		}
		for _, p := range perms {
			if p == rolePermissionNone {
				continue
			}
			if p == "*" || p == permission {
				return true, true
			}
		}
	}
	return false, true
}

func normalizeRolePermissions(raw []string) ([]string, bool) {
	seen := map[string]bool{}
	out := make([]string, 0, len(raw))
	valid := map[string]bool{"*": true, rolePermissionNone: true}
	for _, p := range auth.AllPermissions {
		valid[p] = true
	}
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] || !valid[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	sort.Strings(out)
	return out, len(out) > 0
}

// RolePermission_Get GET /admin/role-permissions?role=workflow_approver
func RolePermission_Get(c *gin.Context) {
	if _, ok := requirePermission(c, auth.PermAdmin); !ok {
		return
	}
	role := strings.TrimSpace(c.Query("role"))
	if role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "WF_BAD_REQUEST", "message": "role is required"})
		return
	}
	var rows []database.RolePermission
	_ = DB.Where("tenant_id=? AND role=?", currentIdentity(c).TenantID, role).Find(&rows).Error
	perms := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Permission != rolePermissionNone {
			perms = append(perms, r.Permission)
		}
	}
	configured := len(rows) > 0
	if !configured {
		perms = append(perms, auth.DefaultRolePermissions[role]...)
	}
	sort.Strings(perms)
	c.JSON(http.StatusOK, gin.H{"role": role, "configured": configured, "permissions": perms})
}

// RolePermission_Put PUT /admin/role-permissions
// form: role=workflow_approver&permissions=workflow.task.act,workflow.instance.start
// 传空 permissions 表示该角色没有任何权限；DELETE 可恢复默认。
func RolePermission_Put(c *gin.Context) {
	if _, ok := requirePermission(c, auth.PermAdmin); !ok {
		return
	}
	role := strings.TrimSpace(c.PostForm("role"))
	if role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "WF_BAD_REQUEST", "message": "role is required"})
		return
	}
	raw := strings.Split(c.PostForm("permissions"), ",")
	perms, has := normalizeRolePermissions(raw)
	if !has {
		perms = []string{rolePermissionNone}
	}
	tenantID := currentIdentity(c).TenantID
	tx := DB.Begin()
	if err := tx.Where("tenant_id=? AND role=?", tenantID, role).Delete(&database.RolePermission{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"code": "WF_DB_ERROR", "message": err.Error()})
		return
	}
	for _, p := range perms {
		if err := tx.Create(&database.RolePermission{TenantID: tenantID, Role: role, Permission: p}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "WF_DB_ERROR", "message": err.Error()})
			return
		}
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "WF_DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"role": role, "permissions": perms})
}

// RolePermission_Delete DELETE /admin/role-permissions?role=...
// 删除租户覆盖，恢复 auth.DefaultRolePermissions。
func RolePermission_Delete(c *gin.Context) {
	if _, ok := requirePermission(c, auth.PermAdmin); !ok {
		return
	}
	role := strings.TrimSpace(c.Query("role"))
	if role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "WF_BAD_REQUEST", "message": "role is required"})
		return
	}
	if err := DB.Where("tenant_id=? AND role=?", currentIdentity(c).TenantID, role).Delete(&database.RolePermission{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "WF_DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"role": role, "reset": true})
}
