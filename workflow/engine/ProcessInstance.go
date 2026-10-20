package engine

import (
	"errors"
	"fmt"
	"sync"

	"github.com/Bunny3th/easy-workflow/workflow/database"
	. "github.com/Bunny3th/easy-workflow/workflow/model"
	"gorm.io/gorm"
)

// map [NodeID]Node
type ProcNodes map[string]Node

// 定义流程cache其结构为 map [ProcID]ProcNodes（当前版本，兼容旧调用）
var ProcCache = make(map[int]ProcNodes)

// 版本化缓存：key = "<procID>:<version>"
var ProcVersionCache = make(map[string]ProcNodes)

var procCacheMu sync.RWMutex

func procVersionCacheKey(procID, version int) string {
	return fmt.Sprintf("%d:%d", procID, version)
}

// 从缓存中获取流程节点定义（当前版本，兼容旧调用）
func GetProcCache(ProcessID int) (ProcNodes, error) {
	procCacheMu.RLock()
	if nodes, ok := ProcCache[ProcessID]; ok {
		procCacheMu.RUnlock()
		return nodes, nil
	}
	procCacheMu.RUnlock()

	process, err := GetProcessDefine(ProcessID)
	if err != nil {
		return nil, err
	}
	pn := make(ProcNodes)
	for _, n := range process.Nodes {
		pn[n.NodeID] = n
	}
	procCacheMu.Lock()
	ProcCache[ProcessID] = pn
	procCacheMu.Unlock()
	return pn, nil
}

// GetProcCacheVersion 获取指定版本的流程节点定义。
// version<=0 时回退到当前版本，兼容旧实例。
func GetProcCacheVersion(ProcessID int, Version int) (ProcNodes, error) {
	if Version <= 0 {
		return GetProcCache(ProcessID)
	}
	key := procVersionCacheKey(ProcessID, Version)
	procCacheMu.RLock()
	if nodes, ok := ProcVersionCache[key]; ok {
		procCacheMu.RUnlock()
		return nodes, nil
	}
	procCacheMu.RUnlock()

	process, err := GetProcessDefineVersion(ProcessID, Version)
	if err != nil {
		return nil, err
	}
	pn := make(ProcNodes)
	for _, n := range process.Nodes {
		pn[n.NodeID] = n
	}
	procCacheMu.Lock()
	ProcVersionCache[key] = pn
	procCacheMu.Unlock()
	return pn, nil
}

func invalidateProcCache(procID int) {
	procCacheMu.Lock()
	delete(ProcCache, procID)
	prefix := fmt.Sprintf("%d:", procID)
	for k := range ProcVersionCache {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			delete(ProcVersionCache, k)
		}
	}
	procCacheMu.Unlock()
}

// 1、流程实例初始化// 1、流程实例初始化 2、保存实例变量 返回:流程实例ID、开始节点（默认租户，兼容旧调用）
func instanceInit(ProcessID int, BusinessID string, VariableJson string) (int, Node, error) {
	return instanceInitForTenant(ProcessID, BusinessID, VariableJson, DefaultTenantID)
}

// instanceInitForTenant 在指定租户下初始化实例。
func instanceInitForTenant(ProcessID int, BusinessID string, VariableJson string, tenantID string) (int, Node, error) {
	tenantID = NormalizeTenant(tenantID)

	// 先校验流程定义属于当前租户，避免用别的租户的 ProcID 发起实例。
	if _, err := GetProcessDefineForTenant(ProcessID, tenantID); err != nil {
		return 0, Node{}, err
	}

	// 获取流程定义信息（当前版本），并钉住版本加载节点
	var procDef database.ProcDef
	if err := DB.Where("id=? AND tenant_id=?", ProcessID, tenantID).First(&procDef).Error; err != nil {
		return 0, Node{}, err
	}

	//获取流程定义(流程中所有node，按当前版本)
	nodes, err := GetProcCacheVersion(ProcessID, procDef.Version)
	if err != nil {
		return 0, Node{}, err
	}

	//检查流程节点中的事件是否都已经注册
	err = VerifyEvents(ProcessID, nodes)
	if err != nil {
		return 0, Node{}, err
	}

	//获取流程开始节点ID
	type result struct {
		Node_ID string
	}
	var r result
	_, err = ExecSQL("SELECT node_id FROM `proc_execution` WHERE proc_id=? AND tenant_id=? AND proc_version=? AND node_type=0", &r, ProcessID, tenantID, procDef.Version)
	if err != nil {
		return 0, Node{}, err
	}
	if r.Node_ID == "" {
		return 0, Node{}, fmt.Errorf("无法获取流程ID为%d的开始节点", ProcessID)
	}

	//获得开始节点
	StartNode := nodes[r.Node_ID]

	//-----------------------------------开始处理数据-----------------------------------
	//1、在proc_inst表中生成一条记录
	//2、在proc_inst_variable表中记录流程实例的变量
	//3、返回proc_inst_id(流程实例ID)

	//开启事务
	tx := DB.Begin()
	//在实例表中生成一条数据
	procInst := database.ProcInst{TenantID: tenantID, ProcID: ProcessID, ProcVersion: procDef.Version, BusinessID: BusinessID, CurrentNodeID: StartNode.NodeID}
	re := tx.Create(&procInst)
	if re.Error != nil {
		tx.Rollback()
		return 0, StartNode, re.Error
	}

	//保存流程变量
	err = instanceVariablesSaveTx(tx, procInst.ID, VariableJson, tenantID)
	if err != nil {
		tx.Rollback()
		return 0, StartNode, err
	}

	//获取流程起始人
	users, err := resolveNodeUserTx(tx, procInst.ID, StartNode)
	if err != nil {
		tx.Rollback()
		return 0, StartNode, err
	}

	if len(users) < 1 {
		tx.Rollback()
		return 0, StartNode, errors.New("未指定处理人，无法处理节点:" + StartNode.NodeName)
	}

	//更新起始人到流程实例表
	re = tx.Model(&database.ProcInst{}).Where("id=?", procInst.ID).Update("starter", users[0])
	if re.Error != nil {
		tx.Rollback()
		return 0, StartNode, re.Error
	}

	//关闭事务
	tx.Commit()

	return procInst.ID, StartNode, nil
}

// 开始流程实例 返回流程实例ID（默认租户，兼容旧调用）
func InstanceStart(ProcessID int, BusinessID string, Comment string, VariablesJson string) (int, error) {
	return InstanceStartForTenant(ProcessID, BusinessID, Comment, VariablesJson, DefaultTenantID)
}

// InstanceStartForTenant 在指定租户下开始流程实例。
func InstanceStartForTenant(ProcessID int, BusinessID string, Comment string, VariablesJson string, tenantID string) (int, error) {
	//实例初始化
	InstanceID, StartNode, err := instanceInitForTenant(ProcessID, BusinessID, VariablesJson, tenantID)
	if err != nil {
		return 0, err
	}

	//开始节点处理
	err = startNodeHandle(InstanceID, &StartNode, Comment, VariablesJson)
	if err != nil {
		//需要删除刚才已经建立的实例记录、变量记录、任务记录。
		//这里已经没有必要对数据库执行做错误判断了，能删就删，删不掉也没多大关系
		DB.Where("id=?", InstanceID).Delete(database.ProcInst{})
		DB.Where("proc_inst_id=?", InstanceID).Delete(database.ProcInstVariable{})
		DB.Where("proc_inst_id=?", InstanceID).Delete(database.ProcTask{})

		return InstanceID, err
	}

	return InstanceID, nil
}

// 撤销流程实例 参数说明:
// 1、InstanceID 实例ID
// 2、Force 是否强制撤销，若为false,则只有流程回到发起人这里才能撤销
// 3、撤销发起人用户ID
func InstanceRevoke(ProcessInstanceID int, Force bool, RevokeUserID string) error {
	if !Force {
		//这段SQL判断是否当前Node就是开始Node
		sql := "SELECT a.id FROM proc_inst a " +
			"JOIN proc_execution b ON a.proc_id=b.proc_id AND a.current_node_id=b.node_id " +
			"WHERE a.id=? AND (b.prev_node_id IS NULL OR b.prev_node_id='') LIMIT 1"
		var id int
		_, err := ExecSQL(sql, &id, ProcessInstanceID)
		if err != nil {
			return err
		}
		if id == 0 {
			return errors.New("当前流程所在节点不是发起节点，无法撤销!")
		}
	}

	//-----------------------------执行流程撤销事件 start-----------------------------
	//流程ID
	ProcID, err := GetProcessIDByInstanceID(ProcessInstanceID)
	if err != nil {
		return err
	}
	//流程定义
	process, err := GetProcessDefine(ProcID)
	if err != nil {
		return err
	}

	err = RunProcEvents(process.RevokeEvents, ProcessInstanceID, RevokeUserID)
	if err != nil {
		return err
	}
	//-----------------------------执行流程撤销事件 end-----------------------------

	//调用EndNodeHandle,做数据清理归档
	err = EndNodeHandle(ProcessInstanceID, 2)
	return err
}

// 流程实例变量存入数据库（默认租户，兼容旧调用）
func InstanceVariablesSave(ProcessInstanceID int, VariablesJson string) error {
	return InstanceVariablesSaveForTenant(ProcessInstanceID, VariablesJson, DefaultTenantID)
}

// InstanceVariablesSaveForTenant 在租户内保存实例变量。
func InstanceVariablesSaveForTenant(ProcessInstanceID int, VariablesJson string, tenantID string) error {
	tx := DB.Begin()
	if err := instanceVariablesSaveTx(tx, ProcessInstanceID, VariablesJson, tenantID); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit().Error
}

// instanceVariablesSaveTx 在同一事务内保存变量，供实例初始化/任务提交复用。
func instanceVariablesSaveTx(tx *gorm.DB, ProcessInstanceID int, VariablesJson string, tenantID string) error {
	tenantID = NormalizeTenant(tenantID)
	var variables []Variable
	Json2Struct(VariablesJson, &variables)
	for _, v := range variables {
		var ProcInstVariable database.ProcInstVariable
		result := tx.Raw("SELECT * FROM proc_inst_variable WHERE tenant_id=? AND proc_inst_id=? AND `key`=? ORDER BY id LIMIT 1",
			tenantID, ProcessInstanceID, v.Key).Scan(&ProcInstVariable)
		if result.Error != nil {
			return result.Error
		}
		if ProcInstVariable.ID == 0 {
			if err := tx.Create(&database.ProcInstVariable{TenantID: tenantID, ProcInstID: ProcessInstanceID, Key: v.Key, Value: v.Value}).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Model(&database.ProcInstVariable{}).
				Where("tenant_id=? and proc_inst_id=? and `key`=?", tenantID, ProcessInstanceID, v.Key).
				Update("value", v.Value).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// GetInstanceProcVersion 取实例钉住的流程版本（活跃或历史）。
func GetInstanceProcVersion(ProcessInstanceID int) (int, error) {
	type result struct {
		ProcVersion int
	}
	var r result
	sql := "SELECT proc_version FROM proc_inst WHERE id=? UNION ALL SELECT proc_version FROM hist_proc_inst WHERE proc_inst_id=? LIMIT 1"
	if _, err := ExecSQL(sql, &r, ProcessInstanceID, ProcessInstanceID); err != nil {
		return 0, err
	}
	return r.ProcVersion, nil
}

// 获取流程实例信息（默认不限定租户，兼容旧调用）
func GetInstanceInfo(ProcessInstanceID int) (Instance, error) {
	return GetInstanceInfoForTenant(ProcessInstanceID, "")
}

// GetInstanceInfoForTenant 获取实例信息；tenantID 为空不做租户过滤。
func GetInstanceInfoForTenant(ProcessInstanceID int, tenantID string) (Instance, error) {
	var procInst Instance
	//历史信息也要兼顾
	sql := "WITH tmp_procinst AS\n" +
		"(SELECT id,tenant_id,proc_id,proc_version,business_id,starter,current_node_id,\n" +
		"create_time,`status`\n" +
		"FROM proc_inst \n" +
		"WHERE id=@instid AND CASE WHEN ''=@tenantid THEN TRUE ELSE tenant_id=@tenantid END\n" +
		"UNION ALL\n" +
		"SELECT proc_inst_id AS id,tenant_id,proc_id,proc_version,business_id,starter,current_node_id,\n" +
		"create_time,`status` \n" +
		"FROM hist_proc_inst \n" +
		"WHERE proc_inst_id=@instid AND CASE WHEN ''=@tenantid THEN TRUE ELSE tenant_id=@tenantid END)\n" +

		"SELECT a.id,a.tenant_id,a.proc_id,a.proc_version,a.business_id,a.starter,\n" +
		"a.current_node_id,a.create_time,a.`status`,b.name \n" +
		"FROM  tmp_procinst a\n" +
		"LEFT JOIN proc_def b ON a.proc_id=b.id AND a.tenant_id=b.tenant_id"

	condition := map[string]interface{}{"instid": ProcessInstanceID, "tenantid": tenantID}
	_, err := ExecSQL(sql, &procInst, condition)
	if err != nil {
		return procInst, err
	}

	return procInst, nil
}

// 获取起始人为特定用户的流程实例（默认不限定租户，兼容旧调用）
func GetInstanceStartByUser(UserID string, ProcessName string, StartIndex int, MaxRows int) ([]Instance, error) {
	return GetInstanceStartByUserForTenant(UserID, ProcessName, StartIndex, MaxRows, "")
}

// GetInstanceStartByUserForTenant 获取租户内起始人为特定用户的流程实例。
// UserID 为空表示所有用户；tenantID 为空不做租户过滤。
func GetInstanceStartByUserForTenant(UserID string, ProcessName string, StartIndex int, MaxRows int, tenantID string) ([]Instance, error) {
	var procInsts []Instance
	//历史信息也要兼顾
	sql := "WITH tmp_procinst AS\n " +
		"(SELECT id,tenant_id,proc_id,proc_version,business_id,starter,current_node_id,\n" +
		"create_time,`status`\n" +
		"FROM proc_inst \n" +
		"WHERE CASE WHEN ''=@userid THEN TRUE ELSE starter=@userid END\n" +
		"AND CASE WHEN ''=@tenantid THEN TRUE ELSE tenant_id=@tenantid END\n" +
		"UNION ALL\n" +
		"SELECT proc_inst_id AS id,tenant_id,proc_id,proc_version,business_id,starter,current_node_id,\n" +
		"create_time,`status` \n" +
		"FROM hist_proc_inst \n" +
		"WHERE CASE WHEN ''=@userid THEN TRUE ELSE starter=@userid END\n" +
		"AND CASE WHEN ''=@tenantid THEN TRUE ELSE tenant_id=@tenantid END)\n" +

		"SELECT a.id,a.tenant_id,a.proc_id,a.proc_version,a.business_id,\n" +
		"a.starter,a.current_node_id,a.create_time,a.`status`,b.name\n" +
		"FROM tmp_procinst a\n" +
		"JOIN proc_def b ON a.proc_id=b.id AND a.tenant_id=b.tenant_id\n" +
		"WHERE CASE WHEN ''=@procname THEN TRUE ELSE b.name=@procname END\n" +
		"ORDER BY a.id limit @index,@rows"

	condition := map[string]interface{}{"userid": UserID, "procname": ProcessName, "index": StartIndex, "rows": MaxRows, "tenantid": tenantID}

	_, err := ExecSQL(sql, &procInsts, condition)
	if err != nil {
		return procInsts, err
	}

	return procInsts, nil
}
