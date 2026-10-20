package web_api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	. "github.com/Bunny3th/easy-workflow/workflow/web_api/router"
	"github.com/gin-gonic/gin"
)

// StartWebApi 启动工作流 Web API（兼容旧调用；默认 10s 优雅停机）。
//
// 参数说明:
//   - engine: *gin.Engine
//   - ApiBaseUrl: 接口前缀，如 "/process"
//   - ShowSwaggerDoc: 是否挂 Swagger
//   - SwaggerUrl: Swagger 路由，如 "/swagger/*any"
//   - addr: 监听地址与端口，如 "localhost:8080"
func StartWebApi(engine *gin.Engine, ApiBaseUrl string, ShowSwaggerDoc bool, SwaggerUrl string, addr string) {
	if err := StartWebApiGraceful(engine, ApiBaseUrl, ShowSwaggerDoc, SwaggerUrl, addr, 10*time.Second); err != nil {
		log.Printf("easy workflow web api stopped: %v", err)
	}
}

// StartWebApiGraceful 启动 HTTP 服务，并在 SIGINT/SIGTERM 时优雅停机。
//
// 返回值：服务正常关闭返回 nil；监听/关闭失败返回错误。
func StartWebApiGraceful(engine *gin.Engine, ApiBaseUrl string, ShowSwaggerDoc bool, SwaggerUrl string, addr string, shutdownTimeout time.Duration) error {
	if shutdownTimeout <= 0 {
		shutdownTimeout = 10 * time.Second
	}
	e := NewRouter(engine, ApiBaseUrl, ShowSwaggerDoc, SwaggerUrl)

	srv := &http.Server{
		Addr:              addr,
		Handler:           e,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("easy workflow web api listening on %s (base path %s)", addr, ApiBaseUrl)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Printf("easy workflow web api shutting down (timeout %s)", shutdownTimeout)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return <-errCh
	}

	// 如何使用 swagger 生成文档：
	// 一般在 main 包所在目录执行 swag init；本项目中需要在 web_api 目录加 -d 参数：
	// swag init --generalInfo Launcher.go --instanceName easyworkflow -d ./,../model,../database
}
