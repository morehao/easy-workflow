package service

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

var (
	webhookURL    string
	webhookClient = &http.Client{Timeout: 5 * time.Second}
)

// ConfigureWebhook 配置 IM/邮件网关的 HTTP webhook；失败不影响本地通知。
func ConfigureWebhook(url string, timeout time.Duration) {
	webhookURL = url
	if timeout > 0 {
		webhookClient.Timeout = timeout
	}
}

type webhookBody struct {
	Event   string              `json:"event"`
	Tenant  string              `json:"tenant_id"`
	Payload NotificationPayload `json:"payload"`
}

func sendWebhook(tenantID, event string, payload NotificationPayload) {
	if webhookURL == "" {
		return
	}
	raw, err := json.Marshal(webhookBody{Event: event, Tenant: tenantID, Payload: payload})
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := webhookClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}
