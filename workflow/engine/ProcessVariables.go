package engine

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

// 判断传入字符串是否是变量(是否以$开头)
func IsVariable(Key string) bool {
	if strings.HasPrefix(Key, "$") {
		return true
	}
	return false
}

// 去掉变量前缀"$"
func RemovePrefix(variable string) string {
	return strings.Replace(variable, "$", "", -1)
}

// 从proc_inst_variable表中查找变量，若有则返回变量值,若无则返回false
func SetVariable(ProcessInstanceID int, variable string) (string, bool, error) {
	return setVariableWithDB(DB, ProcessInstanceID, variable)
}

// SetVariableTx 在同一事务内读取变量（实例初始化时变量尚未提交）。
func SetVariableTx(tx *gorm.DB, ProcessInstanceID int, variable string) (string, bool, error) {
	return setVariableWithDB(tx, ProcessInstanceID, variable)
}

func setVariableWithDB(db *gorm.DB, ProcessInstanceID int, variable string) (string, bool, error) {
	if db == nil {
		db = DB
	}
	Key := RemovePrefix(variable)
	type result struct {
		Value string
	}
	var r result
	if err := db.Raw("SELECT `value` FROM `proc_inst_variable` "+
		"WHERE `proc_inst_id`=? AND `key`=? LIMIT 1", ProcessInstanceID, Key).Scan(&r).Error; err == nil {

		//判断是否有匹配的值
		exists := false
		if r.Value != "" {
			exists = true
		}

		return r.Value, exists, nil
	} else {
		return "", false, err
	}
}

// 解析变量,获取并设置其value,返回map(注意，如果不是变量，则原样存储在map中)
func ResolveVariables(ProcessInstanceID int, Variables []string) (map[string]string, error) {
	return ResolveVariablesTx(DB, ProcessInstanceID, Variables)
}

// ResolveVariablesTx 在同一事务内解析变量。
func ResolveVariablesTx(tx *gorm.DB, ProcessInstanceID int, Variables []string) (map[string]string, error) {
	result := make(map[string]string)
	for _, v := range Variables {
		if IsVariable(v) {
			value, ok, err := setVariableWithDB(tx, ProcessInstanceID, v)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, errors.New("无法匹配变量:" + v)
			}
			result[v] = value
		} else {
			result[v] = v
		}
	}
	return result, nil
}
