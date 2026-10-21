package service

import (
	"net/http"
	"strconv"

	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

const (
	instanceStatusRunning   = 0
	instanceStatusFinished  = 1
	instanceStatusRevoked   = 2
	instanceStatusSuspended = 3
)

// ProcInst_Suspend POST /inst/suspend
func ProcInst_Suspend(c *gin.Context) {
	instID, err := strconv.Atoi(c.PostForm("InstanceID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "InstanceID 非法")
		return
	}
	inst, ok := requireInstanceRevoker(c, instID)
	if !ok {
		return
	}
	if inst.Status != instanceStatusRunning {
		c.JSON(http.StatusBadRequest, "只有审批中的流程可以挂起")
		return
	}
	id := currentIdentity(c)
	if err := DB.Model(&database.ProcInst{}).Where("id=? AND tenant_id=?", instID, id.TenantID).Update("status", instanceStatusSuspended).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	notifyInstanceActiveTasks(id.TenantID, instID, "流程已挂起", "流程实例 #"+strconv.Itoa(instID)+" 已挂起")
	c.JSON(http.StatusOK, gin.H{"InstanceID": instID, "Status": instanceStatusSuspended})
}

// ProcInst_Resume POST /inst/resume
func ProcInst_Resume(c *gin.Context) {
	instID, err := strconv.Atoi(c.PostForm("InstanceID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "InstanceID 非法")
		return
	}
	inst, ok := requireInstanceRevoker(c, instID)
	if !ok {
		return
	}
	if inst.Status != instanceStatusSuspended {
		c.JSON(http.StatusBadRequest, "只有已挂起的流程可以恢复")
		return
	}
	id := currentIdentity(c)
	if err := DB.Model(&database.ProcInst{}).Where("id=? AND tenant_id=?", instID, id.TenantID).Update("status", instanceStatusRunning).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	notifyInstanceActiveTasks(id.TenantID, instID, "流程已恢复", "流程实例 #"+strconv.Itoa(instID)+" 已恢复审批")
	c.JSON(http.StatusOK, gin.H{"InstanceID": instID, "Status": instanceStatusRunning})
}

// ProcInst_Urge POST /inst/urge
func ProcInst_Urge(c *gin.Context) {
	instID, err := strconv.Atoi(c.PostForm("InstanceID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "InstanceID 非法")
		return
	}
	if _, ok := requireInstanceReader(c, instID); !ok {
		return
	}
	id := currentIdentity(c)
	tasks, err := GetInstanceTaskHistoryForTenant(instID, id.TenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	users := make([]string, 0)
	seen := map[string]bool{}
	for _, t := range tasks {
		if t.IsFinished == 0 && t.UserID != "" && !seen[t.UserID] {
			seen[t.UserID] = true
			users = append(users, t.UserID)
		}
	}
	if len(users) == 0 {
		c.JSON(http.StatusOK, gin.H{"urged": 0})
		return
	}
	enqueueOutbox(id.TenantID, "instance.urged", NotificationPayload{
		UserIDs: users,
		Title:   "流程催办",
		Body:    "流程实例 #" + strconv.Itoa(instID) + " 等待你处理，请尽快审批",
		Link:    "/instances/" + strconv.Itoa(instID),
	})
	c.JSON(http.StatusOK, gin.H{"urged": len(users)})
}

// ProcInst_Terminate POST /inst/terminate  force revoke 的语义化别名
func ProcInst_Terminate(c *gin.Context) {
	instID, err := strconv.Atoi(c.PostForm("InstanceID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "InstanceID 非法")
		return
	}
	if _, ok := requireInstanceRevoker(c, instID); !ok {
		return
	}
	id := currentIdentity(c)
	if err := InstanceRevoke(instID, true, id.UserID); err != nil {
		c.JSON(http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, "ok")
}

func isSuspendedInstance(tenantID string, instID int) bool {
	inst, err := GetInstanceInfoForTenant(instID, tenantID)
	return err == nil && inst.Status == instanceStatusSuspended
}
