package router

import (
	"github.com/Bunny3th/easy-workflow/workflow/web_api/docs" // 导入swagger文档用的
	. "github.com/Bunny3th/easy-workflow/workflow/web_api/service"
	"github.com/gin-gonic/gin"
	"github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func NewRouter(engine *gin.Engine, ApiBasePath string, ShowSwaggerDoc bool, SwaggerUrl string) *gin.Engine {
	//注意，由于我们执行swag init的时候指定了InstanceName，所以这里也必须传入InstanceName
	if ShowSwaggerDoc {
		engine.GET(SwaggerUrl, ginSwagger.WrapHandler(swaggerFiles.Handler, func(c *ginSwagger.Config) {
			c.InstanceName = "easyworkflow"
		}))
	}
	//swagger信息设置
	docs.SwaggerInfoeasyworkflow.BasePath = ApiBasePath
	docs.SwaggerInfoeasyworkflow.Title = "Easy WorkFlow接口说明"
	docs.SwaggerInfoeasyworkflow.Description = "https://github.com/Bunny3th/easy-workflow"

	router := engine.Group(ApiBasePath)
	router.Use(RequestIDMiddleware(), AuditMiddleware(), IdempotencyMiddleware())

	router.POST("/def/save", ProcDef_Save)
	router.GET("/def/list", ProcDef_ListBySource)
	router.GET("/def/get", ProcDef_GetProcDefByID)

	router.POST("/inst/start", ProcInst_Start)
	router.GET("/inst/start/by", ProcInst_StartByUser)
	router.POST("/inst/revoke", ProcInst_Revoke)
	router.POST("/inst/suspend", ProcInst_Suspend)
	router.POST("/inst/resume", ProcInst_Resume)
	router.POST("/inst/urge", ProcInst_Urge)
	router.POST("/inst/terminate", ProcInst_Terminate)
	router.GET("/inst/task_history", ProcInst_TaskHistory)

	router.POST("/task/pass", Task_Pass)
	router.POST("/task/pass/directly", Task_Pass_DirectlyToWhoRejectedMe)
	router.POST("/task/reject", Task_Reject)
	router.POST("/task/reject/free", Task_FreeRejectToUpstreamNode)
	router.POST("/task/add-sign", Task_AddSign)
	router.POST("/task/batch-pass", Task_BatchPass)
	router.POST("/task/transfer", Task_Transfer)
	router.GET("/task/todo", Task_ToDoList)
	router.GET("/task/finished", Task_FinishedList)
	router.GET("/task/upstream", Task_UpstreamNodeList)
	router.GET("/task/action", Task_WhatCanIDo)

	// ark-iam 只读目录（成员/部门/角色）；未配置时 503
	router.GET("/directory/members/:id", Directory_Member)
	router.GET("/directory/members", Directory_Members)
	router.GET("/directory/departments/tree", Directory_Departments)
	router.GET("/directory/roles", Directory_Roles)

	// 站内通知
	router.GET("/notification/list", Notification_List)
	router.GET("/notification/unread-count", Notification_UnreadCount)
	router.POST("/notification/read", Notification_Read)
	router.POST("/notification/read-all", Notification_ReadAll)

	// 审计
	router.GET("/audit/list", Audit_List)
	router.GET("/audit/export", Audit_Export)

	// 委托
	router.POST("/delegation", TaskDelegation_Add)
	router.GET("/delegation/list", TaskDelegation_List)
	router.DELETE("/delegation/:id", TaskDelegation_Delete)

	// 抄送
	router.POST("/cc/add", Cc_Add)
	router.GET("/cc/list", Cc_List)
	router.POST("/cc/read", Cc_Read)
	router.GET("/cc/instance", Cc_Instance)

	// 附件
	router.POST("/attachment/upload", Attachment_Upload)
	router.GET("/attachment/list", Attachment_List)
	router.GET("/attachment/:id", Attachment_Download)
	router.DELETE("/attachment/:id", Attachment_Delete)

	// 表单模板/表单数据
	router.POST("/form/template", FormTemplate_Save)
	router.GET("/form/template", FormTemplate_Get)
	router.GET("/form/templates", FormTemplate_List)
	router.POST("/form/data", FormData_Save)
	router.GET("/form/data", FormData_Get)
	router.GET("/form/data/list", FormData_List)

	// 租户级 RBAC 覆盖（管理员）
	router.GET("/admin/role-permissions", RolePermission_Get)
	router.PUT("/admin/role-permissions", RolePermission_Put)
	router.DELETE("/admin/role-permissions", RolePermission_Delete)
	router.GET("/task/info", Task_Info)

	return engine
}
