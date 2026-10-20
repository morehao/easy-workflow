package service

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

func activeDelegation(tenantID, fromUserID, toUserID string) bool {
	if tenantID == "" || fromUserID == "" || toUserID == "" || fromUserID == toUserID {
		return false
	}
	now := time.Now()
	var count int64
	DB.Model(&database.TaskDelegation{}).
		Where("tenant_id=? AND from_user_id=? AND to_user_id=? AND status=1 AND start_time<=? AND end_time>=?",
			tenantID, fromUserID, toUserID, now, now).
		Count(&count)
	return count > 0
}

func instanceHasDelegatedTask(tenantID string, instID int, toUserID string) bool {
	if tenantID == "" || instID <= 0 || toUserID == "" {
		return false
	}
	now := time.Now()
	sub := "(SELECT from_user_id FROM wf_task_delegation WHERE tenant_id=? AND to_user_id=? AND status=1 AND start_time<=? AND end_time>=?)"
	var count int64
	sql := "SELECT (SELECT COUNT(*) FROM proc_task WHERE tenant_id=? AND proc_inst_id=? AND user_id IN " + sub + ") + " +
		"(SELECT COUNT(*) FROM hist_proc_task WHERE tenant_id=? AND proc_inst_id=? AND user_id IN " + sub + ") AS n"
	if err := DB.Raw(sql, tenantID, instID, tenantID, toUserID, now, now, tenantID, instID, tenantID, toUserID, now, now).Scan(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func delegatedFromUsers(tenantID, toUserID string) []string {
	if tenantID == "" || toUserID == "" {
		return nil
	}
	now := time.Now()
	var rows []database.TaskDelegation
	_ = DB.Where("tenant_id=? AND to_user_id=? AND status=1 AND start_time<=? AND end_time>=?", tenantID, toUserID, now, now).Find(&rows).Error
	seen := map[string]bool{}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if !seen[r.FromUserID] {
			seen[r.FromUserID] = true
			out = append(out, r.FromUserID)
		}
	}
	return out
}

// TaskDelegation_Add POST /delegation
// form: ToUserID, FromUserID(可选，管理员可代设), StartTime/EndTime(YYYY-MM-DD，可选)
func TaskDelegation_Add(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	from := strings.TrimSpace(c.PostForm("FromUserID"))
	if from == "" {
		from = id.UserID
	}
	if from != id.UserID && !id.Can(auth.PermAdmin) {
		c.JSON(http.StatusForbidden, "只能为自己设置委托")
		return
	}
	to := strings.TrimSpace(c.PostForm("ToUserID"))
	if to == "" || to == from {
		c.JSON(http.StatusBadRequest, "受托人不能为空且不能与委托人相同")
		return
	}
	start := time.Now()
	end := start.Add(7 * 24 * time.Hour)
	if v := strings.TrimSpace(c.PostForm("StartTime")); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, time.Local)
		if err != nil {
			c.JSON(http.StatusBadRequest, "StartTime 格式必须是 YYYY-MM-DD")
			return
		}
		start = t
	}
	if v := strings.TrimSpace(c.PostForm("EndTime")); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, time.Local)
		if err != nil {
			c.JSON(http.StatusBadRequest, "EndTime 格式必须是 YYYY-MM-DD")
			return
		}
		end = t.Add(24*time.Hour - time.Second)
	}
	if !end.After(start) {
		c.JSON(http.StatusBadRequest, "EndTime 必须晚于 StartTime")
		return
	}
	st := database.LocalTime(start)
	en := database.LocalTime(end)
	now := database.LocalTime(time.Now())
	row := database.TaskDelegation{
		TenantID: id.TenantID, FromUserID: from, ToUserID: to,
		StartTime: &st, EndTime: &en, Status: 1, CreatedBy: id.UserID, CreateTime: &now,
	}
	if err := DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, row)
}

// TaskDelegation_List GET /delegation/list
func TaskDelegation_List(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	var rows []database.TaskDelegation
	if err := DB.Where("tenant_id=? AND (from_user_id=? OR to_user_id=?)", id.TenantID, id.UserID, id.UserID).
		Order("id desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, rows)
}

// TaskDelegation_Delete DELETE /delegation/:id
func TaskDelegation_Delete(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	rowID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "委托ID非法")
		return
	}
	var row database.TaskDelegation
	if err := DB.Where("id=? AND tenant_id=?", rowID, id.TenantID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, "委托不存在")
		return
	}
	if row.FromUserID != id.UserID && !id.Can(auth.PermAdmin) {
		c.JSON(http.StatusForbidden, "无权删除该委托")
		return
	}
	if err := DB.Model(&database.TaskDelegation{}).Where("id=?", row.ID).Update("status", 0).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"disabled": row.ID})
}
