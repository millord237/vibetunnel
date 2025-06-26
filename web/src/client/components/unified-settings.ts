import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type NotificationPreferences,
  type PushSubscription,
  pushNotificationService,
} from '../services/push-notification-service.js';
import { createLogger } from '../utils/logger.js';
import { type MediaQueryState, responsiveObserver } from '../utils/responsive-utils.js';

const logger = createLogger('unified-settings');

export interface AppPreferences {
  useDirectKeyboard: boolean;
  showLogLink: boolean;
}

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  useDirectKeyboard: true, // Default to modern direct keyboard for new users
  showLogLink: false,
};

const STORAGE_KEY = 'vibetunnel_app_preferences';

@customElement('unified-settings')
export class UnifiedSettings extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;

  // Notification settings state
  @state() private notificationPreferences: NotificationPreferences = {
    enabled: false,
    sessionExit: true,
    sessionStart: false,
    sessionError: true,
    systemAlerts: true,
    soundEnabled: true,
    vibrationEnabled: true,
  };
  @state() private permission: NotificationPermission = 'default';
  @state() private subscription: PushSubscription | null = null;
  @state() private isLoading = false;
  @state() private testingNotification = false;
  @state() private hasNotificationChanges = false;

  // App settings state
  @state() private appPreferences: AppPreferences = DEFAULT_APP_PREFERENCES;
  @state() private mediaState: MediaQueryState = responsiveObserver.getCurrentState();

  private permissionChangeUnsubscribe?: () => void;
  private subscriptionChangeUnsubscribe?: () => void;
  private unsubscribeResponsive?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.initializeNotifications();
    this.loadAppPreferences();

    // Subscribe to responsive changes
    this.unsubscribeResponsive = responsiveObserver.subscribe((state) => {
      this.mediaState = state;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.permissionChangeUnsubscribe) {
      this.permissionChangeUnsubscribe();
    }
    if (this.subscriptionChangeUnsubscribe) {
      this.subscriptionChangeUnsubscribe();
    }
    if (this.unsubscribeResponsive) {
      this.unsubscribeResponsive();
    }
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('visible')) {
      if (this.visible) {
        document.addEventListener('keydown', this.handleKeyDown);
        document.startViewTransition?.(() => {
          this.requestUpdate();
        });
      } else {
        document.removeEventListener('keydown', this.handleKeyDown);
      }
    }
  }

  private async initializeNotifications(): Promise<void> {
    await pushNotificationService.waitForInitialization();

    this.permission = pushNotificationService.getPermission();
    this.subscription = pushNotificationService.getSubscription();
    this.notificationPreferences = pushNotificationService.loadPreferences();

    // Listen for changes
    this.permissionChangeUnsubscribe = pushNotificationService.onPermissionChange((permission) => {
      this.permission = permission;
    });

    this.subscriptionChangeUnsubscribe = pushNotificationService.onSubscriptionChange(
      (subscription) => {
        this.subscription = subscription;
      }
    );
  }

  private loadAppPreferences() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.appPreferences = { ...DEFAULT_APP_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (error) {
      logger.error('Failed to load app preferences', error);
    }
  }

  private saveAppPreferences() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.appPreferences));

      // Dispatch event to notify app about preference changes
      window.dispatchEvent(
        new CustomEvent('app-preferences-changed', {
          detail: this.appPreferences,
        })
      );
    } catch (error) {
      logger.error('Failed to save app preferences', error);
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.visible) {
      this.handleClose();
    }
  };

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleBackdropClick(e: Event) {
    if (e.target === e.currentTarget) {
      this.handleClose();
    }
  }

  private async handleToggleNotifications() {
    if (this.isLoading) return;

    this.isLoading = true;
    try {
      if (this.notificationPreferences.enabled) {
        // Disable notifications
        await pushNotificationService.unsubscribe();
        this.notificationPreferences = { ...this.notificationPreferences, enabled: false };
        pushNotificationService.savePreferences(this.notificationPreferences);
        this.dispatchEvent(new CustomEvent('notifications-disabled'));
      } else {
        // Enable notifications
        const permission = await pushNotificationService.requestPermission();
        if (permission === 'granted') {
          const subscription = await pushNotificationService.subscribe();
          if (subscription) {
            this.notificationPreferences = { ...this.notificationPreferences, enabled: true };
            pushNotificationService.savePreferences(this.notificationPreferences);
            this.dispatchEvent(new CustomEvent('notifications-enabled'));
          } else {
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: 'Failed to subscribe to notifications',
              })
            );
          }
        } else {
          this.dispatchEvent(
            new CustomEvent('error', {
              detail:
                permission === 'denied'
                  ? 'Notifications permission denied'
                  : 'Notifications permission not granted',
            })
          );
        }
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async handleTestNotification() {
    if (this.testingNotification) return;

    this.testingNotification = true;
    try {
      await pushNotificationService.testNotification();
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: 'Test notification sent',
        })
      );
    } finally {
      this.testingNotification = false;
    }
  }

  private async handleNotificationPreferenceChange(
    key: keyof NotificationPreferences,
    value: boolean
  ) {
    this.notificationPreferences = { ...this.notificationPreferences, [key]: value };
    this.hasNotificationChanges = true;
    pushNotificationService.savePreferences(this.notificationPreferences);
  }

  private handleAppPreferenceChange(key: keyof AppPreferences, value: boolean) {
    this.appPreferences = { ...this.appPreferences, [key]: value };
    this.saveAppPreferences();
  }

  private get isNotificationsSupported(): boolean {
    return pushNotificationService.isSupported();
  }

  private get isNotificationsEnabled(): boolean {
    return (
      this.notificationPreferences.enabled && this.permission === 'granted' && !!this.subscription
    );
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div class="modal-backdrop flex items-center justify-center" @click=${this.handleBackdropClick}>
        <div
          class="modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-2xl mx-2 sm:mx-4 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col"
          style="view-transition-name: settings-modal"
        >
          <!-- Header -->
          <div class="p-4 pb-4 border-b border-dark-border relative flex-shrink-0">
            <h2 class="text-accent-green text-lg font-bold">Settings</h2>
            <button
              class="absolute top-4 right-4 text-dark-text-muted hover:text-dark-text transition-colors p-1"
              @click=${this.handleClose}
              title="Close"
              aria-label="Close settings"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-4 space-y-6">
            ${this.renderNotificationSettings()}
            ${this.renderAppSettings()}
          </div>
        </div>
      </div>
    `;
  }

  private renderNotificationSettings() {
    return html`
      <div class="space-y-4">
        <h3 class="text-md font-bold text-dark-text mb-3">Notifications</h3>
        
        ${
          !this.isNotificationsSupported
            ? html`
              <div class="p-4 bg-dark-bg-tertiary rounded-lg border border-dark-border">
                <p class="text-dark-text-muted text-sm">
                  Push notifications are not supported in your browser.
                </p>
              </div>
            `
            : html`
              <!-- Main toggle -->
              <div class="flex items-center justify-between p-4 bg-dark-bg-tertiary rounded-lg border border-dark-border">
                <div class="flex-1">
                  <label class="text-dark-text font-medium">Enable Notifications</label>
                  <p class="text-dark-text-muted text-xs mt-1">
                    Receive alerts for session events
                  </p>
                </div>
                <button
                  class="toggle-switch ${this.isNotificationsEnabled ? 'active' : ''}"
                  @click=${this.handleToggleNotifications}
                  ?disabled=${this.isLoading}
                  aria-label="Toggle notifications"
                >
                  <span class="toggle-slider"></span>
                </button>
              </div>

              ${
                this.isNotificationsEnabled
                  ? html`
                    <!-- Notification types -->
                    <div class="space-y-2 pl-4">
                      ${this.renderNotificationToggle('sessionExit', 'Session Exit', 'When a session terminates')}
                      ${this.renderNotificationToggle('sessionStart', 'Session Start', 'When a new session starts')}
                      ${this.renderNotificationToggle('sessionError', 'Session Errors', 'When errors occur in sessions')}
                      ${this.renderNotificationToggle('systemAlerts', 'System Alerts', 'Important system notifications')}
                    </div>

                    <!-- Sound and vibration -->
                    <div class="space-y-2 pl-4 pt-2 border-t border-dark-border">
                      ${this.renderNotificationToggle('soundEnabled', 'Sound', 'Play sound with notifications')}
                      ${this.renderNotificationToggle('vibrationEnabled', 'Vibration', 'Vibrate device with notifications')}
                    </div>

                    <!-- Test button -->
                    <div class="flex justify-end pt-2">
                      <button
                        class="btn-secondary text-xs px-3 py-1.5"
                        @click=${this.handleTestNotification}
                        ?disabled=${this.testingNotification}
                      >
                        ${this.testingNotification ? 'Sending...' : 'Test Notification'}
                      </button>
                    </div>
                  `
                  : ''
              }
            `
        }
      </div>
    `;
  }

  private renderNotificationToggle(
    key: keyof NotificationPreferences,
    label: string,
    description: string
  ) {
    return html`
      <div class="flex items-center justify-between py-2">
        <div class="flex-1">
          <label class="text-dark-text text-sm">${label}</label>
          <p class="text-dark-text-muted text-xs">${description}</p>
        </div>
        <button
          class="toggle-switch small ${this.notificationPreferences[key] ? 'active' : ''}"
          @click=${() => this.handleNotificationPreferenceChange(key, !this.notificationPreferences[key])}
          aria-label="Toggle ${label}"
        >
          <span class="toggle-slider"></span>
        </button>
      </div>
    `;
  }

  private renderAppSettings() {
    return html`
      <div class="space-y-4">
        <h3 class="text-md font-bold text-dark-text mb-3">Application</h3>
        
        <!-- Direct keyboard input -->
        <div class="flex items-center justify-between p-4 bg-dark-bg-tertiary rounded-lg border border-dark-border">
          <div class="flex-1">
            <label class="text-dark-text font-medium">
              Direct Keyboard Input
              ${this.mediaState.isMobile ? html`<span class="text-status-warning text-xs ml-1">(Desktop only)</span>` : ''}
            </label>
            <p class="text-dark-text-muted text-xs mt-1">
              ${
                this.mediaState.isMobile
                  ? 'Not available on mobile devices'
                  : 'Send keyboard input directly without text field'
              }
            </p>
          </div>
          <button
            class="toggle-switch ${this.appPreferences.useDirectKeyboard ? 'active' : ''}"
            @click=${() => this.handleAppPreferenceChange('useDirectKeyboard', !this.appPreferences.useDirectKeyboard)}
            ?disabled=${this.mediaState.isMobile}
            aria-label="Toggle direct keyboard input"
          >
            <span class="toggle-slider"></span>
          </button>
        </div>

        <!-- Show log link -->
        <div class="flex items-center justify-between p-4 bg-dark-bg-tertiary rounded-lg border border-dark-border">
          <div class="flex-1">
            <label class="text-dark-text font-medium">Show Log Link</label>
            <p class="text-dark-text-muted text-xs mt-1">
              Display log link for debugging
            </p>
          </div>
          <button
            class="toggle-switch ${this.appPreferences.showLogLink ? 'active' : ''}"
            @click=${() => this.handleAppPreferenceChange('showLogLink', !this.appPreferences.showLogLink)}
            aria-label="Toggle log link"
          >
            <span class="toggle-slider"></span>
          </button>
        </div>
      </div>
    `;
  }
}
