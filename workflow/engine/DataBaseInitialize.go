package engine

import (
	"crypto/sha256"
	"errors"
	"fmt"

	. "github.com/Bunny3th/easy-workflow/workflow/database"
	"gorm.io/gorm"
)

// 初始化数据库表
func DatabaseInitialize() error {
	// 兼容旧版本：proc_def 原唯一键只含 (name, source)，多租户后需要 (tenant_id, name, source)。
	// 先删旧键，再交给 AutoMigrate 创建新键；旧数据 tenant_id 默认 'default'，不会冲突。
	if DB.Migrator().HasIndex(&ProcDef{}, "uix_name_source") {
		if err := DB.Migrator().DropIndex(&ProcDef{}, "uix_name_source"); err != nil {
			return err
		}
	}

	err := DB.AutoMigrate(&ProcDef{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&ProcDefVersion{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&HistProcDef{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&ProcInst{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&HistProcInst{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&ProcTask{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&HistProcTask{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&ProcExecution{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&HistProcExecution{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&FormTemplate{})
	if err != nil {
		return err
	}
	err = DB.AutoMigrate(&FormData{})
	if err != nil {
		return err
	}
	err = DB.AutoMigrate(&Attachment{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&Notification{})
	if err != nil {
		return err
	}
	err = DB.AutoMigrate(&OutboxEvent{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&AuditLog{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&TaskDelegation{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&CcRecipient{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&RolePermission{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&CommandLog{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&ProcInstVariable{})
	if err != nil {
		return err
	}

	err = DB.AutoMigrate(&HistProcInstVariable{})
	if err != nil {
		return err
	}

	// 旧数据没有版本行：把当前定义回填成当前版本，保证版本化读取有基线。
	// 对“实例钉的版本早于当前版本”的历史数据无法还原旧资源，运行时回退当前定义（legacy）。
	if err := backfillProcDefVersions(); err != nil {
		return err
	}
	return nil
}

func backfillProcDefVersions() error {
	var defs []ProcDef
	if err := DB.Find(&defs).Error; err != nil {
		return err
	}
	for _, d := range defs {
		if d.Resource == "" {
			continue
		}
		var existing ProcDefVersion
		err := DB.Where("tenant_id=? AND proc_id=? AND version=?", d.TenantID, d.ID, d.Version).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(d.Resource)))
		if err := DB.Create(&ProcDefVersion{
			TenantID: d.TenantID, ProcID: d.ID, Version: d.Version, Resource: d.Resource, Checksum: checksum, Status: 1,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}
