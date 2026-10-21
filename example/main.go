package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	. "github.com/Bunny3th/easy-workflow/example/event"
	. "github.com/Bunny3th/easy-workflow/example/process"
	"github.com/Bunny3th/easy-workflow/example/schedule"
	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/config"
	"github.com/Bunny3th/easy-workflow/workflow/directory"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	. "github.com/Bunny3th/easy-workflow/workflow/web_api"
	"github.com/Bunny3th/easy-workflow/workflow/web_api/service"
	"github.com/gin-gonic/gin"
)

// DBConnConfig 配置引擎的数据库连接。
// 默认连接本地 MySQL（与本仓库 web/ 前端配合可直接跑通），
// 也可通过环境变量覆盖，指向你自己的数据库：
//
//	EASY_WORKFLOW_DSN      完整 DSN，设置后忽略下面几个分项变量
//	EASY_WORKFLOW_DB_HOST  默认 127.0.0.1:3306
//	EASY_WORKFLOW_DB_USER  默认 goeasy
//	EASY_WORKFLOW_DB_PASS  默认 sNd%sLDjd*12
//	EASY_WORKFLOW_DB_NAME  默认 easy_workflow
//
// 库需要事先存在（引擎会自动建表，但不会建库）：
//
//	CREATE DATABASE easy_workflow DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
func DBConnConfig() {
	dsn := os.Getenv("EASY_WORKFLOW_DSN")
	if dsn == "" {
		host := envOrDefault("EASY_WORKFLOW_DB_HOST", "127.0.0.1:3306")
		user := envOrDefault("EASY_WORKFLOW_DB_USER", "goeasy")
		pass := envOrDefault("EASY_WORKFLOW_DB_PASS", "sNd%sLDjd*12")
		name := envOrDefault("EASY_WORKFLOW_DB_NAME", "easy_workflow")
		dsn = fmt.Sprintf("%s:%s@tcp(%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, name)
	}
	DBConnConfigurator.DBConnectString = dsn
	DBConnConfigurator.LogLevel = 4 //日志级别(默认3) 1:Silent 2:Error 3:Warn 4:Info
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	//----------------------------开启流程引擎----------------------------
	StartWorkFlow(DBConnConfig, false, &MyEvent{})

	//----------------------------生成一个示例流程----------------------------
	// 生产/强制认证模式下默认不播种，避免每次启动都升版本、重建执行表。
	// 本地开发可用 EASY_WORKFLOW_SEED_EXAMPLE=true 显式开启。
	seed := envBool("EASY_WORKFLOW_SEED_EXAMPLE", cfg.AuthMode != config.AuthModeEnforce)
	if seed {
		CreateExampleProcess()
	}

	//----------------------------OIDC 验签器----------------------------
	var verifier *auth.Verifier
	if cfg.OIDCIssuer != "" || cfg.OIDCAudience != "" {
		if cfg.OIDCIssuer == "" || cfg.OIDCAudience == "" {
			log.Fatal("EASY_WORKFLOW_OIDC_ISSUER and EASY_WORKFLOW_OIDC_AUDIENCE must be set together")
		}
		v, err := auth.NewVerifier(auth.VerifierConfig{
			Issuer:      cfg.OIDCIssuer,
			Audience:    cfg.OIDCAudience,
			JWKSURL:     cfg.OIDCJWKSURL,
			UserInfoURL: cfg.OIDCUserInfoURL,
			Leeway:      cfg.OIDCLeeway,
			HTTPClient:  &http.Client{Timeout: cfg.OIDCHTTPTimeout},
		})
		if err != nil {
			if cfg.IsEnforced() {
				log.Fatalf("init OIDC verifier: %v", err)
			}
			log.Printf("WARN: init OIDC verifier failed, token auth disabled: %v", err)
		} else {
			verifier = v
		}
	}
	if cfg.IsEnforced() && verifier == nil {
		log.Fatal("AUTH_MODE=enforce requires a working OIDC verifier")
	}

	// 开发身份仅在 off/optional 且未带令牌时生效；生产 enforce 不会使用。
	devIdentity := &auth.Identity{
		TenantID: cfg.DevTenantID,
		UserID:   cfg.DevUserID,
		Source:   "dev",
		Groups:   cfg.DevRoles,
	}

	//----------------------------开启工作流计划任务----------------------------
	// demo 自动完成必须显式开启（EASY_WORKFLOW_DEMO_AUTOFINISH=true），
	// 避免本地/生产误自动审批。
	if envBool("EASY_WORKFLOW_DEMO_AUTOFINISH", false) {
		start, _ := time.ParseInLocation("2006-01-02 15:04:05", "2023-10-27 00:00:00", time.Local)
		end, _ := time.ParseInLocation("2006-01-02 15:04:05", "2199-10-27 00:00:00", time.Local)
		go ScheduleTask("自动完成任务", start, end, 10, schedule.AutoFinishTask)
	}

	//----------------------------开启web api----------------------------
	// 这里需要注意：如果你的业务系统也同时使用了 swagger，
	// 业务 swagger 与工作流 swagger 必须使用同一个访问路由、不同端口；
	// 详见 README 中的说明。
	engine := gin.New()
	engine.Use(gin.Logger())   // gin 默认 log，输出到 os.Stdout
	engine.Use(gin.Recovery()) // 从 panic 恢复并返回 500
	engine.Use(auth.Middleware(auth.MiddlewareConfig{
		Mode:        string(cfg.AuthMode),
		Verifier:    verifier,
		DevIdentity: devIdentity,
	}))

	auth.SetPermissionResolver(service.ResolveRolePermission)
	service.ConfigureAttachments(cfg.AttachmentDir, cfg.AttachmentMaxBytes)
	SetTaskSLA(time.Duration(cfg.TaskSLAHours) * time.Hour)
	if cfg.WebhookURL != "" {
		service.ConfigureWebhook(cfg.WebhookURL, cfg.WebhookTimeout)
	}
	service.StartOutboxWorker()

	if cfg.DirectoryBaseURL != "" {
		dc, err := directory.New(directory.Config{
			BaseURL:         cfg.DirectoryBaseURL,
			TokenURL:        cfg.DirectoryTokenURL,
			APIKey:          cfg.DirectoryAPIKey,
			Resource:        cfg.DirectoryResource,
			Timeout:         cfg.DirectoryTimeout,
			UserAgent:       "easy-workflow-directory/1.0",
			UseAPIKeyHeader: cfg.DirectoryAPIKeyHeader,
		})
		if err != nil {
			log.Fatalf("init ark-iam directory: %v", err)
		}
		service.SetDirectoryClient(dc)
	}

	RegisterHealth(engine, DB)
	RegisterMetrics(engine, DB)
	if err := StartWebApiGraceful(engine, "/process", true, "/swagger/*any", cfg.Addr, cfg.ShutdownTimeout); err != nil {
		log.Fatalf("web api stopped: %v", err)
	}
}
