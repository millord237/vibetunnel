import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  pushNotificationService,
  type NotificationPreferences,
} from '../services/push-notification-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('notification-permission-banner');

@customElement('notification-permission-banner')
export class NotificationPermissionBanner extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private permission: NotificationPermission = 'default';
  @state() private isVisible = false;
  @state() private isLoading = false;
  @state() private preferences: NotificationPreferences | null = null;
  @state() private isDismissed = false;

  private permissionChangeUnsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.initializeComponent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.permissionChangeUnsubscribe) {
      this.permissionChangeUnsubscribe();
    }
  }

  private async initializeComponent(): Promise<void> {
    if (!pushNotificationService.isSupported()) {
      this.isVisible = false;
      return;
    }

    this.permission = pushNotificationService.getPermission();
    this.preferences = pushNotificationService.loadPreferences();
    this.isDismissed = this.loadDismissedState();

    // Show banner if notifications are supported but not granted and not dismissed
    this.isVisible = this.shouldShowBanner();

    // Listen for permission changes
    this.permissionChangeUnsubscribe = pushNotificationService.onPermissionChange((permission) => {
      this.permission = permission;
      this.isVisible = this.shouldShowBanner();
    });
  }

  private shouldShowBanner(): boolean {
    return (
      pushNotificationService.isSupported() &&
      this.permission === 'default' &&
      !this.isDismissed &&
      (!this.preferences || !this.preferences.enabled)
    );
  }

  private async handleEnable(): Promise<void> {
    this.isLoading = true;

    try {
      const permission = await pushNotificationService.requestPermission();

      if (permission === 'granted') {
        // Subscribe to push notifications
        await pushNotificationService.subscribe();

        // Enable notifications in preferences
        const preferences = pushNotificationService.loadPreferences();
        preferences.enabled = true;
        pushNotificationService.savePreferences(preferences);

        // Hide banner
        this.isVisible = false;

        // Dispatch success event
        this.dispatchEvent(
          new CustomEvent('notification-enabled', {
            detail: { success: true },
          })
        );

        logger.log('notifications enabled successfully');
      } else {
        logger.warn('notification permission denied');
        this.dispatchEvent(
          new CustomEvent('notification-enabled', {
            detail: { success: false, reason: 'Permission denied' },
          })
        );
      }
    } catch (error) {
      logger.error('failed to enable notifications:', error);
      this.dispatchEvent(
        new CustomEvent('notification-enabled', {
          detail: { success: false, reason: error.message },
        })
      );
    } finally {
      this.isLoading = false;
    }
  }

  private handleDismiss(): void {
    this.isVisible = false;
    this.isDismissed = true;
    this.saveDismissedState(true);

    this.dispatchEvent(new CustomEvent('banner-dismissed'));
    logger.log('notification banner dismissed');
  }

  private handleNotNow(): void {
    this.isVisible = false;
    // Don't mark as permanently dismissed for "not now"

    this.dispatchEvent(new CustomEvent('banner-dismissed'));
    logger.log('notification banner postponed');
  }

  private loadDismissedState(): boolean {
    try {
      const dismissed = localStorage.getItem('vibetunnel-notification-banner-dismissed');
      return dismissed === 'true';
    } catch (error) {
      logger.error('failed to load dismissed state:', error);
      return false;
    }
  }

  private saveDismissedState(dismissed: boolean): void {
    try {
      localStorage.setItem('vibetunnel-notification-banner-dismissed', String(dismissed));
    } catch (error) {
      logger.error('failed to save dismissed state:', error);
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-dark-accent to-dark-accent-hover border-b border-dark-border"
      >
        <div class="max-w-6xl mx-auto px-4 py-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <!-- Bell icon -->
              <div class="flex-shrink-0">
                <svg
                  class="w-5 h-5 text-dark-text"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 17h5l-3.5-3.5A7 7 0 0 1 17 10a7 7 0 0 0-14 0 7 7 0 0 1 .5 3.5L0 17h5m10 0v1a3 3 0 0 1-6 0v-1m6 0H9"
                  />
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-dark-text">
                  Get notified about your terminal sessions
                </p>
                <p class="text-xs text-dark-text-secondary mt-1">
                  Receive notifications when processes complete, encounter errors, or require
                  attention
                </p>
              </div>
            </div>

            <div class="flex items-center space-x-2 ml-4">
              <button
                @click=${this.handleEnable}
                ?disabled=${this.isLoading}
                class="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-dark-accent-hover text-dark-text hover:bg-dark-text hover:text-dark-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ${this.isLoading
                  ? html`
                      <svg
                        class="animate-spin -ml-1 mr-2 h-3 w-3 text-current"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Enabling...
                    `
                  : 'Enable Notifications'}
              </button>

              <button
                @click=${this.handleNotNow}
                class="px-3 py-1.5 text-xs font-medium text-dark-text-secondary hover:text-dark-text transition-colors"
              >
                Not now
              </button>

              <button
                @click=${this.handleDismiss}
                class="flex-shrink-0 p-1 text-dark-text-secondary hover:text-dark-text transition-colors"
                title="Dismiss permanently"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
