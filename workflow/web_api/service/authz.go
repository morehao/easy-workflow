package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/Bunny3th/easy-workflow/workflow/model"
	"github.com/gin-gonic/gin"
)

// currentIdentity 返回当前身份；未认证时返回匿名身份。
func currentIdentity(c *gin.Context) *auth.Identity {
	return auth.Current(c)
}

// requireAuthenticated 要求有效身份。
func requireAuthenticated(c *gin.Context) (*auth.Identity, bool) {
	id := currentIdentity(c)
	if !id.IsAuthenticated() {
		abortAuth(c, http.StatusUnauthorized, "WF_UNAUTHENTICATED", "authentication required")
		return id, false
	}
	return id, true
}

// requirePermission 要求指定权限。
func requirePermission(c *gin.Context, permission string) (*auth.Identity, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return id, false
	}
	if !id.Can(permission) {
		abortAuth(c, http.StatusForbidden, "WF_FORBIDDEN", "permission denied")
		return id, false
	}
	return id, true
}

// requireAnyPermission 要求任意一个权限。
func requireAnyPermission(c *gin.Context, permissions ...string) (*auth.Identity, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return id, false
	}
	if !id.HasAny(permissions...) {
		abortAuth(c, http.StatusForbidden, "WF_FORBIDDEN", "permission denied")
		return id, false
	}
	return id, true
}

// requireTaskActor 校验“当前用户可操作该任务”：必须是自然人，且是处理人/代理人/授权管理员。
func requireTaskActor(c *gin.Context, taskID int) (model.Task, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return model.Task{}, false
	}
	if !id.IsPerson() {
		abortAuth(c, http.StatusForbidden, "WF_PERSON_REQUIRED", "a person identity is required")
		return model.Task{}, false
	}
	task, err := GetTaskInfoForTenant(taskID, id.TenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, err.Error())
		return model.Task{}, false
	}
	if isSuspendedInstance(id.TenantID, task.ProcInstID) {
		c.JSON(http.StatusConflict, gin.H{"code": "WF_INSTANCE_SUSPENDED", "message": "流程已挂起，请先恢复"})
		return model.Task{}, false
	}
	if task.UserID == id.UserID || id.Can(auth.PermTaskActAdmin) {
		return task, true
	}
	// 委托场景：受托人在有效期内可操作委托人的任务。
	if activeDelegation(id.TenantID, task.UserID, id.UserID) {
		return task, true
	}
	abortAuth(c, http.StatusForbidden, "WF_TASK_FORBIDDEN", "task does not belong to current user")
	return model.Task{}, false
}

// requireTaskReader 校验“当前用户可查看该任务”：处理人/发起人/租户管理员/审计。
func requireTaskReader(c *gin.Context, taskID int) (model.Task, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return model.Task{}, false
	}
	task, err := GetTaskInfoForTenant(taskID, id.TenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, err.Error())
		return model.Task{}, false
	}
	if task.UserID == id.UserID || task.Starter == id.UserID ||
		id.Can(auth.PermInstanceReadAll) || id.Can(auth.PermTaskActAdmin) ||
		activeDelegation(id.TenantID, task.UserID, id.UserID) {
		return task, true
	}
	abortAuth(c, http.StatusForbidden, "WF_TASK_FORBIDDEN", "task not visible to current user")
	return model.Task{}, false
}

// requireInstanceReader 校验实例可见性。
func requireInstanceReader(c *gin.Context, instanceID int) (model.Instance, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return model.Instance{}, false
	}
	inst, err := GetInstanceInfoForTenant(instanceID, id.TenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, err.Error())
		return model.Instance{}, false
	}
	if inst.ProcInstID == 0 {
		c.JSON(http.StatusNotFound, "流程实例不存在")
		return model.Instance{}, false
	}
	if inst.Starter == id.UserID || id.Can(auth.PermInstanceReadAll) || id.Can(auth.PermTaskActAdmin) ||
		instanceHasDelegatedTask(id.TenantID, instanceID, id.UserID) {
		return inst, true
	}
	abortAuth(c, http.StatusForbidden, "WF_INSTANCE_FORBIDDEN", "instance not visible to current user")
	return model.Instance{}, false
}

// requireInstanceRevoker 校验撤销权限：发起人 + revoke.own，或 revoke.any。
func requireInstanceRevoker(c *gin.Context, instanceID int) (model.Instance, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return model.Instance{}, false
	}
	inst, err := GetInstanceInfoForTenant(instanceID, id.TenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, err.Error())
		return model.Instance{}, false
	}
	if inst.ProcInstID == 0 {
		c.JSON(http.StatusNotFound, "流程实例不存在")
		return model.Instance{}, false
	}
	if id.Can(auth.PermInstanceRevokeAny) {
		return inst, true
	}
	if inst.Starter == id.UserID && id.Can(auth.PermInstanceRevokeOwn) {
		return inst, true
	}
	abortAuth(c, http.StatusForbidden, "WF_INSTANCE_FORBIDDEN", "not allowed to revoke this instance")
	return model.Instance{}, false
}

// scopedUserID 把请求里的 userid 收敛到当前用户或授权范围。
//
// 规则：
//   - 请求为空：有 tenant.read/audit 权限返回空（查全量），否则返回当前用户
//   - 请求等于当前用户：放行
//   - 请求是他人：必须有 instance.read.tenant 或 task.act.admin
func scopedUserID(c *gin.Context, requested string) (string, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return "", false
	}
	requested = strings.TrimSpace(requested)
	if requested == "" {
		if id.Can(auth.PermInstanceReadAll) {
			return "", true
		}
		return id.UserID, true
	}
	if requested == id.UserID {
		return requested, true
	}
	if id.Can(auth.PermInstanceReadAll) || id.Can(auth.PermTaskActAdmin) {
		return requested, true
	}
	abortAuth(c, http.StatusForbidden, "WF_USER_SCOPE_FORBIDDEN", "cannot query another user's data")
	return "", false
}

// forceStarterVariable 在发起流程时把 starter 变量收敛到当前用户，防止冒充他人发起。
//
// 管理员（workflow_admin）可以显式指定 starter（用于代发起/迁移），其余用户一律覆盖。
func forceStarterVariable(c *gin.Context, raw string) (string, error) {
	id := currentIdentity(c)
	if !id.IsAuthenticated() {
		return "", fmt.Errorf("authentication required")
	}
	var vars []model.Variable
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &vars); err != nil {
			return "", fmt.Errorf("VariablesJson 格式不正确: %w", err)
		}
	}
	// 非管理员强制覆盖；管理员保留显式值，缺省补当前用户。
	keep := false
	if id.Can(auth.PermAdmin) {
		for _, v := range vars {
			if v.Key == "starter" && strings.TrimSpace(v.Value) != "" {
				keep = true
				break
			}
		}
	}
	if !keep {
		filtered := make([]model.Variable, 0, len(vars)+1)
		for _, v := range vars {
			if v.Key != "starter" {
				filtered = append(filtered, v)
			}
		}
		filtered = append(filtered, model.Variable{Key: "starter", Value: id.UserID})
		vars = filtered
	}
	b, err := json.Marshal(vars)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func abortAuth(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"code": code, "message": message})
}
