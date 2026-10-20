// Package auth 提供 OIDC 本地验签、身份上下文与 RBAC 判定。
//
// 依赖纪律：只依赖标准库，不引入 gin/gorm；Gin 中间件在 middleware.go 中单独实现，
// 便于宿主系统复用身份/权限逻辑而不绑定 Web 框架。
package auth

import (
	"context"
	"strings"
)

// Identity 是已验证的调用者身份。
//
// 口径与 ark-iam sdk/rp.Identity 对齐：
//   - TenantID：租户作用域，来自令牌；工作流所有查询必须带它
//   - UserID：tenant_user.id（租户成员主键），写审计的唯一操作者口径
//   - PersonID：自然人 ID（人令牌）
//   - IsMachine：机器凭证（API Key / client_credentials 换 token）
//   - Groups：ark-iam 应用角色编码（ID/access token 的 groups 声明）
type Identity struct {
	TenantID  string
	UserID    string
	PersonID  string
	ClientID  string
	IsMachine bool
	SessionID string
	Scopes    []string
	Groups    []string
	ActorID   string
	// Source 记录身份来源：oidc / dev / anonymous。
	Source string
}

// Anonymous 返回匿名身份。
func Anonymous() *Identity {
	return &Identity{Source: "anonymous"}
}

// IsAuthenticated 判断是否是有效身份（匿名或空用户 ID 视为未认证）。
func (i *Identity) IsAuthenticated() bool {
	return i != nil && i.Source != "anonymous" && i.UserID != ""
}

// IsPerson 判断是否自然人身份（机器身份不能审批自然人任务）。
func (i *Identity) IsPerson() bool {
	return i.IsAuthenticated() && !i.IsMachine
}

// HasScope 判断是否携带 scope。
func (i *Identity) HasScope(scope string) bool {
	if i == nil {
		return false
	}
	for _, s := range i.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// HasRole 判断是否拥有某个 ark-iam 应用角色编码。
func (i *Identity) HasRole(role string) bool {
	if i == nil {
		return false
	}
	for _, g := range i.Groups {
		if g == role {
			return true
		}
	}
	return false
}

// PermissionResolver 允许宿主用数据库/配置覆盖默认角色权限。
// handled=false 表示没有自定义配置，回退到 DefaultRolePermissions。
type PermissionResolver func(tenantID string, groups []string, permission string) (allowed bool, handled bool)

var permissionResolver PermissionResolver

// SetPermissionResolver 注入租户级权限解析器；传 nil 恢复默认映射。
func SetPermissionResolver(r PermissionResolver) { permissionResolver = r }

// Can 判断是否拥有某个工作流权限。
func (i *Identity) Can(permission string) bool {
	if i == nil {
		return false
	}
	if permissionResolver != nil {
		if allowed, handled := permissionResolver(i.TenantID, i.Groups, permission); handled {
			return allowed
		}
	}
	return HasPermission(i.Groups, permission)
}

// HasAny 判断是否拥有任意一个权限。
func (i *Identity) HasAny(permissions ...string) bool {
	for _, p := range permissions {
		if i.Can(p) {
			return true
		}
	}
	return false
}

type identityContextKey struct{}

// WithIdentity 把身份放入 context。
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	if ctx == nil || id == nil {
		return ctx
	}
	return context.WithValue(ctx, identityContextKey{}, id)
}

// FromContext 从 context 取身份；不存在返回 nil。
func FromContext(ctx context.Context) *Identity {
	if ctx == nil {
		return nil
	}
	id, _ := ctx.Value(identityContextKey{}).(*Identity)
	return id
}

// TenantID 从 context 取租户 ID。
func TenantID(ctx context.Context) string {
	if id := FromContext(ctx); id != nil {
		return id.TenantID
	}
	return ""
}

// UserID 从 context 取成员 ID。
func UserID(ctx context.Context) string {
	if id := FromContext(ctx); id != nil {
		return id.UserID
	}
	return ""
}

// Scope 是权限编码的命名空间前缀，便于日志/审计检索。
const Scope = "workflow"

// 权限编码。新增权限时必须同步 permissions.go 的默认角色映射与文档。
const (
	PermDefRead    = "workflow.def.read"
	PermDefWrite   = "workflow.def.write"
	PermDefPublish = "workflow.def.publish"

	PermInstanceStart     = "workflow.instance.start"
	PermInstanceReadOwn   = "workflow.instance.read.own"
	PermInstanceReadAll   = "workflow.instance.read.tenant"
	PermInstanceRevokeOwn = "workflow.instance.revoke.own"
	PermInstanceRevokeAny = "workflow.instance.revoke.any"

	PermTaskReadOwn  = "workflow.task.read.own"
	PermTaskAct      = "workflow.task.act"
	PermTaskActAdmin = "workflow.task.act.admin"

	PermAuditRead = "workflow.audit.read"
	PermAdmin     = "workflow.admin"

	PermStatsRead = "workflow.stats.read"
)

// AllPermissions 是系统支持的全部权限，用于管理员校验/文档生成。
var AllPermissions = []string{
	PermDefRead, PermDefWrite, PermDefPublish,
	PermInstanceStart, PermInstanceReadOwn, PermInstanceReadAll,
	PermInstanceRevokeOwn, PermInstanceRevokeAny,
	PermTaskReadOwn, PermTaskAct, PermTaskActAdmin,
	PermAuditRead, PermAdmin, PermStatsRead,
}

// DefaultRolePermissions 是 ark-iam 应用角色模板到工作流权限的默认映射。
// 租户可在 wf_role_permission 中覆盖；此处只是初始化默认值。
var DefaultRolePermissions = map[string][]string{
	"workflow_admin": {
		PermDefRead, PermDefWrite, PermDefPublish,
		PermInstanceStart, PermInstanceReadOwn, PermInstanceReadAll,
		PermInstanceRevokeOwn, PermInstanceRevokeAny,
		PermTaskReadOwn, PermTaskAct, PermTaskActAdmin,
		PermAuditRead, PermAdmin, PermStatsRead,
	},
	"workflow_designer": {
		PermDefRead, PermDefWrite, PermDefPublish,
		PermInstanceReadOwn, PermTaskReadOwn,
	},
	"workflow_approver": {
		PermInstanceStart, PermInstanceReadOwn, PermInstanceRevokeOwn,
		PermTaskReadOwn, PermTaskAct,
	},
	"workflow_viewer": {
		PermInstanceReadOwn, PermTaskReadOwn,
	},
	"workflow_auditor": {
		PermInstanceReadAll, PermAuditRead, PermStatsRead,
	},
}

// HasPermission 根据角色编码判断权限。
// 空角色集合一律拒绝；workflow_admin 视为全权限。
func HasPermission(groups []string, permission string) bool {
	if permission == "" {
		return false
	}
	for _, g := range groups {
		if g == "workflow_admin" {
			return true
		}
		for _, p := range DefaultRolePermissions[g] {
			if p == permission {
				return true
			}
		}
	}
	return false
}

// NormalizeGroups 去空、去重并保持稳定顺序，便于测试与审计。
func NormalizeGroups(groups []string) []string {
	seen := make(map[string]bool, len(groups))
	out := make([]string, 0, len(groups))
	for _, g := range groups {
		g = strings.TrimSpace(g)
		if g == "" || seen[g] {
			continue
		}
		seen[g] = true
		out = append(out, g)
	}
	return out
}
