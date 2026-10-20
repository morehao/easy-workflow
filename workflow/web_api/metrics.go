package web_api

import (
	"fmt"
	"net/http"
	"runtime"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterMetrics 暴露最小 Prometheus 文本指标。
// 生产建议放在内网/独立端口，并加抓取鉴权。
func RegisterMetrics(e *gin.Engine, db *gorm.DB) {
	e.GET("/metrics", func(c *gin.Context) {
		c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var b []byte
		add := func(format string, args ...any) { b = append(b, []byte(fmt.Sprintf(format, args...))...) }

		var defs int64
		_ = db.Raw("SELECT COUNT(*) FROM proc_def").Scan(&defs).Error
		add("# HELP wf_proc_def_total 流程定义总数\n# TYPE wf_proc_def_total gauge\nwf_proc_def_total %d\n", defs)

		type statusCount struct {
			Status int
			N      int64
		}
		var insts []statusCount
		_ = db.Raw("SELECT `status`, COUNT(*) AS n FROM proc_inst GROUP BY `status`").Scan(&insts).Error
		add("# HELP wf_proc_inst_total 运行中实例数（按状态）\n# TYPE wf_proc_inst_total gauge\n")
		for _, s := range insts {
			add("wf_proc_inst_total{status=\"%d\"} %d\n", s.Status, s.N)
		}

		var todo int64
		_ = db.Raw("SELECT COUNT(*) FROM proc_task WHERE is_finished=0").Scan(&todo).Error
		add("# HELP wf_task_todo_total 未完成任务数\n# TYPE wf_task_todo_total gauge\nwf_task_todo_total %d\n", todo)

		var overdue int64
		_ = db.Raw("SELECT COUNT(*) FROM proc_task WHERE is_finished=0 AND due_at IS NOT NULL AND due_at<NOW()").Scan(&overdue).Error
		add("# HELP wf_task_overdue_total 已超 SLA 的未完成任务数\n# TYPE wf_task_overdue_total gauge\nwf_task_overdue_total %d\n", overdue)

		var outbox int64
		_ = db.Raw("SELECT COUNT(*) FROM wf_outbox_event WHERE status=0").Scan(&outbox).Error
		add("# HELP wf_outbox_pending 待处理 outbox 事件数\n# TYPE wf_outbox_pending gauge\nwf_outbox_pending %d\n", outbox)

		var unread int64
		_ = db.Raw("SELECT COUNT(*) FROM wf_notification WHERE status=0").Scan(&unread).Error
		add("# HELP wf_notification_unread 未读站内通知数\n# TYPE wf_notification_unread gauge\nwf_notification_unread %d\n", unread)

		add("# HELP go_goroutines 当前 goroutine 数\n# TYPE go_goroutines gauge\ngo_goroutines %d\n", runtime.NumGoroutine())
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		add("# HELP go_memstats_alloc_bytes 已分配堆字节\n# TYPE go_memstats_alloc_bytes gauge\ngo_memstats_alloc_bytes %d\n", ms.Alloc)
		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", b)
	})
}
