package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

func jwksServer(t *testing.T, key *rsa.PrivateKey, kid string) *httptest.Server {
	t.Helper()
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	body, err := json.Marshal(map[string]any{
		"keys": []map[string]string{{
			"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": n, "e": e,
		}},
	})
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func signTestToken(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT", "kid": kid})
	payload, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	sum := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func baseClaims() map[string]any {
	now := time.Now()
	return map[string]any{
		"iss":       "https://iam.example.com/oidc",
		"aud":       "workflow_web",
		"sub":       "person:p-1",
		"person_id": "p-1",
		"user_id":   "u-1",
		"tenant_id": "t-1",
		"groups":    []string{"workflow_approver"},
		"scope":     "openid profile",
		"iat":       now.Unix(),
		"exp":       now.Add(time.Hour).Unix(),
	}
}

func testVerifier(t *testing.T, jwksURL string) *Verifier {
	t.Helper()
	v, err := NewVerifier(VerifierConfig{
		Issuer:   "https://iam.example.com/oidc",
		Audience: "workflow_web",
		JWKSURL:  jwksURL,
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return v
}

func TestVerifyValidPersonToken(t *testing.T) {
	key := newTestKey(t)
	srv := jwksServer(t, key, "kid-1")
	v := testVerifier(t, srv.URL)
	token := signTestToken(t, key, "kid-1", baseClaims())

	id, err := v.Verify(nil, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if id.TenantID != "t-1" || id.UserID != "u-1" || id.PersonID != "p-1" {
		t.Fatalf("unexpected identity: %+v", id)
	}
	if !id.HasRole("workflow_approver") || !id.Can(PermTaskAct) {
		t.Fatalf("expected approver permissions, got %+v", id.Groups)
	}
	if id.Can(PermAdmin) {
		t.Fatal("approver must not be admin")
	}
}

func TestVerifyRejectsExpiredWrongAudienceWrongIssuer(t *testing.T) {
	key := newTestKey(t)
	srv := jwksServer(t, key, "kid-1")
	v := testVerifier(t, srv.URL)

	t.Run("expired", func(t *testing.T) {
		c := baseClaims()
		c["exp"] = time.Now().Add(-time.Minute).Unix()
		_, err := v.Verify(nil, signTestToken(t, key, "kid-1", c))
		if !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("expected invalid token, got %v", err)
		}
	})
	t.Run("wrong audience", func(t *testing.T) {
		c := baseClaims()
		c["aud"] = "another_client"
		_, err := v.Verify(nil, signTestToken(t, key, "kid-1", c))
		if !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("expected invalid token, got %v", err)
		}
	})
	t.Run("wrong issuer", func(t *testing.T) {
		c := baseClaims()
		c["iss"] = "https://evil.example.com/oidc"
		_, err := v.Verify(nil, signTestToken(t, key, "kid-1", c))
		if !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("expected invalid token, got %v", err)
		}
	})
}

func TestVerifyMachineToken(t *testing.T) {
	key := newTestKey(t)
	srv := jwksServer(t, key, "kid-1")
	v := testVerifier(t, srv.URL)
	c := baseClaims()
	c["sub"] = "ak_prefix"
	delete(c, "person_id")
	c["token_usage"] = "machine"
	c["user_id"] = "machine-user"
	id, err := v.Verify(nil, signTestToken(t, key, "kid-1", c))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !id.IsMachine || id.UserID != "machine-user" {
		t.Fatalf("unexpected machine identity: %+v", id)
	}
	if id.IsPerson() {
		t.Fatal("machine token must not be person")
	}
}

func TestVerifyRejectsUnknownKid(t *testing.T) {
	key := newTestKey(t)
	srv := jwksServer(t, key, "kid-1")
	v := testVerifier(t, srv.URL)
	_, err := v.Verify(nil, signTestToken(t, key, "kid-2", baseClaims()))
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expected invalid token, got %v", err)
	}
}
