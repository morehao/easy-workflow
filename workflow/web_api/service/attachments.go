package service

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Bunny3th/easy-workflow/workflow/auth"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/engine"
	"github.com/gin-gonic/gin"
)

var (
	attachmentDir string
	attachmentMax int64 = 20 << 20
)

// ConfigureAttachments 设置本地附件目录与单文件上限。
func ConfigureAttachments(dir string, maxBytes int64) {
	if strings.TrimSpace(dir) != "" {
		attachmentDir = dir
	}
	if maxBytes > 0 {
		attachmentMax = maxBytes
	}
}

func attachmentRoot() (string, error) {
	root := attachmentDir
	if root == "" {
		root = "./data/attachments"
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return "", err
	}
	return abs, nil
}

func randomStorageKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func safeFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if len(name) > 200 {
		name = name[len(name)-200:]
	}
	if name == "" || name == "." || name == ".." {
		name = "attachment"
	}
	return name
}

func allowedAttachmentType(ct string) bool {
	ct = strings.ToLower(strings.Split(ct, ";")[0])
	switch {
	case strings.HasPrefix(ct, "image/"):
		return true
	case ct == "application/pdf", ct == "text/plain", ct == "text/csv", ct == "application/json":
		return true
	case ct == "application/msword", ct == "application/vnd.ms-excel", ct == "application/vnd.ms-powerpoint":
		return true
	case ct == "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		ct == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		ct == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	default:
		return false
	}
}

// Attachment_Upload POST /attachment/upload (multipart: file, ProcInstID, TaskID?)
func Attachment_Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, attachmentMax+1<<20)
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		c.JSON(http.StatusBadRequest, "附件表单解析失败或文件过大")
		return
	}
	instID, err := strconv.Atoi(c.PostForm("ProcInstID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "ProcInstID 非法")
		return
	}
	taskID, _ := strconv.Atoi(c.PostForm("TaskID"))
	if _, ok := formWriter(c, instID, taskID); !ok {
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, "缺少 file")
		return
	}
	defer file.Close()
	if header.Size > attachmentMax {
		c.JSON(http.StatusRequestEntityTooLarge, fmt.Sprintf("文件超过上限 %d 字节", attachmentMax))
		return
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	head = head[:n]
	contentType := http.DetectContentType(head)
	if !allowedAttachmentType(contentType) {
		c.JSON(http.StatusUnsupportedMediaType, "不支持的文件类型："+contentType)
		return
	}
	root, err := attachmentRoot()
	if err != nil {
		c.JSON(http.StatusInternalServerError, "附件目录不可用")
		return
	}
	id := currentIdentity(c)
	key, err := randomStorageKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, "生成附件键失败")
		return
	}
	relKey := filepath.Join(id.TenantID, strconv.Itoa(instID), key)
	fullPath := filepath.Join(root, relKey)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o750); err != nil {
		c.JSON(http.StatusInternalServerError, "创建附件目录失败")
		return
	}
	tmp, err := os.CreateTemp(filepath.Dir(fullPath), ".upload-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, "创建临时文件失败")
		return
	}
	tmpName := tmp.Name()
	defer func() {
		tmp.Close()
		_ = os.Remove(tmpName)
	}()
	hasher := sha256.New()
	reader := io.MultiReader(bytes.NewReader(head), file)
	written, err := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(reader, attachmentMax+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, "写入附件失败")
		return
	}
	if written > attachmentMax {
		c.JSON(http.StatusRequestEntityTooLarge, fmt.Sprintf("文件超过上限 %d 字节", attachmentMax))
		return
	}
	if err := tmp.Close(); err != nil {
		c.JSON(http.StatusInternalServerError, "关闭附件失败")
		return
	}
	if err := os.Rename(tmpName, fullPath); err != nil {
		c.JSON(http.StatusInternalServerError, "保存附件失败")
		return
	}
	now := database.LocalTime(time.Now())
	row := database.Attachment{
		TenantID: id.TenantID, ProcInstID: instID, TaskID: taskID,
		Filename: safeFilename(header.Filename), ContentType: contentType, Size: written,
		StorageKey: relKey, SHA256: hex.EncodeToString(hasher.Sum(nil)), UploadedBy: id.UserID, CreateTime: &now,
	}
	if err := DB.Create(&row).Error; err != nil {
		_ = os.Remove(fullPath)
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	row.StorageKey = ""
	c.JSON(http.StatusOK, row)
}

// Attachment_List GET /attachment/list?instid=&taskid=
func Attachment_List(c *gin.Context) {
	instID, err := strconv.Atoi(c.Query("instid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "instid 非法")
		return
	}
	taskID, _ := strconv.Atoi(c.Query("taskid"))
	if !formReader(c, instID, taskID) {
		return
	}
	q := DB.Where("tenant_id=? AND proc_inst_id=?", currentIdentity(c).TenantID, instID)
	if taskID > 0 {
		q = q.Where("task_id=?", taskID)
	}
	var list []database.Attachment
	if err := q.Order("id desc").Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	for i := range list {
		list[i].StorageKey = ""
	}
	c.JSON(http.StatusOK, list)
}

// Attachment_Download GET /attachment/:id
func Attachment_Download(c *gin.Context) {
	attID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "附件ID非法")
		return
	}
	var row database.Attachment
	if err := DB.Where("id=? AND tenant_id=?", attID, currentIdentity(c).TenantID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, "附件不存在")
		return
	}
	if !formReader(c, row.ProcInstID, row.TaskID) {
		return
	}
	root, err := attachmentRoot()
	if err != nil {
		c.JSON(http.StatusInternalServerError, "附件目录不可用")
		return
	}
	full := filepath.Join(root, row.StorageKey)
	abs, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(abs, root+string(os.PathSeparator)) {
		c.JSON(http.StatusBadRequest, "附件路径非法")
		return
	}
	if _, err := os.Stat(abs); err != nil {
		c.JSON(http.StatusNotFound, "附件文件不存在")
		return
	}
	c.FileAttachment(abs, row.Filename)
}

// Attachment_Delete DELETE /attachment/:id
func Attachment_Delete(c *gin.Context) {
	attID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, "附件ID非法")
		return
	}
	id := currentIdentity(c)
	var row database.Attachment
	if err := DB.Where("id=? AND tenant_id=?", attID, id.TenantID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, "附件不存在")
		return
	}
	if _, ok := formWriter(c, row.ProcInstID, row.TaskID); !ok {
		return
	}
	if row.UploadedBy != id.UserID && !id.Can(auth.PermAdmin) {
		c.JSON(http.StatusForbidden, "只能删除自己上传的附件")
		return
	}
	if err := DB.Delete(&database.Attachment{}, row.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	if root, err := attachmentRoot(); err == nil {
		_ = os.Remove(filepath.Join(root, row.StorageKey))
	}
	c.JSON(http.StatusOK, gin.H{"deleted": row.ID})
}
