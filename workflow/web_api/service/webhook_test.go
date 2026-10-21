package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSendWebhook(t *testing.T) {
	got := make(chan webhookBody, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var body webhookBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		got <- body
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	ConfigureWebhook(srv.URL, time.Second)
	defer ConfigureWebhook("", time.Second)
	sendWebhook("t1", "task.assigned", NotificationPayload{UserIDs: []string{"U1"}, Title: "t"})
	select {
	case body := <-got:
		if body.Event != "task.assigned" || body.Tenant != "t1" || len(body.Payload.UserIDs) != 1 {
			t.Fatalf("unexpected: %+v", body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("webhook not received")
	}
}
