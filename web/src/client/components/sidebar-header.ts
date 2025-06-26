/**
 * Sidebar Header Component
 *
 * Compact header for sidebar/split view with vertical layout
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeaderBase } from './header-base.js';
import './terminal-icon.js';
import './notification-status.js';

@customElement('sidebar-header')
export class SidebarHeader extends HeaderBase {
  render() {
    const runningSessions = this.runningSessions;

    return html`
      <div
        class="app-header sidebar-header bg-dark-bg-secondary border-b border-dark-border p-3"
        style="padding-top: max(0.75rem, calc(0.75rem + env(safe-area-inset-top)));"
      >
        <!-- Compact vertical layout for sidebar -->
        <div class="flex flex-col gap-2">
          <!-- Title and logo with user menu -->
          <div class="flex items-center justify-between">
            <button
              class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group"
              title="Go to home"
              @click=${this.handleHomeClick}
            >
              <terminal-icon size="20"></terminal-icon>
              <div class="min-w-0">
                <h1
                  class="text-sm font-bold text-accent-green font-mono group-hover:underline truncate"
                >
                  VibeTunnel
                </h1>
                <p class="text-dark-text-muted text-xs font-mono">
                  ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
                </p>
              </div>
            </button>
            <div class="flex items-center gap-2">
              <notification-status
                @open-settings=${() => this.dispatchEvent(new CustomEvent('open-settings'))}
              ></notification-status>
              ${this.renderCompactUserMenu()}
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex flex-col gap-2">
            <!-- Create Session button -->
            <button
              class="btn-primary font-mono text-xs px-3 py-1.5 vt-create-button text-center w-full"
              @click=${this.handleCreateSession}
            >
              Create Session
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCompactUserMenu() {
    // When no user, don't show anything (settings accessible via notification bell)
    if (!this.currentUser) {
      return html``;
    }

    return html`
      <div class="user-menu-container relative">
        <button
          class="font-mono text-xs px-2 py-1 text-dark-text-muted hover:text-dark-text rounded border border-dark-border hover:bg-dark-bg-tertiary transition-all duration-200"
          @click=${this.toggleUserMenu}
          title="User menu"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            />
          </svg>
        </button>
        ${
          this.showUserMenu
            ? html`
              <div
                class="absolute right-0 top-full mt-1 bg-dark-surface border border-dark-border rounded-lg shadow-lg py-1 z-50 min-w-32"
              >
                <div
                  class="px-3 py-1.5 text-xs text-dark-text-muted border-b border-dark-border font-mono"
                >
                  ${this.currentUser}
                </div>
                <button
                  class="w-full text-left px-3 py-1.5 text-xs font-mono text-status-warning hover:bg-dark-bg-secondary hover:text-status-error"
                  @click=${this.handleLogout}
                >
                  Logout
                </button>
              </div>
            `
            : ''
        }
      </div>
    `;
  }
}
