package service

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

// Task_AddSign POST /task/add-sign
// 在当前任务所在节点追加一个处理人；节点转为会签，所有人通过后才继续流转。
func Task_AddSign(c *gin.Context) {
	taskID, err := strconv.Atoi(c.PostForm("TaskID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "TaskID 非法")
		return
	}
	target := strings.TrimSpace(c.PostForm("UserID"))
	if target == "" {
		c.JSON(http.StatusBadRequest, "加签用户不能为空")
		return
	}
	task, ok := requireTaskActor(c, taskID)
	if !ok {
		return
	}
	if task.IsFinished != 0 {
		c.JSON(http.StatusBadRequest, "任务已处理，不能加签")
		return
	}
	if target == task.UserID {
		c.JSON(http.StatusBadRequest, "不能给自己加签")
		return
	}
	var exists int64
	DB.Model(&database.ProcTask{}).
		Where("tenant_id=? AND proc_inst_id=? AND node_id=? AND batch_code=? AND user_id=? AND is_finished=0",
			task.TenantID, task.ProcInstID, task.NodeID, task.BatchCode, target).
		Count(&exists)
	if exists > 0 {
		c.JSON(http.StatusBadRequest, "该用户已在当前节点待办中")
		return
	}

	var procInstCreate database.LocalTime
	if task.ProcInstCreateTime != nil {
		procInstCreate = database.LocalTime(*task.ProcInstCreateTime)
	}
	tx := DB.Begin()
	q := tx.Model(&database.ProcTask{}).
		Where("tenant_id=? AND proc_inst_id=? AND node_id=? AND batch_code=? AND is_finished=0",
			task.TenantID, task.ProcInstID, task.NodeID, task.BatchCode)
	if err := q.Update("is_cosigned", 1).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	row := database.ProcTask{
		TenantID: task.TenantID, ProcID: task.ProcID, ProcInstID: task.ProcInstID,
		BusinessID: task.BusinessID, Starter: task.Starter,
		NodeID: task.NodeID, NodeName: task.NodeName, PrevNodeID: task.PrevNodeID,
		IsCosigned: 1, BatchCode: task.BatchCode, UserID: target,
		Status: 0, IsFinished: 0, ProcInstCreateTime: procInstCreate, DueAt: task.DueAt,
		CreateTime: database.LocalTime(time.Now()),
	}
	if err := tx.Create(&row).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	notifyInstanceActiveTasks(task.TenantID, task.ProcInstID, "有加签任务待处理", "节点 "+task.NodeName+" 已加签")
	c.JSON(http.StatusOK, gin.H{"TaskID": row.ID, "UserID": target})
}

// Task_BatchPass POST /task/batch-pass
// 先逐个做归属校验，再逐个调用 TaskPass；返回成功/失败明细，允许部分成功。
func Task_BatchPass(c *gin.Context) {
	raw := strings.Split(c.PostForm("TaskIDs"), ",")
	ids := make([]int, 0, len(raw))
	seen := map[int]bool{}
	for _, s := range raw {
		n, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil || n <= 0 || seen[n] {
			continue
		}
		seen[n] = true
		ids = append(ids, n)
	}
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, "TaskIDs 不能为空")
		return
	}
	for _, id := range ids {
		if _, ok := requireTaskActor(c, id); !ok {
			return
		}
	}
	comment := c.PostForm("Comment")
	vars := c.PostForm("VariablesJson")
	passed := make([]int, 0, len(ids))
	failed := make([]map[string]any, 0)
	for _, id := range ids {
		if err := TaskPass(id, comment, vars, false); err != nil {
			failed = append(failed, map[string]any{"TaskID": id, "Error": err.Error()})
		} else {
			passed = append(passed, id)
		}
	}
	c.JSON(http.StatusOK, gin.H{"passed": passed, "failed": failed})
}
