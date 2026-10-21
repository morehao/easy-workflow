package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultFormKey = "default"

type FormField struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Required    bool     `json:"required"`
	Placeholder string   `json:"placeholder,omitempty"`
	Options     []string `json:"options,omitempty"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
	MaxLength   *int     `json:"maxLength,omitempty"`
	Default     any      `json:"default,omitempty"`
}

type FormSchema struct {
	Fields []FormField `json:"fields"`
}

var formFieldNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func parseFormSchema(raw string) (FormSchema, error) {
	var s FormSchema
	if strings.TrimSpace(raw) == "" {
		return s, fmt.Errorf("表单 schema 不能为空")
	}
	if len(raw) > 64<<10 {
		return s, fmt.Errorf("表单 schema 过大（上限 64KB）")
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return s, fmt.Errorf("表单 schema 不是合法 JSON: %w", err)
	}
	return s, nil
}

func validateFormSchema(s FormSchema) error {
	if len(s.Fields) == 0 {
		return fmt.Errorf("表单至少需要一个字段")
	}
	seen := map[string]bool{}
	for _, f := range s.Fields {
		if !formFieldNameRe.MatchString(f.Name) {
			return fmt.Errorf("字段名非法：%s（只允许字母/数字/下划线，且不能以数字开头）", f.Name)
		}
		if seen[f.Name] {
			return fmt.Errorf("字段名重复：%s", f.Name)
		}
		seen[f.Name] = true
		if strings.TrimSpace(f.Label) == "" {
			return fmt.Errorf("字段[%s]缺少 label", f.Name)
		}
		switch f.Type {
		case "text", "textarea", "number", "amount", "date", "select", "switch":
		default:
			return fmt.Errorf("字段[%s]类型不支持：%s", f.Name, f.Type)
		}
		if f.Type == "select" && len(f.Options) == 0 {
			return fmt.Errorf("字段[%s]是 select，但 options 为空", f.Name)
		}
		if f.Min != nil && f.Max != nil && *f.Min > *f.Max {
			return fmt.Errorf("字段[%s] min 大于 max", f.Name)
		}
		if f.MaxLength != nil && *f.MaxLength <= 0 {
			return fmt.Errorf("字段[%s] maxLength 必须大于 0", f.Name)
		}
	}
	return nil
}

func isEmptyFormValue(v any) bool {
	if v == nil {
		return true
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}

func validateFormData(schema FormSchema, dataJSON string) error {
	if len(dataJSON) > 256<<10 {
		return fmt.Errorf("表单数据过大（上限 256KB）")
	}
	var data map[string]any
	if strings.TrimSpace(dataJSON) == "" {
		data = map[string]any{}
	} else if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return fmt.Errorf("表单数据不是合法 JSON 对象: %w", err)
	}
	allowed := map[string]FormField{}
	for _, f := range schema.Fields {
		allowed[f.Name] = f
	}
	for k := range data {
		if _, ok := allowed[k]; !ok {
			return fmt.Errorf("表单包含未定义字段：%s", k)
		}
	}
	for _, f := range schema.Fields {
		raw, ok := data[f.Name]
		if !ok || isEmptyFormValue(raw) {
			if f.Required {
				return fmt.Errorf("字段[%s]必填", f.Label)
			}
			continue
		}
		switch f.Type {
		case "text", "textarea":
			s, ok := raw.(string)
			if !ok {
				return fmt.Errorf("字段[%s]必须是字符串", f.Label)
			}
			if f.MaxLength != nil && len([]rune(s)) > *f.MaxLength {
				return fmt.Errorf("字段[%s]超过最大长度 %d", f.Label, *f.MaxLength)
			}
		case "number", "amount":
			n, ok := toFloat(raw)
			if !ok {
				return fmt.Errorf("字段[%s]必须是数字", f.Label)
			}
			if f.Min != nil && n < *f.Min {
				return fmt.Errorf("字段[%s]不能小于 %v", f.Label, *f.Min)
			}
			if f.Max != nil && n > *f.Max {
				return fmt.Errorf("字段[%s]不能大于 %v", f.Label, *f.Max)
			}
		case "date":
			s, ok := raw.(string)
			if !ok {
				return fmt.Errorf("字段[%s]必须是日期字符串", f.Label)
			}
			if _, err := time.Parse("2006-01-02", s); err != nil {
				return fmt.Errorf("字段[%s]日期格式必须是 YYYY-MM-DD", f.Label)
			}
		case "select":
			s, ok := raw.(string)
			if !ok {
				return fmt.Errorf("字段[%s]必须是字符串", f.Label)
			}
			found := false
			for _, o := range f.Options {
				if s == o {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("字段[%s]值不在 options 内", f.Label)
			}
		case "switch":
			if _, ok := raw.(bool); !ok {
				return fmt.Errorf("字段[%s]必须是布尔值", f.Label)
			}
		}
	}
	return nil
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(x, 64)
		return f, err == nil
	}
	return 0, false
}

func currentProcVersion(tenantID string, procID int) (int, error) {
	var v int
	if err := DB.Raw("SELECT version FROM proc_def WHERE id=? AND tenant_id=?", procID, tenantID).Scan(&v).Error; err != nil {
		return 0, err
	}
	return v, nil
}

func findFormTemplate(tenantID string, procID, version int, formKey string) (database.FormTemplate, error) {
	var t database.FormTemplate
	err := DB.Where("tenant_id=? AND proc_def_id=? AND proc_version=? AND form_key=?", tenantID, procID, version, formKey).First(&t).Error
	return t, err
}

func formWriter(c *gin.Context, instanceID, taskID int) (int, bool) {
	id, ok := requireAuthenticated(c)
	if !ok {
		return 0, false
	}
	inst, err := GetInstanceInfoForTenant(instanceID, id.TenantID)
	if err != nil || inst.ProcInstID == 0 {
		c.JSON(http.StatusNotFound, "流程实例不存在")
		return 0, false
	}
	if inst.Status == instanceStatusSuspended {
		c.JSON(http.StatusConflict, gin.H{"code": "WF_INSTANCE_SUSPENDED", "message": "流程已挂起，请先恢复"})
		return 0, false
	}
	if id.Can(auth.PermAdmin) || (inst.Starter == id.UserID && id.Can(auth.PermInstanceStart)) {
		return inst.ProcInstID, true
	}
	if taskID > 0 {
		task, err := GetTaskInfoForTenant(taskID, id.TenantID)
		if err == nil && (task.UserID == id.UserID || id.Can(auth.PermTaskActAdmin)) {
			return inst.ProcInstID, true
		}
	}
	abortAuth(c, http.StatusForbidden, "WF_FORM_FORBIDDEN", "not allowed to edit this form")
	return 0, false
}

func formReader(c *gin.Context, instanceID, taskID int) bool {
	id, ok := requireAuthenticated(c)
	if !ok {
		return false
	}
	inst, err := GetInstanceInfoForTenant(instanceID, id.TenantID)
	if err != nil || inst.ProcInstID == 0 {
		c.JSON(http.StatusNotFound, "流程实例不存在")
		return false
	}
	if inst.Starter == id.UserID || id.Can(auth.PermInstanceReadAll) || id.Can(auth.PermTaskActAdmin) {
		return true
	}
	if taskID > 0 {
		task, err := GetTaskInfoForTenant(taskID, id.TenantID)
		if err == nil && (task.UserID == id.UserID || id.Can(auth.PermTaskActAdmin)) {
			return true
		}
	}
	abortAuth(c, http.StatusForbidden, "WF_FORM_FORBIDDEN", "form not visible to current user")
	return false
}

// FormTemplate_Save POST /form/template
func FormTemplate_Save(c *gin.Context) {
	id, ok := requirePermission(c, auth.PermDefWrite)
	if !ok {
		return
	}
	procID, err := strconv.Atoi(c.PostForm("ProcDefID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "ProcDefID 非法")
		return
	}
	version, _ := strconv.Atoi(c.PostForm("ProcVersion"))
	if version <= 0 {
		version, err = currentProcVersion(id.TenantID, procID)
		if err != nil || version == 0 {
			c.JSON(http.StatusNotFound, "流程定义不存在")
			return
		}
	}
	if _, err := GetProcessDefineVersionForTenant(procID, version, id.TenantID); err != nil {
		c.JSON(http.StatusNotFound, "流程定义版本不存在")
		return
	}
	formKey := strings.TrimSpace(c.PostForm("FormKey"))
	if formKey == "" {
		formKey = defaultFormKey
	}
	schemaRaw := c.PostForm("SchemaJSON")
	schema, err := parseFormSchema(schemaRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, err.Error())
		return
	}
	if err := validateFormSchema(schema); err != nil {
		c.JSON(http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(c.PostForm("Name"))
	if name == "" {
		name = formKey
	}
	now := database.LocalTime(time.Now())
	var row database.FormTemplate
	err = DB.Where("tenant_id=? AND proc_def_id=? AND proc_version=? AND form_key=?", id.TenantID, procID, version, formKey).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row = database.FormTemplate{
			TenantID: id.TenantID, ProcDefID: procID, ProcVersion: version, FormKey: formKey,
			Name: name, SchemaJSON: schemaRaw, Status: 1, UpdateTime: &now,
		}
		if err := DB.Create(&row).Error; err != nil {
			c.JSON(http.StatusInternalServerError, err.Error())
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	} else {
		if err := DB.Model(&database.FormTemplate{}).Where("id=?", row.ID).
			Updates(map[string]any{"name": name, "schema_json": schemaRaw, "status": 1, "update_time": now}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, err.Error())
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ID": row.ID, "ProcDefID": procID, "ProcVersion": version, "FormKey": formKey})
}

// FormTemplate_Get GET /form/template?procid=&version=&key=
func FormTemplate_Get(c *gin.Context) {
	id, ok := requireAnyPermission(c, auth.PermDefRead, auth.PermDefWrite, auth.PermInstanceStart, auth.PermInstanceReadAll, auth.PermTaskAct, auth.PermTaskReadOwn)
	if !ok {
		return
	}
	procID, err := strconv.Atoi(c.Query("procid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "procid 非法")
		return
	}
	version, _ := strconv.Atoi(c.Query("version"))
	if version <= 0 {
		version, err = currentProcVersion(id.TenantID, procID)
		if err != nil || version == 0 {
			c.JSON(http.StatusNotFound, "流程定义不存在")
			return
		}
	}
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		key = defaultFormKey
	}
	t, err := findFormTemplate(id.TenantID, procID, version, key)
	if err != nil {
		c.JSON(http.StatusNotFound, "表单模板不存在")
		return
	}
	c.JSON(http.StatusOK, t)
}

// FormTemplate_List GET /form/templates?procid=&version=
func FormTemplate_List(c *gin.Context) {
	id, ok := requireAnyPermission(c, auth.PermDefRead, auth.PermDefWrite, auth.PermAdmin)
	if !ok {
		return
	}
	procID, err := strconv.Atoi(c.Query("procid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "procid 非法")
		return
	}
	version, _ := strconv.Atoi(c.Query("version"))
	q := DB.Where("tenant_id=? AND proc_def_id=?", id.TenantID, procID)
	if version > 0 {
		q = q.Where("proc_version=?", version)
	}
	var list []database.FormTemplate
	if err := q.Order("proc_version desc, form_key asc").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, list)
}

// FormData_Get GET /form/data?instid=&key=&taskid=
func FormData_Get(c *gin.Context) {
	instID, err := strconv.Atoi(c.Query("instid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "instid 非法")
		return
	}
	taskID, _ := strconv.Atoi(c.Query("taskid"))
	if !formReader(c, instID, taskID) {
		return
	}
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		key = defaultFormKey
	}
	var row database.FormData
	if err := DB.Where("tenant_id=? AND proc_inst_id=? AND form_key=?", currentIdentity(c).TenantID, instID, key).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, "表单数据不存在")
		return
	}
	c.JSON(http.StatusOK, row)
}

// FormData_List GET /form/data/list?instid=&taskid=
func FormData_List(c *gin.Context) {
	instID, err := strconv.Atoi(c.Query("instid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "instid 非法")
		return
	}
	taskID, _ := strconv.Atoi(c.Query("taskid"))
	if !formReader(c, instID, taskID) {
		return
	}
	var list []database.FormData
	if err := DB.Where("tenant_id=? AND proc_inst_id=?", currentIdentity(c).TenantID, instID).Order("form_key").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, list)
}

// FormData_Save POST /form/data
func FormData_Save(c *gin.Context) {
	instID, err := strconv.Atoi(c.PostForm("ProcInstID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "ProcInstID 非法")
		return
	}
	taskID, _ := strconv.Atoi(c.PostForm("TaskID"))
	if _, ok := formWriter(c, instID, taskID); !ok {
		return
	}
	key := strings.TrimSpace(c.PostForm("FormKey"))
	if key == "" {
		key = defaultFormKey
	}
	id := currentIdentity(c)
	inst, _ := GetInstanceInfoForTenant(instID, id.TenantID)
	t, err := findFormTemplate(id.TenantID, inst.ProcID, inst.ProcVersion, key)
	if err != nil {
		c.JSON(http.StatusBadRequest, "该流程版本未配置表单模板")
		return
	}
	schema, err := parseFormSchema(t.SchemaJSON)
	if err != nil {
		c.JSON(http.StatusBadRequest, err.Error())
		return
	}
	dataJSON := c.PostForm("DataJSON")
	if err := validateFormData(schema, dataJSON); err != nil {
		c.JSON(http.StatusBadRequest, err.Error())
		return
	}
	now := database.LocalTime(time.Now())
	var row database.FormData
	err = DB.Where("tenant_id=? AND proc_inst_id=? AND form_key=?", id.TenantID, instID, key).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row = database.FormData{TenantID: id.TenantID, ProcInstID: instID, FormKey: key, DataJSON: dataJSON, UpdatedBy: id.UserID, UpdateTime: &now}
		if err := DB.Create(&row).Error; err != nil {
			c.JSON(http.StatusInternalServerError, err.Error())
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	} else {
		if err := DB.Model(&database.FormData{}).Where("id=?", row.ID).
			Updates(map[string]any{"data_json": dataJSON, "updated_by": id.UserID, "update_time": now}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, err.Error())
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ID": row.ID})
}
