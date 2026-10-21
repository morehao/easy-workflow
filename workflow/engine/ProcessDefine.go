package engine

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/model"
	"gorm.io/gorm"
	"strings"
)

// 流程定义解析(json->struct)
func ProcessParse(Resource string) (Process, error) {
	var process Process
	err := Json2Struct(Resource, &process)
	if err != nil {
		return Process{}, err
	}
	return process, nil
}

//todo:这里要写一个func，检查解析后的node结构，比如是否只有一个开始和结束节点

// 流程定义保存,返回 流程ID、error（默认租户，兼容旧调用）
func ProcessSave(Resource string, CreateUserID string) (int, error) {
	return ProcessSaveForTenant(Resource, CreateUserID, DefaultTenantID)
}

// ProcessSaveForTenant 在指定租户下保存流程定义；同名同来源在租户内升版本。
func ProcessSaveForTenant(Resource string, CreateUserID string, TenantID string) (int, error) {
	tenantID := NormalizeTenant(TenantID)

	//解析传入的json，获得process数据结构
	process, err := ProcessParse(Resource)
	if err != nil {
		return 0, err
	}

	if process.ProcessName == "" || process.Source == "" || CreateUserID == "" {
		return 0, errors.New("流程名称、来源、创建人ID不能为空")
	}
	if err := ValidateProcess(process); err != nil {
		return 0, err
	}

	//首先判断此工作流是否已定义（租户内）
	ProcID, Version, err := GetProcessIDByProcessNameForTenant(nil, process.ProcessName, process.Source, tenantID)
	if err != nil {
		return 0, err
	}

	//开启事务
	tx := DB.Begin()
	//判断工作流是否已经定义
	if ProcID != 0 { //已有老版本
		//需要将老版本移到历史表中
		result := tx.Exec("INSERT INTO hist_proc_def(tenant_id,proc_id,NAME,`version`,resource,user_id,source,create_time)\n        "+
			"SELECT tenant_id,id,NAME,`version`,resource,user_id,source,create_time\n"+
			"FROM proc_def WHERE NAME=? AND source=? AND tenant_id=?;", process.ProcessName, process.Source, tenantID)
		if result.Error != nil {
			tx.Rollback()
			return 0, result.Error
		}
		//而后更新现有定义
		result = tx.Model(&database.ProcDef{}).
			Where("name=? AND source=? AND tenant_id=?", process.ProcessName, process.Source, tenantID).
			Updates(database.ProcDef{Version: Version + 1, Resource: Resource, UserID: CreateUserID, CreatTime: database.LTime.Now()})
		if result.Error != nil {
			tx.Rollback()
			return 0, result.Error
		}
	} else {
		//若没有老版本，则直接插入
		procDef := database.ProcDef{TenantID: tenantID, Name: process.ProcessName, Resource: Resource, UserID: CreateUserID, Source: process.Source}
		result := tx.Create(&procDef)
		if result.Error != nil {
			tx.Rollback()
			return 0, result.Error
		}
	}
	//重新获得流程ID、版本号,此时因为是在事务中，所以需要传入tx
	ProcID, Version, err = GetProcessIDByProcessNameForTenant(tx, process.ProcessName, process.Source, tenantID)
	if err != nil {
		return 0, err
	}

	// 写入不可变版本：旧版本/旧执行行保留，实例按 proc_version 读取。
	checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(Resource)))
	var existing database.ProcDefVersion
	find := tx.Where("tenant_id=? AND proc_id=? AND version=?", tenantID, ProcID, Version).First(&existing)
	if find.Error != nil && !errors.Is(find.Error, gorm.ErrRecordNotFound) {
		tx.Rollback()
		return 0, find.Error
	}
	if errors.Is(find.Error, gorm.ErrRecordNotFound) {
		if err := tx.Create(&database.ProcDefVersion{
			TenantID: tenantID, ProcID: ProcID, Version: Version, Resource: Resource, Checksum: checksum, Status: 1,
		}).Error; err != nil {
			tx.Rollback()
			return 0, err
		}
	} else {
		if err := tx.Model(&database.ProcDefVersion{}).
			Where("tenant_id=? AND proc_id=? AND version=?", tenantID, ProcID, Version).
			Updates(map[string]any{"resource": Resource, "checksum": checksum}).Error; err != nil {
			tx.Rollback()
			return 0, err
		}
	}

	//解析node之间的关系，流程节点执行关系定义记录
	Execution := nodes2Execution(ProcID, Version, process.Nodes, tenantID)

	//将本版本的 Execution 定义插入 proc_execution；不删除旧版本行
	if len(Execution) > 0 {
		if err := tx.Create(&Execution).Error; err != nil {
			tx.Rollback()
			return 0, err
		}
	}

	//事务提交
	tx.Commit()

	//移除cache中对应流程ID/版本的内容(如果有)
	invalidateProcCache(ProcID)

	return ProcID, nil
}

// 将Node转为可被数据库表记录的执行步骤。节点的PrevNodeID可能是n个，则在数据库表中需要存n行
func nodes2Execution(ProcID int, ProcVersion int, nodes []Node, tenantID string) []database.ProcExecution {
	var executions []database.ProcExecution
	for _, n := range nodes {
		if len(n.PrevNodeIDs) <= 1 { //上级节点数<=1的情况下
			var PrevNodeID string
			if len(n.PrevNodeIDs) == 0 { //开始节点没有上级
				PrevNodeID = ""
			} else {
				PrevNodeID = n.PrevNodeIDs[0]
			}
			executions = append(executions, database.ProcExecution{
				TenantID:       tenantID,
				ProcID:         ProcID,
				ProcVersion:    ProcVersion,
				NodeID:         n.NodeID,
				NodeName:       n.NodeName,
				PrevNodeID:     PrevNodeID,
				NodeType:       int(n.NodeType),
				IsCosigned:     int(n.IsCosigned),
				ApproveMode:    n.ApproveMode,
				ApprovePercent: n.ApprovePercent,
				CreateTime:     database.LTime.Now(),
			})
		} else { //上级节点>1的情况下，则每一个上级节点都要生成一行
			for _, prev := range n.PrevNodeIDs {
				executions = append(executions, database.ProcExecution{
					TenantID:       tenantID,
					ProcID:         ProcID,
					ProcVersion:    ProcVersion,
					NodeID:         n.NodeID,
					NodeName:       n.NodeName,
					PrevNodeID:     prev,
					NodeType:       int(n.NodeType),
					IsCosigned:     int(n.IsCosigned),
					ApproveMode:    n.ApproveMode,
					ApprovePercent: n.ApprovePercent,
					CreateTime:     database.LTime.Now(),
				})
			}
		}
	}
	return executions
}

// 获取流程ID、Version by 流程名、来源（不限定租户，兼容旧调用）
//
// 设置传入参数db，是因为此函数可能在事务中执行。当在事务中执行时，需要传入对应的*gorm.DB
// 若db传参为nil，则默认使用当前默认的*gorm.DB
func GetProcessIDByProcessName(db *gorm.DB, ProcessName string, Source string) (int, int, error) {
	return GetProcessIDByProcessNameForTenant(db, ProcessName, Source, "")
}

// GetProcessIDByProcessNameForTenant 在租户内按名称/来源查流程定义。
// tenantID 为空表示不做租户过滤（仅兼容旧调用；新代码必须传租户）。
func GetProcessIDByProcessNameForTenant(db *gorm.DB, ProcessName string, Source string, tenantID string) (int, int, error) {
	type Result struct {
		ID      int
		Version int
	}
	var result Result

	var d *gorm.DB
	if db == nil {
		d = DB
	} else {
		d = db
	}

	tenantID = strings.TrimSpace(tenantID)
	var r *gorm.DB
	if tenantID == "" {
		r = d.Raw("SELECT id,version FROM proc_def where name=? and source=?", ProcessName, Source).Scan(&result)
	} else {
		r = d.Raw("SELECT id,version FROM proc_def where name=? and source=? and tenant_id=?", ProcessName, Source, tenantID).Scan(&result)
	}
	if r.Error != nil {
		return 0, 0, r.Error
	}

	return result.ID, result.Version, nil
}

// 获取流程ID by 流程实例ID
func GetProcessIDByInstanceID(ProcessInstanceID int) (int, error) {
	var ID int
	_, err := ExecSQL("SELECT proc_id FROM `proc_inst` WHERE id=?", &ID, ProcessInstanceID)
	if err != nil {
		return 0, err
	}

	return ID, nil
}

// 获取流程名称 by 流程实例ID
func GetProcessNameByInstanceID(ProcessInstanceID int) (string, error) {
	sql := "SELECT b.name FROM proc_inst a JOIN proc_def b ON a.proc_id=b.id WHERE a.id=?"
	type result struct {
		Name string
	}
	var r result
	_, err := ExecSQL(sql, &r, ProcessInstanceID)
	if err != nil {
		return "", err
	}

	return r.Name, nil
}

// 获取流程定义 by 流程ID（不限定租户，兼容旧调用）
func GetProcessDefine(ProcessID int) (Process, error) {
	return GetProcessDefineForTenant(ProcessID, "")
}

// GetProcessDefineForTenant 在租户内取流程定义；tenantID 为空不做租户过滤。
func GetProcessDefineForTenant(ProcessID int, tenantID string) (Process, error) {
	type result struct {
		Resource string
	}
	var r result
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		_, err := ExecSQL("SELECT resource FROM proc_def WHERE ID=?", &r, ProcessID)
		if err != nil {
			return Process{}, err
		}
	} else {
		_, err := ExecSQL("SELECT resource FROM proc_def WHERE ID=? AND tenant_id=?", &r, ProcessID, tenantID)
		if err != nil {
			return Process{}, err
		}
	}

	//如果数据库中没有找到ProcessID对应的流程,则直接报错
	if r.Resource == "" {
		return Process{}, errors.New("未找到对应流程定义")
	}

	return ProcessParse(r.Resource)
}

// GetProcessDefineVersion 取指定版本的流程定义；找不到版本行时回退当前定义（兼容旧数据）。
func GetProcessDefineVersion(ProcessID int, Version int) (Process, error) {
	return GetProcessDefineVersionForTenant(ProcessID, Version, "")
}

// GetProcessDefineVersionForTenant 在租户内取指定版本定义；tenantID 为空不做租户过滤。
func GetProcessDefineVersionForTenant(ProcessID int, Version int, tenantID string) (Process, error) {
	if Version <= 0 {
		return GetProcessDefineForTenant(ProcessID, tenantID)
	}
	type result struct {
		Resource string
	}
	var r result
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		if _, err := ExecSQL("SELECT resource FROM proc_def_version WHERE proc_id=? AND version=? LIMIT 1", &r, ProcessID, Version); err != nil {
			return Process{}, err
		}
	} else {
		if _, err := ExecSQL("SELECT resource FROM proc_def_version WHERE tenant_id=? AND proc_id=? AND version=? LIMIT 1", &r, tenantID, ProcessID, Version); err != nil {
			return Process{}, err
		}
	}
	if r.Resource == "" {
		// 旧数据没有版本行，回退当前定义。
		return GetProcessDefineForTenant(ProcessID, tenantID)
	}
	return ProcessParse(r.Resource)
}

// 获得某个source下所有流程信息（不限定租户，兼容旧调用）
func GetProcessList(Source string) ([]database.ProcDef, error) {
	return GetProcessListForTenant(Source, "")
}

// GetProcessListForTenant 获得租户内某个 source 下所有流程；tenantID 为空不做租户过滤。
func GetProcessListForTenant(Source string, tenantID string) ([]database.ProcDef, error) {
	var ProcessDefine []database.ProcDef
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		_, err := ExecSQL("select * from proc_def where source=?", &ProcessDefine, Source)
		return ProcessDefine, err
	}
	_, err := ExecSQL("select * from proc_def where source=? and tenant_id=?", &ProcessDefine, Source, tenantID)
	return ProcessDefine, err
}
