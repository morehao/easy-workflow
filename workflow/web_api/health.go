package web_api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterHealth 挂载健康检查端点。
//
//   - GET /healthz：进程存活，永远 200（不依赖 DB，避免探针把进程重启掉）
//   - GET /readyz：就绪检查，DB ping 成功才 200；否则 503
//
// 生产环境应把 /healthz 配成 liveness、/readyz 配成 readiness。
func RegisterHealth(e *gin.Engine, db *gorm.DB) {
	e.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	e.GET("/readyz", func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "reason": "db not initialized"})
			return
		}
		sqlDB, err := db.DB()
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "reason": "db handle unavailable"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := sqlDB.PingContext(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "reason": "db ping failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
}
