package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 验签错误。调用方可用 errors.Is 分类映射 HTTP 状态码。
var (
	// ErrInvalidToken 表示令牌格式/签名/claim 不合法。
	ErrInvalidToken = errors.New("auth: invalid token")
	// ErrKeyUnavailable 表示 JWKS 不可用（网络/解析失败），应映射 503 而不是 401。
	ErrKeyUnavailable = errors.New("auth: key source unavailable")
)

// VerifierConfig 是本地验签配置。
type VerifierConfig struct {
	// Issuer 是 OIDC issuer（精确匹配 iss）。
	Issuer string
	// Audience 是本应用 client_id（aud 必须包含它）。
	Audience string
	// JWKSURL 可选；为空时从 Issuer 的 discovery 文档解析 jwks_uri。
	JWKSURL string
	// UserInfoURL 可选；access token 未携带 groups 时从中补齐（ark-iam 的 groups 在 userinfo/ID Token）。
	UserInfoURL string
	// Leeway 是 exp/nbf 的时钟容差，默认 30s。
	Leeway time.Duration
	// HTTPClient 可选；默认 5s 超时。
	HTTPClient *http.Client
	// RefreshInterval 是未知 kid 触发 JWKS 刷新的最小间隔，默认 1 分钟。
	RefreshInterval time.Duration
}

// Verifier 是 RS256 access token 本地验签器。
//
// 请求路径只读内存公钥；只有未知 kid 时才限频刷新 JWKS。
type Verifier struct {
	cfg VerifierConfig

	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time

	refreshMu sync.Mutex
}

// NewVerifier 构造验签器，并在启动时预取一次 JWKS。
func NewVerifier(cfg VerifierConfig) (*Verifier, error) {
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("%w: issuer is required", ErrKeyUnavailable)
	}
	if cfg.Audience == "" {
		return nil, fmt.Errorf("%w: audience is required", ErrKeyUnavailable)
	}
	if cfg.Leeway <= 0 {
		cfg.Leeway = 30 * time.Second
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 5 * time.Second}
	}
	if cfg.RefreshInterval <= 0 {
		cfg.RefreshInterval = time.Minute
	}
	v := &Verifier{cfg: cfg}
	if err := v.refresh(context.Background()); err != nil {
		return nil, err
	}
	return v, nil
}

// Verify 校验原始 access token 并返回身份。
func (v *Verifier) Verify(ctx context.Context, raw string) (*Identity, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	raw = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "Bearer "))
	if raw == "" || len(raw) > 16*1024 {
		return nil, fmt.Errorf("%w: empty or oversized token", ErrInvalidToken)
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: malformed JWT", ErrInvalidToken)
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("%w: bad header encoding", ErrInvalidToken)
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
		Typ string `json:"typ"`
		Jwk string `json:"jwk"`
		Jku string `json:"jku"`
		X5u string `json:"x5u"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("%w: bad header json", ErrInvalidToken)
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("%w: unsupported alg %q", ErrInvalidToken, header.Alg)
	}
	if header.Kid == "" {
		return nil, fmt.Errorf("%w: missing kid", ErrInvalidToken)
	}
	// 拒绝让令牌自带密钥分发信息的 JOSE 头（SSRF/密钥替换入口）。
	if header.Jwk != "" || header.Jku != "" || header.X5u != "" {
		return nil, fmt.Errorf("%w: forbidden JOSE header", ErrInvalidToken)
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: bad payload encoding", ErrInvalidToken)
	}
	var claims map[string]any
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, fmt.Errorf("%w: bad payload json", ErrInvalidToken)
	}

	if err := v.verifySignature(ctx, header.Kid, parts[0]+"."+parts[1], parts[2]); err != nil {
		return nil, err
	}
	if err := v.verifyClaims(claims, time.Now()); err != nil {
		return nil, err
	}
	return identityFromClaims(claims)
}

func (v *Verifier) verifySignature(ctx context.Context, kid, signingInput, sigPart string) error {
	key, ok := v.key(kid)
	if !ok {
		// 未知 kid：限频刷新一次，支持 ark-iam 密钥轮换而不重启。
		if err := v.refresh(ctx); err != nil {
			return err
		}
		key, ok = v.key(kid)
		if !ok {
			return fmt.Errorf("%w: unknown kid", ErrInvalidToken)
		}
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil {
		return fmt.Errorf("%w: bad signature encoding", ErrInvalidToken)
	}
	sum := sha256.Sum256([]byte(signingInput))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); err != nil {
		return fmt.Errorf("%w: bad signature", ErrInvalidToken)
	}
	return nil
}

func (v *Verifier) verifyClaims(claims map[string]any, now time.Time) error {
	iss, _ := claims["iss"].(string)
	if v.cfg.Issuer != "" && iss != v.cfg.Issuer {
		return fmt.Errorf("%w: bad issuer", ErrInvalidToken)
	}
	if !audienceMatches(claims["aud"], v.cfg.Audience) {
		return fmt.Errorf("%w: bad audience", ErrInvalidToken)
	}
	exp, ok := asInt64(claims["exp"])
	if !ok {
		return fmt.Errorf("%w: missing exp", ErrInvalidToken)
	}
	if now.After(time.Unix(exp, 0).Add(v.cfg.Leeway)) {
		return fmt.Errorf("%w: token expired", ErrInvalidToken)
	}
	if nbf, ok := asInt64(claims["nbf"]); ok {
		if now.Add(v.cfg.Leeway).Before(time.Unix(nbf, 0)) {
			return fmt.Errorf("%w: token not yet valid", ErrInvalidToken)
		}
	}
	if iat, ok := asInt64(claims["iat"]); ok {
		if now.Add(v.cfg.Leeway).Before(time.Unix(iat, 0)) {
			return fmt.Errorf("%w: issued in the future", ErrInvalidToken)
		}
	}
	return nil
}

// UserInfo 使用 access token 调 OIDC userinfo，补齐 groups 等声明。
func (v *Verifier) UserInfo(ctx context.Context, raw string) (map[string]any, error) {
	if v == nil || v.cfg.UserInfoURL == "" {
		return nil, fmt.Errorf("%w: userinfo endpoint is not configured", ErrKeyUnavailable)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	raw = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "Bearer "))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.cfg.UserInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+raw)
	req.Header.Set("Accept", "application/json")
	resp, err := v.cfg.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: userinfo request: %v", ErrKeyUnavailable, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: userinfo status %d", ErrInvalidToken, resp.StatusCode)
	}
	var info map[string]any
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("%w: userinfo decode: %v", ErrInvalidToken, err)
	}
	return info, nil
}

func (v *Verifier) key(kid string) (*rsa.PublicKey, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	k, ok := v.keys[kid]
	return k, ok
}

// refresh 拉取 discovery + JWKS；并发调用只允许一个实际请求。
func (v *Verifier) refresh(ctx context.Context) error {
	v.refreshMu.Lock()
	defer v.refreshMu.Unlock()

	// 双检：等锁期间可能已被其他 goroutine 刷新。
	v.mu.RLock()
	last := v.fetchedAt
	v.mu.RUnlock()
	if !last.IsZero() && time.Since(last) < v.cfg.RefreshInterval {
		// 仍在限频窗口内，但调用方可能需要新 kid；返回已有 key 集，
		// 由 verifySignature 判定 unknown kid。这里不报错，避免把轮换窗口变成 503。
		return nil
	}

	jwksURL := v.cfg.JWKSURL
	if jwksURL == "" {
		discoveryURL := strings.TrimRight(v.cfg.Issuer, "/") + "/.well-known/openid-configuration"
		var disc struct {
			JWKSURI string `json:"jwks_uri"`
		}
		if err := v.getJSON(ctx, discoveryURL, &disc); err != nil {
			return fmt.Errorf("%w: discovery: %v", ErrKeyUnavailable, err)
		}
		if disc.JWKSURI == "" {
			return fmt.Errorf("%w: discovery has no jwks_uri", ErrKeyUnavailable)
		}
		jwksURL = disc.JWKSURI
	}

	var set struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Use string `json:"use"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := v.getJSON(ctx, jwksURL, &set); err != nil {
		return fmt.Errorf("%w: jwks: %v", ErrKeyUnavailable, err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		if k.Alg != "" && k.Alg != "RS256" {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil || len(n) == 0 {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil || len(eBytes) == 0 || len(eBytes) > 4 {
			continue
		}
		var e int
		for _, b := range eBytes {
			e = e<<8 | int(b)
		}
		if e < 3 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: e}
	}
	if len(keys) == 0 {
		return fmt.Errorf("%w: no usable RSA keys", ErrKeyUnavailable)
	}
	v.mu.Lock()
	v.keys = keys
	v.fetchedAt = time.Now()
	v.mu.Unlock()
	return nil
}

func (v *Verifier) getJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := v.cfg.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

func audienceMatches(raw any, want string) bool {
	if want == "" {
		return true
	}
	switch v := raw.(type) {
	case string:
		return v == want
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && s == want {
				return true
			}
		}
	case []string:
		for _, s := range v {
			if s == want {
				return true
			}
		}
	}
	return false
}

func identityFromClaims(claims map[string]any) (*Identity, error) {
	id := &Identity{
		TenantID:  stringClaim(claims, "tenant_id"),
		UserID:    stringClaim(claims, "user_id"),
		PersonID:  stringClaim(claims, "person_id"),
		ClientID:  stringClaim(claims, "client_id"),
		SessionID: stringClaim(claims, "sid"),
		Scopes:    strings.Fields(stringClaim(claims, "scope")),
		Groups:    NormalizeGroups(stringSlice(claims["groups"])),
		Source:    "oidc",
	}
	if usage := stringClaim(claims, "token_usage"); usage == "machine" {
		id.IsMachine = true
	}
	if id.PersonID == "" {
		if sub := stringClaim(claims, "sub"); strings.HasPrefix(sub, "person:") {
			id.PersonID = strings.TrimPrefix(sub, "person:")
		}
	}
	if act, ok := claims["act"].(map[string]any); ok {
		id.ActorID = stringClaim(act, "sub")
	}
	if id.UserID == "" {
		return nil, fmt.Errorf("%w: missing user_id", ErrInvalidToken)
	}
	if !id.IsMachine && id.PersonID == "" {
		return nil, fmt.Errorf("%w: person token without person id", ErrInvalidToken)
	}
	return id, nil
}

func stringClaim(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	s, _ := m[key].(string)
	return s
}

func stringSlice(raw any) []string {
	switch v := raw.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v == "" {
			return nil
		}
		return strings.Split(v, ",")
	default:
		return nil
	}
}

func asInt64(raw any) (int64, bool) {
	switch v := raw.(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case int:
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}
