package middleware

import (
	"encoding/base64"
	"net/http"
	"strings"
)

// AuthConfig represents authentication configuration
type AuthConfig struct {
	BasicAuthUsername string
	BasicAuthPassword string
	IsHQMode          bool
	BearerToken       string // Token that HQ must use to authenticate with this remote
}

// AuthMiddleware handles authentication (Basic Auth and Bearer tokens)
type AuthMiddleware struct {
	config AuthConfig
}

// NewAuthMiddleware creates a new authentication middleware
func NewAuthMiddleware(config AuthConfig) *AuthMiddleware {
	return &AuthMiddleware{
		config: config,
	}
}

// Authenticate returns a middleware handler that enforces authentication
func (am *AuthMiddleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check endpoint
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}

		// If no auth configured, allow all requests
		if am.config.BasicAuthUsername == "" || am.config.BasicAuthPassword == "" {
			next.ServeHTTP(w, r)
			return
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			am.unauthorized(w)
			return
		}

		// Check for Bearer token (for HQ to remote communication)
		if strings.HasPrefix(auth, "Bearer ") {
			token := strings.TrimPrefix(auth, "Bearer ")
			// In HQ mode, bearer tokens are not accepted (HQ uses basic auth)
			if am.config.IsHQMode {
				w.Header().Set("WWW-Authenticate", `Basic realm="VibeTunnel"`)
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"error":"Bearer token not accepted in HQ mode"}`))
				return
			} else if am.config.BearerToken != "" && token == am.config.BearerToken {
				// Token matches what this remote server expects from HQ
				next.ServeHTTP(w, r)
				return
			}
		}

		// Check Basic auth
		if strings.HasPrefix(auth, "Basic ") {
			decoded, err := base64.StdEncoding.DecodeString(auth[len("Basic "):])
			if err != nil {
				am.unauthorized(w)
				return
			}

			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 2 && parts[0] == am.config.BasicAuthUsername && parts[1] == am.config.BasicAuthPassword {
				next.ServeHTTP(w, r)
				return
			}
		}

		am.unauthorized(w)
	})
}

func (am *AuthMiddleware) unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="VibeTunnel"`)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"Authentication required"}`))
}
