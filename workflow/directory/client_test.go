package directory

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDirectoryClientMemberAndBatch(t *testing.T) {
	tokenCalls := 0
	dir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/members/1":
			_, _ = w.Write([]byte(`{"userID":"1","name":"张三"}`))
		case "/members":
			_, _ = w.Write([]byte(`{"list":[{"userID":"1","name":"张三"}],"missing":["2"]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer dir.Close()
	tok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenCalls++
		if u, p, ok := r.BasicAuth(); !ok || u != "key" || p != "key" {
			http.Error(w, "bad key", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
	}))
	defer tok.Close()

	c, err := New(Config{BaseURL: dir.URL, TokenURL: tok.URL, APIKey: "key", Resource: "rpapi", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	m, err := c.Member(context.Background(), "1")
	if err != nil || m.Name != "张三" {
		t.Fatalf("member: %+v %v", m, err)
	}
	got, missing, err := c.Members(context.Background(), []string{"1", "2", "1"})
	if err != nil || got["1"].Name != "张三" || len(missing) != 1 {
		t.Fatalf("members: %+v %v %v", got, missing, err)
	}
	if tokenCalls != 1 {
		t.Fatalf("expected token cache, calls=%d", tokenCalls)
	}
	tooMany := make([]string, 101)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("id-%d", i)
	}
	if _, _, err := c.Members(context.Background(), tooMany); !errors.Is(err, ErrTooManyIDs) {
		t.Fatalf("expected ErrTooManyIDs, got %v", err)
	}
}

func TestDirectoryClientErrors(t *testing.T) {
	dir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/members/404":
			http.NotFound(w, r)
		case "/members/403":
			http.Error(w, "forbidden", http.StatusForbidden)
		case "/members/500":
			http.Error(w, "boom", http.StatusInternalServerError)
		}
	}))
	defer dir.Close()
	tok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
	}))
	defer tok.Close()
	c, err := New(Config{BaseURL: dir.URL, TokenURL: tok.URL, APIKey: "k", Resource: "r"})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		id   string
		want error
	}{
		{"404", ErrNotFound},
		{"403", ErrForbidden},
		{"500", ErrUnavailable},
	}
	for _, tc := range cases {
		_, err := c.Member(context.Background(), tc.id)
		if !errors.Is(err, tc.want) {
			t.Fatalf("%s: got %v, want %v", tc.id, err, tc.want)
		}
	}
}

func TestDirectoryTokenFailure(t *testing.T) {
	tok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad", http.StatusUnauthorized)
	}))
	defer tok.Close()
	c, err := New(Config{BaseURL: "http://127.0.0.1:1", TokenURL: tok.URL, APIKey: "k", Resource: "r"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Member(context.Background(), "1")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("got %v", err)
	}
	_ = fmt.Sprintf("%v", err)
}
