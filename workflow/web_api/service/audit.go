package service

import (
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

// RequestIDMiddleware 为每个请求生成/透传 X-Request-ID，便于日志与审计串联。
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if id == "" || len(id) > 64 {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

// AuditMiddleware 记录写操作；不记录请求体，避免密码/附件内容落审计。
func AuditMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		default:
			c.Next()
			return
		}
		path := c.Request.URL.Path
		if path == "/healthz" || path == "/readyz" || strings.Contains(path, "/swagger/") {
			c.Next()
			return
		}
		c.Next()
		id := auth.Current(c)
		if id == nil || id.TenantID == "" {
			return
		}
		resourceType := ""
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) > 0 {
			resourceType = parts[0]
		}
		resourceID := c.Param("id")
		if resourceID == "" {
			resourceID = c.Query("taskid")
		}
		if resourceID == "" {
			resourceID = c.Query("instid")
		}
		now := database.LocalTime(time.Now())
		row := database.AuditLog{
			TenantID: id.TenantID, ActorID: id.UserID,
			Action: c.Request.Method + " " + path, ResourceType: resourceType, ResourceID: resourceID,
			Method: c.Request.Method, Path: path, Status: c.Writer.Status(),
			IP: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: c.GetString("request_id"), Detail: c.Request.URL.RawQuery,
			CreateTime: &now,
		}
		_ = DB.Create(&row).Error
	}
}

func auditQuery(c *gin.Context, tenantID string) (*strings.Builder, []any, error) {
	var where strings.Builder
	args := []any{tenantID}
	where.WriteString("tenant_id=?")
	if v := strings.TrimSpace(c.Query("actor")); v != "" {
		where.WriteString(" AND actor_id=?")
		args = append(args, v)
	}
	if v := strings.TrimSpace(c.Query("action")); v != "" {
		where.WriteString(" AND action LIKE ?")
		args = append(args, "%"+v+"%")
	}
	if v := strings.TrimSpace(c.Query("from")); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, time.Local); err == nil {
			where.WriteString(" AND create_time>=?")
			args = append(args, t)
		}
	}
	if v := strings.TrimSpace(c.Query("to")); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, time.Local); err == nil {
			where.WriteString(" AND create_time<?")
			args = append(args, t.Add(24*time.Hour))
		}
	}
	return &where, args, nil
}

// Audit_List GET /audit/list
func Audit_List(c *gin.Context) {
	id, ok := requirePermission(c, auth.PermAuditRead)
	if !ok {
		return
	}
	where, args, _ := auditQuery(c, id.TenantID)
	idx, _ := strconv.Atoi(c.Query("idx"))
	rows, err := strconv.Atoi(c.Query("rows"))
	if err != nil || rows <= 0 || rows > 500 {
		rows = 100
	}
	var list []database.AuditLog
	if err := DB.Where(where.String(), args...).Order("id desc").Offset(idx).Limit(rows).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, list)
}

// Audit_Export GET /audit/export  CSV
func Audit_Export(c *gin.Context) {
	id, ok := requirePermission(c, auth.PermAuditRead)
	if !ok {
		return
	}
	where, args, _ := auditQuery(c, id.TenantID)
	var list []database.AuditLog
	if err := DB.Where(where.String(), args...).Order("id desc").Limit(10000).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="audit-log.csv"`)
	c.Status(http.StatusOK)
	_, _ = c.Writer.Write([]byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM for Excel
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"ID", "时间", "租户", "操作者", "动作", "资源类型", "资源ID", "状态码", "IP", "User-Agent", "RequestID", "Query"})
	for _, r := range list {
		ts := ""
		if r.CreateTime != nil {
			ts = r.CreateTime.String()
		}
		_ = w.Write([]string{
			strconv.Itoa(r.ID), ts, r.TenantID, r.ActorID, r.Action, r.ResourceType, r.ResourceID,
			strconv.Itoa(r.Status), r.IP, r.UserAgent, r.RequestID, r.Detail,
		})
	}
	w.Flush()
	if err := w.Error(); err != nil {
		_ = fmt.Errorf("csv: %w", err)
	}
}
