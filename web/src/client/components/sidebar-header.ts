/**
 * Sidebar Header Component
 *
 * Compact header for sidebar/split view with vertical layout
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeaderBase } from './header-base.js';
import './terminal-icon.js';

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
          <!-- Title and logo -->
          <a
            href="/"
            class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group"
            title="Go to home"
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
          </a>

          <!-- Create Session button -->
          <button
            class="btn-primary font-mono text-xs px-3 py-1.5 vt-create-button text-center w-full"
            @click=${this.handleCreateSession}
          >
            Create Session
          </button>
        </div>
      </div>
    `;
  }
}
