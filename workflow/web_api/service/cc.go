package service

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CcItem struct {
	ID            int    `json:"ID"`
	ProcInstID    int    `json:"ProcInstID"`
	UserID        string `json:"UserID"`
	Status        int    `json:"Status"`
	CreatedBy     string `json:"CreatedBy"`
	CreateTime    string `json:"CreateTime"`
	ProcName      string `json:"ProcName"`
	BusinessID    string `json:"BusinessID"`
	Starter       string `json:"Starter"`
	CurrentNodeID string `json:"CurrentNodeID"`
	InstStatus    int    `json:"InstStatus"`
}

func addCcRecipients(tenantID string, instID int, users []string, createdBy string) error {
	now := database.LocalTime(time.Now())
	for _, u := range users {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		var row database.CcRecipient
		err := DB.Where("tenant_id=? AND proc_inst_id=? AND user_id=?", tenantID, instID, u).First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := DB.Create(&database.CcRecipient{TenantID: tenantID, ProcInstID: instID, UserID: u, Status: 0, CreatedBy: createdBy, CreateTime: &now}).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	return nil
}

// Cc_Add POST /cc/add  form: ProcInstID, UserIDs(comma),
func Cc_Add(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	instID, err := strconv.Atoi(c.PostForm("ProcInstID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "ProcInstID 非法")
		return
	}
	inst, err := GetInstanceInfoForTenant(instID, id.TenantID)
	if err != nil || inst.ProcInstID == 0 {
		c.JSON(http.StatusNotFound, "流程实例不存在")
		return
	}
	if inst.Starter != id.UserID && !id.Can(auth.PermAdmin) && !id.Can(auth.PermInstanceReadAll) {
		c.JSON(http.StatusForbidden, "只有发起人或管理员可以添加抄送")
		return
	}
	users := strings.Split(c.PostForm("UserIDs"), ",")
	if err := addCcRecipients(id.TenantID, instID, users, id.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	enqueueOutbox(id.TenantID, "cc.added", NotificationPayload{
		UserIDs: users, Title: "收到流程抄送", Body: "流程实例 #" + strconv.Itoa(instID) + " 抄送给你", Link: "/instances/" + strconv.Itoa(instID),
	})
	c.JSON(http.StatusOK, gin.H{"added": len(users)})
}

// Cc_List GET /cc/list?unread=1&idx=0&rows=100
func Cc_List(c *gin.Context) {
	id := currentIdentity(c)
	if id == nil {
		return
	}
	rows := 100
	if n, err := strconv.Atoi(c.Query("rows")); err == nil && n > 0 && n <= 500 {
		rows = n
	}
	idx := 0
	if n, err := strconv.Atoi(c.Query("idx")); err == nil && n > 0 {
		idx = n
	}
	q := DB.Where("tenant_id=? AND user_id=?", id.TenantID, id.UserID)
	if c.Query("unread") == "1" {
		q = q.Where("status=0")
	}
	var list []database.CcRecipient
	if err := q.Order("id desc").Offset(idx).Limit(rows).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]CcItem, 0, len(list))
	for _, r := range list {
		inst, err := GetInstanceInfoForTenant(r.ProcInstID, id.TenantID)
		if err != nil {
			continue
		}
		created := ""
		if r.CreateTime != nil {
			created = r.CreateTime.String()
		}
		items = append(items, CcItem{
			ID: r.ID, ProcInstID: r.ProcInstID, UserID: r.UserID, Status: r.Status, CreatedBy: r.CreatedBy,
			CreateTime: created, ProcName: inst.ProcName, BusinessID: inst.BusinessID, Starter: inst.Starter,
			CurrentNodeID: inst.CurrentNodeID, InstStatus: inst.Status,
		})
	}
	c.JSON(http.StatusOK, items)
}

// Cc_Read POST /cc/read form: IDs(comma)
func Cc_Read(c *gin.Context) {
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
	res := DB.Model(&database.CcRecipient{}).
		Where("tenant_id=? AND user_id=? AND id IN ?", id.TenantID, id.UserID, ids).
		Update("status", 1)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, res.Error.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"read": res.RowsAffected})
}

// Cc_Instance GET /cc/instance?instid=
func Cc_Instance(c *gin.Context) {
	instID, err := strconv.Atoi(c.Query("instid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "instid 非法")
		return
	}
	if !formReader(c, instID, 0) {
		return
	}
	var list []database.CcRecipient
	if err := DB.Where("tenant_id=? AND proc_inst_id=?", currentIdentity(c).TenantID, instID).Order("id").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, list)
}
