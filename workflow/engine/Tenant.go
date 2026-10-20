package engine

import "strings"

// DefaultTenantID 是历史数据/未启用租户时的默认租户。
const DefaultTenantID = "default"

// NormalizeTenant 归一化租户 ID：空值落到 default，避免历史数据出现空租户。
func NormalizeTenant(tenantID string) string {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return DefaultTenantID
	}
	return tenantID
}
