package service

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/directory"
	"github.com/gin-gonic/gin"
)

var directoryClient *directory.Client

// SetDirectoryClient 注入 ark-iam 目录客户端；未配置时相关接口返回 503。
func SetDirectoryClient(c *directory.Client) {
	directoryClient = c
}

func directoryReady(c *gin.Context) bool {
	if directoryClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "WF_DIRECTORY_UNAVAILABLE", "message": "ark-iam 目录未配置"})
		return false
	}
	return true
}

func directoryAuthorized(c *gin.Context) bool {
	_, ok := requireAnyPermission(c, auth.PermDefRead, auth.PermDefWrite, auth.PermAdmin)
	return ok
}

func writeDirectoryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, directory.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "WF_DIRECTORY_NOT_FOUND", "message": "成员不存在或跨租户"})
	case errors.Is(err, directory.ErrUnauthorized), errors.Is(err, directory.ErrForbidden):
		c.JSON(http.StatusBadGateway, gin.H{"code": "WF_DIRECTORY_AUTH", "message": "目录服务鉴权失败，请检查 API Key/scope/tenant"})
	case errors.Is(err, directory.ErrTooManyIDs):
		c.JSON(http.StatusBadRequest, gin.H{"code": "WF_DIRECTORY_TOO_MANY_IDS", "message": "一次最多查询 100 个成员"})
	default:
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "WF_DIRECTORY_UNAVAILABLE", "message": err.Error()})
	}
}

// Directory_Member GET /directory/members/:id
func Directory_Member(c *gin.Context) {
	if !directoryAuthorized(c) || !directoryReady(c) {
		return
	}
	m, err := directoryClient.Member(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeDirectoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

// Directory_Members GET /directory/members?ids=a,b,c
func Directory_Members(c *gin.Context) {
	if !directoryAuthorized(c) || !directoryReady(c) {
		return
	}
	ids := strings.Split(c.Query("ids"), ",")
	list, missing, err := directoryClient.Members(c.Request.Context(), ids)
	if err != nil {
		writeDirectoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"list": list, "missing": missing})
}

// Directory_Departments GET /directory/departments/tree
func Directory_Departments(c *gin.Context) {
	if !directoryAuthorized(c) || !directoryReady(c) {
		return
	}
	tree, err := directoryClient.DepartmentTree(c.Request.Context())
	if err != nil {
		writeDirectoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, tree)
}

// Directory_Roles GET /directory/roles
func Directory_Roles(c *gin.Context) {
	if !directoryAuthorized(c) || !directoryReady(c) {
		return
	}
	roles, truncated, err := directoryClient.Roles(c.Request.Context())
	if err != nil {
		writeDirectoryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"list": roles, "truncated": truncated})
}
