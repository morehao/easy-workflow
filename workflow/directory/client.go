// Package directory 是 ark-iam 只读目录 API 的轻量客户端。
//
// 只覆盖当前 ark-iam 已提供的契约：
//   - GET /v1/rp/directory/members/{userID}
//   - GET /v1/rp/directory/members?ids=a,b,c
//   - GET /v1/rp/directory/departments/tree
//   - GET /v1/rp/directory/roles
//
// 鉴权使用 API Key 换 M2M token（client_id == client_secret == raw key），
// scope=directory.read，resource=rpapi 的 client_id。
package directory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("directory: not found")
	ErrUnauthorized = errors.New("directory: unauthorized")
	ErrForbidden    = errors.New("directory: forbidden")
	ErrUnavailable  = errors.New("directory: unavailable")
	ErrTooManyIDs   = errors.New("directory: too many ids")
)

const MaxBatchIDs = 100

type Config struct {
	BaseURL   string
	TokenURL  string
	APIKey    string
	Resource  string
	Timeout   time.Duration
	UserAgent string
	// UseAPIKeyHeader 为 true 时直接以 x-api-key 调 rpapi（本地/内网通道），
	// 否则走 API Key 换 M2M token 的标准路径。
	UseAPIKeyHeader bool
}

type Client struct {
	baseURL         string
	tokenURL        string
	apiKey          string
	resource        string
	http            *http.Client
	ua              string
	useAPIKeyHeader bool

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

type Member struct {
	UserID          string   `json:"userID"`
	Name            string   `json:"name"`
	Avatar          string   `json:"avatar"`
	Status          string   `json:"status"`
	UserType        string   `json:"userType"`
	DepartmentNames []string `json:"departmentNames"`
}

type Department struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	ParentID string       `json:"parentID"`
	Children []Department `json:"children,omitempty"`
}

type Role struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	AppID string `json:"appID"`
}

type roleList struct {
	List      []Role `json:"list"`
	Truncated bool   `json:"truncated"`
}

type memberList struct {
	List    []Member `json:"list"`
	Missing []string `json:"missing"`
}

func New(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.TokenURL) == "" ||
		strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.Resource) == "" {
		return nil, errors.New("directory: baseURL/tokenURL/apiKey/resource are required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.UserAgent == "" {
		cfg.UserAgent = "easy-workflow-directory/1.0"
	}
	return &Client{
		baseURL:         strings.TrimRight(cfg.BaseURL, "/"),
		tokenURL:        cfg.TokenURL,
		apiKey:          cfg.APIKey,
		resource:        cfg.Resource,
		http:            &http.Client{Timeout: cfg.Timeout},
		ua:              cfg.UserAgent,
		useAPIKeyHeader: cfg.UseAPIKeyHeader,
	}, nil
}

func (c *Client) Member(ctx context.Context, userID string) (Member, error) {
	var m Member
	if err := c.get(ctx, "/members/"+url.PathEscape(userID), &m); err != nil {
		return Member{}, err
	}
	return m, nil
}

// Members 批量查询；返回命中的 map 和缺失的 id（缺失包含不存在/跨租户，API 刻意不可区分）。
func (c *Client) Members(ctx context.Context, ids []string) (map[string]Member, []string, error) {
	unique := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return map[string]Member{}, nil, nil
	}
	if len(unique) > MaxBatchIDs {
		return nil, nil, ErrTooManyIDs
	}
	var resp memberList
	if err := c.get(ctx, "/members?ids="+url.QueryEscape(strings.Join(unique, ",")), &resp); err != nil {
		return nil, nil, err
	}
	out := make(map[string]Member, len(resp.List))
	for _, m := range resp.List {
		out[m.UserID] = m
	}
	return out, resp.Missing, nil
}

func (c *Client) DepartmentTree(ctx context.Context) ([]Department, error) {
	var deps []Department
	if err := c.get(ctx, "/departments/tree", &deps); err != nil {
		return nil, err
	}
	return deps, nil
}

func (c *Client) Roles(ctx context.Context) ([]Role, bool, error) {
	var resp roleList
	if err := c.get(ctx, "/roles", &resp); err != nil {
		return nil, false, err
	}
	return resp.List, resp.Truncated, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	if c.useAPIKeyHeader {
		return c.doGet(ctx, path, "", out)
	}
	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	err = c.doGet(ctx, path, token, out)
	if errors.Is(err, ErrUnauthorized) {
		c.invalidateToken()
		token, err = c.accessToken(ctx)
		if err != nil {
			return err
		}
		err = c.doGet(ctx, path, token, out)
	}
	return err
}

func (c *Client) doGet(ctx context.Context, path, token string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if token == "" {
		req.Header.Set("x-api-key", c.apiKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.ua)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("directory: decode response: %w", err)
		}
		return nil
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbidden
	case http.StatusNotFound:
		return ErrNotFound
	default:
		return fmt.Errorf("%w: http %d: %s", ErrUnavailable, resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	if c.token != "" && time.Now().Before(c.expiresAt.Add(-60*time.Second)) {
		token := c.token
		c.mu.Unlock()
		return token, nil
	}
	c.mu.Unlock()

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("scope", "directory.read")
	form.Set("resource", c.resource)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(c.apiKey, c.apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.ua)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: token endpoint: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		return "", ErrUnauthorized
	}
	if resp.StatusCode == http.StatusForbidden {
		return "", ErrForbidden
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: token endpoint http %d: %s", ErrUnavailable, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", fmt.Errorf("directory: decode token: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("%w: empty access_token", ErrUnavailable)
	}
	if tr.ExpiresIn <= 0 {
		tr.ExpiresIn = 300
	}
	c.mu.Lock()
	c.token = tr.AccessToken
	c.expiresAt = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
	c.mu.Unlock()
	return tr.AccessToken, nil
}

func (c *Client) invalidateToken() {
	c.mu.Lock()
	c.token = ""
	c.expiresAt = time.Time{}
	c.mu.Unlock()
}
