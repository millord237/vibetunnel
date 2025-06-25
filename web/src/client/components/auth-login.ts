import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AuthClient } from '../services/auth-client.js';
import { responsiveObserver } from '../utils/responsive-utils.js';
import { AppSettings } from './app-settings.js';
import './terminal-icon.js';
import './auth-quick-keys.js';

@customElement('auth-login')
export class AuthLogin extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) authClient!: AuthClient;
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';
  @state() private currentUserId = '';
  @state() private loginPassword = '';
  @state() private userAvatar = '';
  @state() private authConfig = {
    enableSSHKeys: false,
    disallowUserPassword: false,
    noAuth: false,
  };
  @state() private useDirectKeyboard = false;
  @state() private isMobile = false;
  @state() private isKeyboardFocused = false;
  private unsubscribeResponsive?: () => void;

  async connectedCallback() {
    super.connectedCallback();
    console.log('🔌 Auth login component connected');

    // Load preferences
    const preferences = AppSettings.getPreferences();
    this.useDirectKeyboard = preferences.useDirectKeyboard;

    // Subscribe to responsive changes
    this.unsubscribeResponsive = responsiveObserver.subscribe((state) => {
      this.isMobile = state.isMobile;
    });

    // Listen for preference changes
    window.addEventListener('app-preferences-changed', this.handlePreferencesChanged);

    await this.loadUserInfo();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsubscribeResponsive) {
      this.unsubscribeResponsive();
    }
    window.removeEventListener('app-preferences-changed', this.handlePreferencesChanged);
  }

  private handlePreferencesChanged = (e: Event) => {
    const event = e as CustomEvent;
    this.useDirectKeyboard = event.detail.useDirectKeyboard;
  };

  private async loadUserInfo() {
    try {
      // Load auth configuration first
      try {
        const configResponse = await fetch('/api/auth/config');
        if (configResponse.ok) {
          this.authConfig = await configResponse.json();
          console.log('⚙️ Auth config loaded:', this.authConfig);
        } else {
          console.warn('⚠️ Failed to load auth config, using defaults:', configResponse.status);
        }
      } catch (error) {
        console.error('❌ Error loading auth config:', error);
      }

      this.currentUserId = await this.authClient.getCurrentSystemUser();
      console.log('👤 Current user:', this.currentUserId);

      // Load user avatar
      this.userAvatar = await this.authClient.getUserAvatar(this.currentUserId);
      console.log('🖼️ User avatar loaded');

      // If no auth required, auto-login
      if (this.authConfig.noAuth) {
        console.log('🔓 No auth required, auto-logging in');
        this.dispatchEvent(
          new CustomEvent('auth-success', {
            detail: {
              success: true,
              userId: this.currentUserId,
              authMethod: 'no-auth',
            },
          })
        );
      }
    } catch (_error) {
      this.error = 'Failed to load user information';
    }
  }

  private async handlePasswordLogin(e: Event) {
    e.preventDefault();
    if (this.loading) return;

    console.log('🔐 Attempting password authentication...');
    this.loading = true;
    this.error = '';

    try {
      const result = await this.authClient.authenticateWithPassword(
        this.currentUserId,
        this.loginPassword
      );
      console.log('🎫 Password auth result:', result);

      if (result.success) {
        this.loginPassword = '';
        this.dispatchEvent(new CustomEvent('auth-success', { detail: result }));
      } else {
        this.error = result.error || 'Password authentication failed';
      }
    } catch (_error) {
      this.error = 'Password authentication failed';
    } finally {
      this.loading = false;
    }
  }

  private async handleSSHKeyAuth() {
    if (this.loading) return;

    console.log('🔐 Attempting SSH key authentication...');
    this.loading = true;
    this.error = '';

    try {
      const authResult = await this.authClient.authenticate(this.currentUserId);
      console.log('🎯 SSH auth result:', authResult);

      if (authResult.success) {
        this.dispatchEvent(new CustomEvent('auth-success', { detail: authResult }));
      } else {
        this.error =
          authResult.error || 'SSH key authentication failed. Please try password login.';
      }
    } catch (error) {
      console.error('SSH key authentication error:', error);
      this.error = 'SSH key authentication failed';
    } finally {
      this.loading = false;
    }
  }

  private handleShowSSHKeyManager() {
    this.dispatchEvent(new CustomEvent('show-ssh-key-manager'));
  }

  private handleKeyCapture = (e: KeyboardEvent) => {
    if (this.loading) return;

    e.preventDefault();

    if (e.key === 'Enter') {
      this.handlePasswordLogin(e);
    } else if (e.key === 'Backspace') {
      this.loginPassword = this.loginPassword.slice(0, -1);
    } else if (e.key === 'Escape') {
      this.loginPassword = '';
    } else if (e.key.length === 1) {
      this.loginPassword += e.key;
    }
  };

  private handleQuickKey = (key: string) => {
    if (this.loading) return;
    this.loginPassword += key;
  };

  private handleFocus = () => {
    this.isKeyboardFocused = true;
  };

  private handleBlur = () => {
    this.isKeyboardFocused = false;
  };

  render() {
    console.log(
      '🔍 Rendering auth login',
      'enableSSHKeys:',
      this.authConfig.enableSSHKeys,
      'noAuth:',
      this.authConfig.noAuth
    );

    return html`
      <div class="auth-container">
        <div class="w-full max-w-sm">
          <div class="auth-header">
            <div class="flex flex-col items-center gap-1 sm:gap-3 mb-2 sm:mb-8">
              <terminal-icon
                size="${this.isMobile ? '40' : '56'}"
                style="filter: drop-shadow(0 0 15px rgba(124, 230, 161, 0.4));"
              ></terminal-icon>
              <h2 class="auth-title text-xl sm:text-3xl mt-0 sm:mt-2">VibeTunnel</h2>
              <p class="auth-subtitle text-xs sm:text-sm">Please authenticate to continue</p>
            </div>
          </div>

          ${
            this.error
              ? html`
                <div class="bg-status-error text-dark-bg px-3 py-1.5 rounded mb-3 font-mono text-xs sm:text-sm" data-testid="error-message">
                  ${this.error}
                  <button
                    @click=${() => {
                      this.error = '';
                    }}
                    class="ml-2 text-dark-bg hover:text-dark-text"
                    data-testid="error-close"
                  >
                    ✕
                  </button>
                </div>
              `
              : ''
          }
          ${
            this.success
              ? html`
                <div
                  class="bg-status-success text-dark-bg px-3 py-1.5 rounded mb-3 font-mono text-xs sm:text-sm"
                >
                  ${this.success}
                  <button
                    @click=${() => {
                      this.success = '';
                    }}
                    class="ml-2 text-dark-bg hover:text-dark-text"
                  >
                    ✕
                  </button>
                </div>
              `
              : ''
          }

          <div class="auth-form">
            ${
              !this.authConfig.disallowUserPassword
                ? html`
                  <!-- Password Login Section (Primary) -->
                  <div class="p-4 sm:p-8">
                    <div class="flex flex-col items-center mb-3 sm:mb-6">
                      <div class="w-14 h-14 sm:w-20 sm:h-20 rounded-full mb-2 sm:mb-3 overflow-hidden" style="box-shadow: 0 0 20px rgba(124, 230, 161, 0.3);">
                        ${
                          this.userAvatar
                            ? html`
                              <img
                                src="${this.userAvatar}"
                                alt="User Avatar"
                                class="w-full h-full object-cover"
                                width="80"
                                height="80"
                              />
                            `
                            : html`
                              <div class="w-full h-full bg-dark-bg-secondary flex items-center justify-center">
                                <svg class="w-7 h-7 sm:w-10 sm:h-10 text-dark-text-muted" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                                </svg>
                              </div>
                            `
                        }
                      </div>
                      <p class="text-dark-text text-sm sm:text-lg font-medium">
                        Welcome back, ${this.currentUserId || '...'}
                      </p>
                    </div>
                    <form @submit=${this.handlePasswordLogin} class="space-y-3">
                      <div>
                        ${
                          this.useDirectKeyboard
                            ? html`
                            <!-- Direct keyboard capture -->
                            <div
                              class="password-capture-area bg-[#121212] border ${this.isKeyboardFocused ? 'border-accent-green shadow-glow-green-sm' : 'border-dark-border'} rounded-lg px-4 py-3 text-dark-text w-full transition-all duration-200 ease-in-out hover:border-accent-green-darker cursor-text min-h-[48px] flex items-center"
                              tabindex="0"
                              @keydown=${this.handleKeyCapture}
                              @focus=${this.handleFocus}
                              @blur=${this.handleBlur}
                              data-testid="password-capture"
                            >
                              <span class="${this.loginPassword ? 'text-dark-text' : 'text-dark-text-muted'} text-sm">
                                ${
                                  this.loginPassword
                                    ? '•'.repeat(this.loginPassword.length)
                                    : this.isKeyboardFocused
                                      ? 'Type your password...'
                                      : 'Click to enter password'
                                }
                              </span>
                            </div>
                            ${
                              this.isMobile
                                ? html`
                                <div class="mt-2">
                                  <auth-quick-keys .onKeyPress=${this.handleQuickKey}></auth-quick-keys>
                                </div>
                              `
                                : ''
                            }
                          `
                            : html`
                            <!-- Traditional input field -->
                            <input
                              type="password"
                              class="input-field"
                              data-testid="password-input"
                              placeholder="System Password"
                              .value=${this.loginPassword}
                              @input=${(e: Event) => {
                                this.loginPassword = (e.target as HTMLInputElement).value;
                              }}
                              ?disabled=${this.loading}
                              required
                            />
                          `
                        }
                      </div>
                      <button
                        type="submit"
                        class="btn-primary w-full py-2.5 sm:py-4 mt-2 text-sm sm:text-base"
                        data-testid="password-submit"
                        ?disabled=${this.loading || !this.loginPassword}
                      >
                        ${this.loading ? 'Authenticating...' : 'Login with Password'}
                      </button>
                    </form>
                  </div>
                `
                : ''
            }
            ${
              this.authConfig.disallowUserPassword
                ? html`
                  <!-- Avatar for SSH-only mode -->
                  <div class="ssh-key-item p-6 sm:p-8">
                    <div class="flex flex-col items-center mb-4 sm:mb-6">
                      <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-full mb-2 sm:mb-3 overflow-hidden border-2 border-dark-border">
                        ${
                          this.userAvatar
                            ? html`
                              <img
                                src="${this.userAvatar}"
                                alt="User Avatar"
                                class="w-full h-full object-cover"
                                width="80"
                                height="80"
                              />
                            `
                            : html`
                              <div class="w-full h-full bg-dark-bg-secondary flex items-center justify-center">
                                <svg class="w-8 h-8 sm:w-10 sm:h-10 text-dark-text-muted" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                                </svg>
                              </div>
                            `
                        }
                      </div>
                      <p class="text-dark-text text-xs sm:text-sm">
                        ${
                          this.currentUserId
                            ? `Welcome back, ${this.currentUserId}`
                            : 'Please authenticate to continue'
                        }
                      </p>
                      <p class="text-dark-text-muted text-xs mt-1 sm:mt-2">
                        SSH key authentication required
                      </p>
                    </div>
                  </div>
                `
                : ''
            }
            ${
              this.authConfig.enableSSHKeys === true
                ? html`
                  <!-- Divider (only show if password auth is also available) -->
                  ${
                    !this.authConfig.disallowUserPassword
                      ? html`
                        <div class="auth-divider py-2 sm:py-3">
                          <span>or</span>
                        </div>
                      `
                      : ''
                  }

                  <!-- SSH Key Management Section -->
                  <div class="ssh-key-item p-6 sm:p-8">
                    <div class="flex items-center justify-between mb-3 sm:mb-4">
                      <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-accent-green"></div>
                        <span class="font-mono text-xs sm:text-sm">SSH Key Management</span>
                      </div>
                      <button class="btn-ghost text-xs" data-testid="manage-keys" @click=${this.handleShowSSHKeyManager}>
                        Manage Keys
                      </button>
                    </div>

                    <div class="space-y-3">
                      <div class="bg-dark-bg border border-dark-border rounded p-3">
                        <p class="text-dark-text-muted text-xs mb-2">
                          Generate SSH keys for browser-based authentication
                        </p>
                        <p class="text-dark-text-muted text-xs">
                          💡 SSH keys work in both browser and terminal
                        </p>
                      </div>

                      <button
                        class="btn-secondary w-full py-2.5 sm:py-3 text-sm sm:text-base"
                        data-testid="ssh-login"
                        @click=${this.handleSSHKeyAuth}
                        ?disabled=${this.loading}
                      >
                        ${this.loading ? 'Authenticating...' : 'Login with SSH Key'}
                      </button>
                    </div>
                  </div>
                `
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }
}
