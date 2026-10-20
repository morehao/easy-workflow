package service

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

type NotificationPayload struct {
	UserIDs []string `json:"user_ids"`
	Title   string   `json:"title"`
	Body    string   `json:"body"`
	Link    string   `json:"link"`
}

var outboxOnce sync.Once

// StartOutboxWorker 启动本地 outbox 轮询；生产可替换为独立 worker/消息队列。
func StartOutboxWorker() {
	outboxOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				processOutbox()
			}
		}()
	})
}

func enqueueOutbox(tenantID, eventType string, payload NotificationPayload) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	now := database.LocalTime(time.Now())
	_ = DB.Create(&database.OutboxEvent{
		TenantID: tenantID, EventType: eventType, Payload: string(raw), Status: 0,
		AvailableAt: &now, CreateTime: &now,
	}).Error
}

func processOutbox() {
	now := time.Now()
	var events []database.OutboxEvent
	if err := DB.Where("status=0 AND available_at<=?", now).Order("id").Limit(20).Find(&events).Error; err != nil {
		return
	}
	for _, e := range events {
		var p NotificationPayload
		if err := json.Unmarshal([]byte(e.Payload), &p); err != nil {
			DB.Model(&database.OutboxEvent{}).Where("id=?", e.ID).Updates(map[string]any{"status": 2, "retry": e.Retry + 1})
			continue
		}
		ok := true
		created := database.LocalTime(time.Now())
		for _, u := range p.UserIDs {
			u = strings.TrimSpace(u)
			if u == "" {
				continue
			}
			if err := DB.Create(&database.Notification{
				TenantID: e.TenantID, UserID: u, Title: p.Title, Body: p.Body, Link: p.Link, Status: 0, CreateTime: &created,
			}).Error; err != nil {
				ok = false
				break
			}
		}
		if ok {
			sendWebhook(e.TenantID, e.EventType, p)
			DB.Model(&database.OutboxEvent{}).Where("id=?", e.ID).Updates(map[string]any{"status": 1, "processed_at": now})
		} else {
			retry := e.Retry + 1
			next := database.LocalTime(now.Add(time.Duration(retry) * time.Minute))
			status := 0
			if retry >= 5 {
				status = 2
			}
			DB.Model(&database.OutboxEvent{}).Where("id=?", e.ID).Updates(map[string]any{"status": status, "retry": retry, "available_at": &next})
		}
	}
}

// notifyInstanceActiveTasks 给实例当前未完成任务的处理人发通知。
func notifyInstanceActiveTasks(tenantID string, instID int, title, body string) {
	tasks, err := GetInstanceTaskHistoryForTenant(instID, tenantID)
	if err != nil {
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
		return
	}
	enqueueOutbox(tenantID, "task.assigned", NotificationPayload{
		UserIDs: users, Title: title, Body: body, Link: "/instances/" + strconv.Itoa(instID),
	})
}

// Notification_List GET /notification/list?unread=1
func Notification_List(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	q := DB.Where("tenant_id=? AND user_id=?", id.TenantID, id.UserID)
	if c.Query("unread") == "1" {
		q = q.Where("status=0")
	}
	rows := 100
	if n, err := strconv.Atoi(c.Query("rows")); err == nil && n > 0 && n <= 500 {
		rows = n
	}
	var list []database.Notification
	if err := q.Order("id desc").Limit(rows).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, list)
}

// Notification_UnreadCount GET /notification/unread-count
func Notification_UnreadCount(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	var n int64
	_ = DB.Model(&database.Notification{}).Where("tenant_id=? AND user_id=? AND status=0", id.TenantID, id.UserID).Count(&n).Error
	c.JSON(http.StatusOK, gin.H{"count": n})
}

// Notification_Read POST /notification/read form: IDs
func Notification_Read(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	ids := make([]int, 0)
	for _, s := range strings.Split(c.PostForm("IDs"), ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && n > 0 {
			ids = append(ids, n)
		}
	}
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, "IDs 不能为空")
		return
	}
	res := DB.Model(&database.Notification{}).Where("tenant_id=? AND user_id=? AND id IN ?", id.TenantID, id.UserID, ids).Update("status", 1)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, res.Error.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": res.RowsAffected})
}

// Notification_ReadAll POST /notification/read-all
func Notification_ReadAll(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	res := DB.Model(&database.Notification{}).Where("tenant_id=? AND user_id=? AND status=0", id.TenantID, id.UserID).Update("status", 1)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, res.Error.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": res.RowsAffected})
}
