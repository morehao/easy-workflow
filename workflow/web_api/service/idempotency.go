package service

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

const idempotencyHeader = "Idempotency-Key"

// IdempotencyMiddleware 为写请求提供幂等：
//   - 带 Idempotency-Key 且已完成：直接返回首次响应
//   - 处理中：409
//   - 同 key 不同请求体：409
//   - 未带 key：保持原行为（兼容旧调用/现有 e2e）
func IdempotencyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
		default:
			c.Next()
			return
		}
		if strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
			c.Next()
			return
		}
		key := strings.TrimSpace(c.GetHeader(idempotencyHeader))
		if key == "" || len(key) > 128 {
			c.Next()
			return
		}
		tenantID := auth.Current(c).TenantID
		if tenantID == "" {
			c.Next()
			return
		}

		body, err := io.ReadAll(io.LimitReader(c.Request.Body, 10<<20))
		if err != nil {
			c.Next()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		sum := sha256.Sum256(append([]byte(c.Request.Method+" "+c.Request.URL.Path+"?"+c.Request.URL.RawQuery+"\n"), body...))
		requestHash := fmt.Sprintf("%x", sum)

		var existing database.CommandLog
		err = DB.Where("tenant_id=? AND idempotency_key=?", tenantID, key).First(&existing).Error
		if err == nil {
			if existing.RequestHash != requestHash {
				c.AbortWithStatusJSON(http.StatusConflict, gin.H{"code": "WF_IDEMPOTENCY_CONFLICT", "message": "同一 Idempotency-Key 的请求体不一致"})
				return
			}
			if existing.Status == 1 {
				contentType := existing.ContentType
				if contentType == "" {
					contentType = "application/json; charset=utf-8"
				}
				c.Data(existing.StatusCode, contentType, []byte(existing.ResponseBody))
				c.Abort()
				return
			}
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"code": "WF_IDEMPOTENCY_IN_PROGRESS", "message": "相同请求正在处理中，请稍后重试"})
			return
		}

		record := database.CommandLog{
			TenantID:       tenantID,
			IdempotencyKey: key,
			CommandType:    c.Request.Method + " " + c.Request.URL.Path,
			RequestHash:    requestHash,
			Status:         0,
			ExpiresAt:      database.LocalTime(time.Now().Add(24 * time.Hour)),
		}
		if err := DB.Create(&record).Error; err != nil {
			// 唯一键冲突说明另一个请求已经抢到；按处理中返回。
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"code": "WF_IDEMPOTENCY_IN_PROGRESS", "message": "相同请求正在处理中，请稍后重试"})
			return
		}

		capture := &responseCapture{ResponseWriter: c.Writer}
		c.Writer = capture
		c.Next()

		status := c.Writer.Status()
		if status >= 200 && status < 300 {
			_ = DB.Model(&database.CommandLog{}).
				Where("tenant_id=? AND idempotency_key=?", tenantID, key).
				Updates(map[string]any{
					"status":        1,
					"status_code":   status,
					"content_type":  c.Writer.Header().Get("Content-Type"),
					"response_body": capture.body.String(),
				}).Error
			return
		}
		// 非 2xx 不缓存，允许调用方修正后重试。
		_ = DB.Where("tenant_id=? AND idempotency_key=?", tenantID, key).Delete(&database.CommandLog{}).Error
	}
}

type responseCapture struct {
	gin.ResponseWriter
	body bytes.Buffer
}

func (w *responseCapture) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (w *responseCapture) WriteString(s string) (int, error) {
	w.body.WriteString(s)
	return w.ResponseWriter.WriteString(s)
}
