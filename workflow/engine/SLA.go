package engine

import "time"

var taskSLA = 48 * time.Hour

// SetTaskSLA 设置任务默认 SLA 时长；<=0 恢复 48h。
func SetTaskSLA(d time.Duration) {
	if d <= 0 {
		d = 48 * time.Hour
	}
	taskSLA = d
}

// TaskSLA 返回当前默认 SLA 时长。
func TaskSLA() time.Duration { return taskSLA }
