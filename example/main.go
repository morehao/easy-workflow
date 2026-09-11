package main

import (
	"fmt"
	. "github.com/Bunny3th/easy-workflow/example/event"
	. "github.com/Bunny3th/easy-workflow/example/process"
	"github.com/Bunny3th/easy-workflow/example/schedule"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	. "github.com/Bunny3th/easy-workflow/workflow/web_api"
	"github.com/gin-gonic/gin"
	"os"
	"time"
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

// apiAddr 返回 web api 监听地址，默认 :8180
func apiAddr() string {
	return envOrDefault("EASY_WORKFLOW_API_ADDR", ":8180")
}

func main() {
	//----------------------------开启流程引擎----------------------------
	StartWorkFlow(DBConnConfig,false,&MyEvent{})

	//----------------------------生成一个示例流程----------------------------
	CreateExampleProcess()

	//开启工作流计划任务:每10秒钟执行一次自动完成任务(免审)
	start, _ := time.ParseInLocation("2006-01-02 15:04:05", "2023-10-27 00:00:00", time.Local)
	end, _ := time.ParseInLocation("2006-01-02 15:04:05", "2199-10-27 00:00:00", time.Local)
	go ScheduleTask("自动完成任务", start, end, 10, schedule.AutoFinishTask)


	//----------------------------开启web api----------------------------
	//这里需要注意：如果你的业务系统也同时使用了swagger
	//你希望业务系统的swagger页面(以下简称“业务swagger”)与easy-workflow内置web api的swagger（以下简称“工作流swagger”）同时开启
	//必须做到：
	//1、业务swagger与工作流swagger必须使用同一个访问路由，即假如业务swagger访问路由是"/swagger/*any",则工作流swagger必须也是这个路由
	//2、由于同一个端口下不能起两个同名的路由地址，所以业务系统web api与easy-workflow内置web api必须使用不同的端口
	//我做过多种尝试，希望在同一个端口下，业务系统swagger使用路由“/X ”,工作流swagger使用路由"/Y"，但x、y只能存活一个，必然有一个不能访问
	//swagger-ui.css、swagger-ui-bundle.js、swagger-ui-standalone-preset.js这几个文件，猜测其原因，虽然module是两个，swag库是全局的
	//在此情况下，css文件等只能适配一个路由地址。以上是我的尝试与猜测，有知道的同学可以联系我告知正确的打开方式

	//本项目采用gin运行web api，首先生成一个gin.Engine
	engine := gin.New()
	//这里定义中间件
	engine.Use(gin.Logger())   //gin的默认log，默认输出是os.Stdout，即屏幕
	engine.Use(gin.Recovery()) //从任何panic中恢复，并在出现panic时返回http 500
	StartWebApi(engine, "/process", true, "/swagger/*any", apiAddr())
}
