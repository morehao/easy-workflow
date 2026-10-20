package database

// 流程定义表
type ProcDef struct {
	ID        int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;comment:流程ID"`
	TenantID  string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;uniqueIndex:uix_tenant_name_source,priority:1;index:ix_proc_def_tenant"`
	Name      string    `gorm:"column:name;type:VARCHAR(250) NOT NULL;comment:流程名字;uniqueIndex:uix_tenant_name_source,priority:2"`
	Version   int       `gorm:"column:version;type:INT UNSIGNED NOT NULL DEFAULT 1;default:1;comment:版本号"`
	Resource  string    `gorm:"column:resource;type:TEXT NOT NULL;comment:流程定义模板"`
	UserID    string    `gorm:"column:user_id;type:VARCHAR(250) NOT NULL;comment:创建者ID"`
	Source    string    `gorm:"column:source;type:VARCHAR(250) NOT NULL;uniqueIndex:uix_tenant_name_source,priority:3;comment:来源(引擎可能被多个系统、组件等使用，这里记下从哪个来源创建的流程);"`
	CreatTime LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
}

type CommonID struct {
	ID int `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
}

// 流程定义历史表
type HistProcDef struct {
	CommonID
	TenantID  string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_hist_proc_def_tenant"`
	ProcID    int       `gorm:"column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID"`
	Name      string    `gorm:"column:name;type:VARCHAR(250) NOT NULL;comment:流程名字;"`
	Version   int       `gorm:"column:version;type:INT UNSIGNED NOT NULL DEFAULT 1;default:1;comment:版本号"`
	Resource  string    `gorm:"column:resource;type:TEXT NOT NULL;comment:流程定义模板"`
	UserID    string    `gorm:"column:user_id;type:VARCHAR(250) NOT NULL;comment:创建者ID"`
	Source    string    `gorm:"column:source;type:VARCHAR(250) NOT NULL;comment:来源(引擎可能被多个系统、组件等使用，这里记下从哪个来源创建的流程);"`
	CreatTime LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
}

// 流程定义版本表（不可变）
type ProcDefVersion struct {
	ID         int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;uniqueIndex:uix_def_version,priority:1"`
	ProcID     int       `gorm:"column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID;uniqueIndex:uix_def_version,priority:2"`
	Version    int       `gorm:"column:version;type:INT UNSIGNED NOT NULL;comment:版本号;uniqueIndex:uix_def_version,priority:3"`
	Resource   string    `gorm:"column:resource;type:TEXT NOT NULL;comment:流程定义模板"`
	Checksum   string    `gorm:"column:checksum;type:CHAR(64) NOT NULL DEFAULT '';comment:SHA-256"`
	Status     int       `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 1;comment:1发布 2归档"`
	CreateTime LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
}

// 流程实例表
type ProcInst struct {
	ID            int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;comment:流程实例ID"`                       //流程实例ID
	TenantID      string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_proc_inst_tenant"` //租户ID
	ProcID        int       `gorm:"column:proc_id;type:INT NOT NULL;index:ix_proc_id;comment:流程ID"`                                      //流程ID
	ProcVersion   int       `gorm:"column:proc_version;type:INT UNSIGNED NOT NULL;comment:流程版本号"`                                        //流程版本号
	BusinessID    string    `gorm:"column:business_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:业务ID"`                         //业务ID
	Starter       string    `gorm:"index:ix_starter;column:starter;type:VARCHAR(250) NOT NULL;comment:流程发起人用户ID"`                        //流程发起人用户ID
	CurrentNodeID string    `gorm:"column:current_node_id;type:VARCHAR(250) NOT NULL;comment:当前进行节点ID"`                                  //当前进行节点ID
	CreateTime    LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`                           //创建时间
	Status        int       `gorm:"column:status;type:TINYINT DEFAULT 0 ;default 0;comment:0:未完成(审批中) 1:已完成(通过) 2:撤销"`                   //0:未完成(审批中) 1:已完成(通过) 2:撤销
}

// 流程实例历史表
type HistProcInst struct {
	CommonID
	TenantID      string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_hist_proc_inst_tenant"`
	ProcInstID    int       `gorm:"index:ix_proc_inst_id;column:proc_inst_id;type:INT UNSIGNED NOT NULL;comment:流程实例ID"`
	ProcID        int       `gorm:"column:proc_id;type:INT NOT NULL;index:ix_proc_id;comment:流程ID"`
	ProcVersion   int       `gorm:"column:proc_version;type:INT UNSIGNED NOT NULL;comment:流程版本号"`
	BusinessID    string    `gorm:"column:business_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:业务ID"`
	Starter       string    `gorm:"index:ix_starter;column:starter;type:VARCHAR(250) NOT NULL;comment:流程发起人用户ID"`
	CurrentNodeID string    `gorm:"column:current_node_id;type:VARCHAR(250) NOT NULL;comment:当前进行节点ID"`
	CreateTime    LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
	Status        int       `gorm:"column:status;type:TINYINT DEFAULT 0 ;default 0;comment:0:未完成(审批中) 1:已完成(通过) 2:撤销"`
}

// 任务表
type ProcTask struct {
	ID                 int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;comment:任务ID"`
	TenantID           string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_proc_task_tenant"`
	ProcID             int        `gorm:"index:ix_proc_id;column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID,冗余字段，偷懒用"`
	ProcInstID         int        `gorm:"index:ix_proc_inst_id;column:proc_inst_id;type:INT UNSIGNED NOT NULL;comment:流程实例ID"`
	BusinessID         string     `gorm:"column:business_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:业务ID,冗余字段,偷懒用"`
	Starter            string     `gorm:"index:ix_starter;column:starter;type:VARCHAR(250) NOT NULL;comment:流程发起人用户ID,冗余字段,偷懒用"`
	NodeID             string     `gorm:"column:node_id;type:VARCHAR(250) NOT NULL;comment:节点ID"`
	NodeName           string     `gorm:"column:node_name;type:VARCHAR(250) NOT NULL;comment:节点名称"`
	PrevNodeID         string     `gorm:"column:prev_node_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:上个处理节点ID,注意这里和execution中的上一个节点不一样，这里是实际审批处理时上个已处理节点的ID"`
	IsCosigned         int        `gorm:"column:is_cosigned;type:TINYINT DEFAULT 0;default:0;comment:0:任意一人通过即可 1:会签"`
	BatchCode          string     `gorm:"index:ix_batch_code;column:batch_code;type:VARCHAR(50) DEFAULT NULL;default:NULL;comment:批次码.节点会被驳回，一个节点可能产生多批task,用此码做分别"`
	UserID             string     `gorm:"index:ix_user_id;column:user_id;type:VARCHAR(250) NOT NULL;comment:分配用户ID"`
	Status             int        `gorm:"column:status;type:TINYINT DEFAULT 0;default:0;comment:任务状态:0:初始 1:通过 2:驳回"`
	IsFinished         int        `gorm:"column:is_finished;type:TINYINT DEFAULT 0;default:0;comment:0:任务未完成 1:处理完成.任务未必都是用户处理的，比如会签时一人驳回，其他任务系统自动设为已处理"`
	Comment            string     `gorm:"column:comment;type:TEXT;default:NULL;comment:任务备注"`
	ProcInstCreateTime LocalTime  `gorm:"column:proc_inst_create_time;type:DATETIME NOT NULL;comment:流程实例创建时间,冗余字段,偷懒用"`
	CreateTime         LocalTime  `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:系统创建任务时间"`
	FinishedTime       LocalTime  `gorm:"index:ix_finished_time;column:finished_time;type:DATETIME DEFAULT NULL;default:NULL;comment:处理任务时间"`
	DueAt              *LocalTime `gorm:"column:due_at;type:DATETIME NULL;index:ix_task_due;comment:SLA 截止时间"`
}

// 任务历史表
type HistProcTask struct {
	CommonID
	TenantID           string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_hist_proc_task_tenant"`
	TaskID             int        `gorm:"index:ix_task_id;column:task_id;type:INT UNSIGNED NOT NULL;comment:任务ID"`
	ProcID             int        `gorm:"index:ix_proc_id;column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID,冗余字段，偷懒用"`
	ProcInstID         int        `gorm:"index:ix_proc_inst_id;column:proc_inst_id;type:INT UNSIGNED NOT NULL;comment:流程实例ID"`
	BusinessID         string     `gorm:"column:business_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:业务ID,冗余字段,偷懒用"`
	Starter            string     `gorm:"index:ix_starter;column:starter;type:VARCHAR(250) NOT NULL;comment:流程发起人用户ID,冗余字段,偷懒用"`
	NodeID             string     `gorm:"column:node_id;type:VARCHAR(250) NOT NULL;comment:节点ID"`
	NodeName           string     `gorm:"column:node_name;type:VARCHAR(250) NOT NULL;comment:节点名称"`
	PrevNodeID         string     `gorm:"column:prev_node_id;type:VARCHAR(250) DEFAULT NULL;default:NULL;comment:上个处理节点ID,注意这里和execution中的上一个节点不一样，这里是实际审批处理时上个已处理节点的ID"`
	IsCosigned         int        `gorm:"column:is_cosigned;type:TINYINT DEFAULT 0;default:0;comment:0:任意一人通过即可 1:会签"`
	BatchCode          string     `gorm:"index:ix_batch_code;column:batch_code;type:VARCHAR(50) DEFAULT NULL;default:NULL;comment:批次码.节点会被驳回，一个节点可能产生多批task,用此码做分别"`
	UserID             string     `gorm:"index:ix_user_id;column:user_id;type:VARCHAR(250) NOT NULL;comment:分配用户ID"`
	Status             int        `gorm:"column:status;type:TINYINT DEFAULT 0;default:0;comment:任务状态:0:初始 1:通过 2:驳回"`
	IsFinished         int        `gorm:"column:is_finished;type:TINYINT DEFAULT 0;default:0;comment:0:任务未完成 1:处理完成.任务未必都是用户处理的，比如会签时一人驳回，其他任务系统自动设为已处理"`
	Comment            string     `gorm:"column:comment;type:TEXT;default:NULL;comment:任务备注"`
	ProcInstCreateTime LocalTime  `gorm:"column:proc_inst_create_time;type:DATETIME NOT NULL;comment:流程实例创建时间,冗余字段,偷懒用"`
	CreateTime         LocalTime  `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:系统创建任务时间"`
	FinishedTime       LocalTime  `gorm:"index:ix_finished_time;column:finished_time;type:DATETIME DEFAULT NULL;default:NULL;comment:处理任务时间"`
	DueAt              *LocalTime `gorm:"column:due_at;type:DATETIME NULL;index:ix_task_due;comment:SLA 截止时间"`
}

// 流程节点执行关系定义表
type ProcExecution struct {
	ID             int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID       string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_proc_execution_tenant"`
	ProcID         int       `gorm:"index:ix_proc_id;column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID"`
	ProcVersion    int       `gorm:"column:proc_version;type:INT UNSIGNED NOT NULL;comment:流程版本号"`
	NodeID         string    `gorm:"column:node_id;type:VARCHAR(250) NOT NULL;comment:节点ID"`
	NodeName       string    `gorm:"column:node_name;type:VARCHAR(250) NOT NULL;comment:节点名称"`
	PrevNodeID     string    `gorm:"column:prev_node_id;type:VARCHAR(250) DEFAULT NULL;default NULL;comment:上级节点ID"`
	NodeType       int       `gorm:"column:node_type;type:TINYINT NOT NULL;comment:流程类型 0:开始节点 1:任务节点 2:网关节点 3:结束节点"`
	IsCosigned     int       `gorm:"column:is_cosigned;type:TINYINT NOT NULL;comment:是否会签"`
	ApproveMode    string    `gorm:"column:approve_mode;type:VARCHAR(16) NOT NULL DEFAULT 'any';comment:any/all/sequential/percentage"`
	ApprovePercent int       `gorm:"column:approve_percent;type:INT NOT NULL DEFAULT 0;comment:比例审批百分比"`
	CreateTime     LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default NOW();comment:创建时间"`
}

// 流程节点执行关系定义历史表
type HistProcExecution struct {
	ID             int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID       string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_hist_proc_execution_tenant"`
	ProcID         int       `gorm:"index:ix_proc_id;column:proc_id;type:INT UNSIGNED NOT NULL;comment:流程ID"`
	ProcVersion    int       `gorm:"column:proc_version;type:INT UNSIGNED NOT NULL;comment:流程版本号"`
	NodeID         string    `gorm:"column:node_id;type:VARCHAR(250) NOT NULL;comment:节点ID"`
	NodeName       string    `gorm:"column:node_name;type:VARCHAR(250) NOT NULL;comment:节点名称"`
	PrevNodeID     string    `gorm:"column:prev_node_id;type:VARCHAR(250) DEFAULT NULL;default NULL;comment:上级节点ID"`
	NodeType       int       `gorm:"column:node_type;type:TINYINT NOT NULL;comment:流程类型 0:开始节点 1:任务节点 2:网关节点 3:结束节点"`
	IsCosigned     int       `gorm:"column:is_cosigned;type:TINYINT NOT NULL;comment:是否会签"`
	ApproveMode    string    `gorm:"column:approve_mode;type:VARCHAR(16) NOT NULL DEFAULT 'any';comment:any/all/sequential/percentage"`
	ApprovePercent int       `gorm:"column:approve_percent;type:INT NOT NULL DEFAULT 0;comment:比例审批百分比"`
	CreateTime     LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default NOW();comment:创建时间"`
}

// 站内通知
type Notification struct {
	ID         int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';index:ix_notif_tenant"`
	UserID     string     `gorm:"column:user_id;type:VARCHAR(64) NOT NULL;index:ix_notif_user"`
	Title      string     `gorm:"column:title;type:VARCHAR(255) NOT NULL DEFAULT '';"`
	Body       string     `gorm:"column:body;type:TEXT NULL;"`
	Link       string     `gorm:"column:link;type:VARCHAR(255) NOT NULL DEFAULT '';"`
	Status     int        `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 0;comment:0未读 1已读"`
	CreateTime *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();index:ix_notif_time"`
}

func (Notification) TableName() string { return "wf_notification" }

// Outbox：本地消息表，worker 异步转通知
type OutboxEvent struct {
	ID          int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID    string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';index:ix_outbox_tenant"`
	EventType   string     `gorm:"column:event_type;type:VARCHAR(64) NOT NULL;index:ix_outbox_type"`
	Payload     string     `gorm:"column:payload;type:TEXT NOT NULL;"`
	Status      int        `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 0;comment:0待处理 1完成 2失败"`
	Retry       int        `gorm:"column:retry;type:INT NOT NULL DEFAULT 0;"`
	AvailableAt *LocalTime `gorm:"column:available_at;type:DATETIME DEFAULT NOW();default:NOW();index:ix_outbox_available"`
	CreateTime  *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();"`
	ProcessedAt *LocalTime `gorm:"column:processed_at;type:DATETIME NULL;"`
}

func (OutboxEvent) TableName() string { return "wf_outbox_event" }

// 审计日志（写操作）
type AuditLog struct {
	ID           int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID     string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';index:ix_audit_tenant"`
	ActorID      string     `gorm:"column:actor_id;type:VARCHAR(64) NOT NULL DEFAULT '';index:ix_audit_actor"`
	Action       string     `gorm:"column:action;type:VARCHAR(255) NOT NULL DEFAULT '';index:ix_audit_action"`
	ResourceType string     `gorm:"column:resource_type;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	ResourceID   string     `gorm:"column:resource_id;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	Method       string     `gorm:"column:method;type:VARCHAR(16) NOT NULL DEFAULT '';"`
	Path         string     `gorm:"column:path;type:VARCHAR(255) NOT NULL DEFAULT '';"`
	Status       int        `gorm:"column:status;type:INT NOT NULL DEFAULT 0;"`
	IP           string     `gorm:"column:ip;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	UserAgent    string     `gorm:"column:user_agent;type:VARCHAR(255) NOT NULL DEFAULT '';"`
	RequestID    string     `gorm:"column:request_id;type:VARCHAR(64) NOT NULL DEFAULT '';index:ix_audit_request"`
	Detail       string     `gorm:"column:detail;type:TEXT NULL;"`
	CreateTime   *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();index:ix_audit_time"`
}

func (AuditLog) TableName() string { return "wf_audit_log" }

// 任务委托：FromUserID 在时间段内把任务委托给 ToUserID
type TaskDelegation struct {
	ID         int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';index:ix_delegation_tenant"`
	FromUserID string     `gorm:"column:from_user_id;type:VARCHAR(64) NOT NULL;index:ix_delegation_from"`
	ToUserID   string     `gorm:"column:to_user_id;type:VARCHAR(64) NOT NULL;index:ix_delegation_to"`
	StartTime  *LocalTime `gorm:"column:start_time;type:DATETIME NOT NULL;"`
	EndTime    *LocalTime `gorm:"column:end_time;type:DATETIME NOT NULL;"`
	Status     int        `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 1;comment:1有效 0停用"`
	CreatedBy  string     `gorm:"column:created_by;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	CreateTime *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();"`
}

func (TaskDelegation) TableName() string { return "wf_task_delegation" }

// 抄送收件人
type CcRecipient struct {
	ID         int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';uniqueIndex:uix_cc,priority:1"`
	ProcInstID int        `gorm:"column:proc_inst_id;type:INT UNSIGNED NOT NULL;uniqueIndex:uix_cc,priority:2;index:ix_cc_inst"`
	UserID     string     `gorm:"column:user_id;type:VARCHAR(64) NOT NULL;uniqueIndex:uix_cc,priority:3;index:ix_cc_user"`
	Status     int        `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 0;comment:0未读 1已读"`
	CreatedBy  string     `gorm:"column:created_by;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	CreateTime *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();"`
}

func (CcRecipient) TableName() string { return "wf_cc_recipient" }

// 租户级角色权限覆盖；无行时回退 auth.DefaultRolePermissions
type RolePermission struct {
	ID         int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';uniqueIndex:uix_role_perm,priority:1"`
	Role       string    `gorm:"column:role;type:VARCHAR(64) NOT NULL;uniqueIndex:uix_role_perm,priority:2"`
	Permission string    `gorm:"column:permission;type:VARCHAR(128) NOT NULL;uniqueIndex:uix_role_perm,priority:3"`
	CreateTime LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
}

func (RolePermission) TableName() string { return "wf_role_permission" }

// 表单模板：按流程定义版本固定 schema
type FormTemplate struct {
	ID          int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID    string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';uniqueIndex:uix_form_template,priority:1"`
	ProcDefID   int        `gorm:"column:proc_def_id;type:INT UNSIGNED NOT NULL;uniqueIndex:uix_form_template,priority:2"`
	ProcVersion int        `gorm:"column:proc_version;type:INT UNSIGNED NOT NULL;uniqueIndex:uix_form_template,priority:3"`
	FormKey     string     `gorm:"column:form_key;type:VARCHAR(64) NOT NULL;uniqueIndex:uix_form_template,priority:4"`
	Name        string     `gorm:"column:name;type:VARCHAR(128) NOT NULL DEFAULT '';comment:表单名称"`
	SchemaJSON  string     `gorm:"column:schema_json;type:LONGTEXT NOT NULL;comment:表单 schema"`
	Status      int        `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 1;comment:1启用 2停用"`
	CreateTime  *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();"`
	UpdateTime  *LocalTime `gorm:"column:update_time;type:DATETIME DEFAULT NOW();default:NOW();"`
}

func (FormTemplate) TableName() string { return "wf_form_template" }

// 表单数据：一个实例一个 form_key 一份
type FormData struct {
	ID         int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';uniqueIndex:uix_form_data,priority:1"`
	ProcInstID int        `gorm:"column:proc_inst_id;type:INT UNSIGNED NOT NULL;uniqueIndex:uix_form_data,priority:2"`
	FormKey    string     `gorm:"column:form_key;type:VARCHAR(64) NOT NULL;uniqueIndex:uix_form_data,priority:3"`
	DataJSON   string     `gorm:"column:data_json;type:LONGTEXT NOT NULL;comment:表单值"`
	UpdatedBy  string     `gorm:"column:updated_by;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	UpdateTime *LocalTime `gorm:"column:update_time;type:DATETIME DEFAULT NOW();default:NOW();"`
}

func (FormData) TableName() string { return "wf_form_data" }

// 附件元数据；文件本体在附件目录，storage_key 不含用户输入路径
type Attachment struct {
	ID          int        `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID    string     `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';index:ix_attachment_tenant"`
	ProcInstID  int        `gorm:"column:proc_inst_id;type:INT UNSIGNED NOT NULL;index:ix_attachment_inst"`
	TaskID      int        `gorm:"column:task_id;type:INT UNSIGNED NOT NULL DEFAULT 0;index:ix_attachment_task"`
	Filename    string     `gorm:"column:filename;type:VARCHAR(255) NOT NULL;"`
	ContentType string     `gorm:"column:content_type;type:VARCHAR(128) NOT NULL DEFAULT '';"`
	Size        int64      `gorm:"column:size;type:BIGINT NOT NULL DEFAULT 0;"`
	StorageKey  string     `gorm:"column:storage_key;type:VARCHAR(512) NOT NULL;uniqueIndex:uix_attachment_key"`
	SHA256      string     `gorm:"column:sha256;type:CHAR(64) NOT NULL DEFAULT '';"`
	UploadedBy  string     `gorm:"column:uploaded_by;type:VARCHAR(64) NOT NULL DEFAULT '';"`
	CreateTime  *LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();"`
}

func (Attachment) TableName() string { return "wf_attachment" }

// 幂等命令日志：同一租户 + Idempotency-Key 只执行一次
type CommandLog struct {
	ID             int       `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID       string    `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;uniqueIndex:uix_idem,priority:1"`
	IdempotencyKey string    `gorm:"column:idempotency_key;type:VARCHAR(128) NOT NULL;comment:幂等键;uniqueIndex:uix_idem,priority:2"`
	CommandType    string    `gorm:"column:command_type;type:VARCHAR(64) NOT NULL DEFAULT '';comment:命令类型"`
	RequestHash    string    `gorm:"column:request_hash;type:CHAR(64) NOT NULL DEFAULT '';comment:请求体哈希"`
	StatusCode     int       `gorm:"column:status_code;type:INT NOT NULL DEFAULT 0;comment:响应状态码"`
	ContentType    string    `gorm:"column:content_type;type:VARCHAR(128) NOT NULL DEFAULT '';comment:响应类型"`
	ResponseBody   string    `gorm:"column:response_body;type:TEXT NULL;comment:响应体"`
	Status         int       `gorm:"column:status;type:TINYINT NOT NULL DEFAULT 0;comment:0处理中 1完成 2失败"`
	CreateTime     LocalTime `gorm:"column:create_time;type:DATETIME DEFAULT NOW();default:NOW();comment:创建时间"`
	ExpiresAt      LocalTime `gorm:"column:expires_at;type:DATETIME DEFAULT NOW();default:NOW();comment:过期时间"`
}

// 流程实例变量表
type ProcInstVariable struct {
	ID         int    `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_proc_inst_variable_tenant"`
	ProcInstID int    `gorm:"index:ix_proc_inst_id;column:proc_inst_id;type:INT UNSIGNED NOT NULL;comment:流程实例ID"`
	Key        string `gorm:"column:key;type:VARCHAR(250) NOT NULL;comment:变量key"`
	Value      string `gorm:"column:value;type:VARCHAR(250) NOT NULL;comment:变量value"`
}

// 流程实例变量历史表
type HistProcInstVariable struct {
	ID         int    `gorm:"primaryKey;column:id;type:INT UNSIGNED NOT NULL AUTO_INCREMENT;"`
	TenantID   string `gorm:"column:tenant_id;type:VARCHAR(36) NOT NULL DEFAULT 'default';comment:租户ID;index:ix_hist_proc_inst_variable_tenant"`
	ProcInstID int    `gorm:"index:ix_proc_inst_id;column:proc_inst_id;type:INT UNSIGNED NOT NULL;comment:流程实例ID"`
	Key        string `gorm:"column:key;type:VARCHAR(250) NOT NULL;comment:变量key"`
	Value      string `gorm:"column:value;type:VARCHAR(250) NOT NULL;comment:变量value"`
}
