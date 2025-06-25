import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';
import { responsiveObserver } from '../utils/responsive-utils.js';

const logger = createLogger('app-settings');

export interface AppPreferences {
  useDirectKeyboard: boolean;
  showLogLink: boolean;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  useDirectKeyboard: false, // Default to text input field
  showLogLink: false, // Default to not showing log link
};

const STORAGE_KEY = 'vibetunnel_app_preferences';

@customElement('app-settings')
export class AppSettings extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) open = false;
  @state() private preferences: AppPreferences = DEFAULT_PREFERENCES;
  @state() private isMobile = false;
  private unsubscribeResponsive?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.loadPreferences();

    // Subscribe to responsive changes
    this.unsubscribeResponsive = responsiveObserver.subscribe((state) => {
      this.isMobile = state.isMobile;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsubscribeResponsive) {
      this.unsubscribeResponsive();
    }
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('open')) {
      console.log(
        '🔧 AppSettings open property changed:',
        changedProperties.get('open'),
        '->',
        this.open
      );
    }
  }

  private loadPreferences() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.preferences = { ...DEFAULT_PREFERENCES, ...parsed };
      }
    } catch (error) {
      logger.warn('Failed to load app preferences', { error });
    }
  }

  private savePreferences() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
      // Dispatch event so other components can react to preference changes
      window.dispatchEvent(
        new CustomEvent('app-preferences-changed', {
          detail: this.preferences,
        })
      );
    } catch (error) {
      logger.warn('Failed to save app preferences', { error });
    }
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleToggleDirectKeyboard() {
    this.preferences = {
      ...this.preferences,
      useDirectKeyboard: !this.preferences.useDirectKeyboard,
    };
    this.savePreferences();
    this.requestUpdate();
  }

  private handleToggleShowLogLink() {
    this.preferences = {
      ...this.preferences,
      showLogLink: !this.preferences.showLogLink,
    };
    this.savePreferences();
    this.requestUpdate();
  }

  render() {
    console.log('🔧 AppSettings render called, open:', this.open);
    if (!this.open) return '';

    return html`
      <!-- Modal backdrop -->
      <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        @click=${this.handleClose}>
        <div
          class="bg-dark-bg border border-dark-border rounded-lg max-w-md w-full"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-dark-border">
            <h2 class="text-lg font-semibold text-dark-text">Settings</h2>
            <button
              @click=${this.handleClose}
              class="p-1 text-dark-text-secondary hover:text-dark-text transition-colors"
              title="Close settings"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-4">
            <!-- Direct Keyboard Setting (Mobile Only) -->
            ${
              this.isMobile
                ? html`
              <div class="flex items-center justify-between py-3">
                <div class="flex-1 pr-4">
                  <label class="text-dark-text text-sm font-medium" for="direct-keyboard-toggle">
                    Use direct keyboard
                  </label>
                  <p class="text-dark-text-muted text-xs mt-1">
                    Capture keyboard input directly without showing a text field (desktop-like experience)
                  </p>
                </div>
                <button
                  id="direct-keyboard-toggle"
                  role="switch"
                  aria-checked="${this.preferences.useDirectKeyboard}"
                  @click=${this.handleToggleDirectKeyboard}
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-green focus:ring-offset-2 focus:ring-offset-dark-bg ${
                    this.preferences.useDirectKeyboard ? 'bg-accent-green' : 'bg-dark-border'
                  }"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      this.preferences.useDirectKeyboard ? 'translate-x-5' : 'translate-x-0.5'
                    }"
                  ></span>
                </button>
              </div>
            `
                : ''
            }

            <!-- Show Log Link Setting -->
            <div class="flex items-center justify-between py-3 ${this.isMobile ? 'border-t border-dark-border' : ''}">
              <div class="flex-1 pr-4">
                <label class="text-dark-text text-sm font-medium" for="show-log-link-toggle">
                  Show log link
                </label>
                <p class="text-dark-text-muted text-xs mt-1">
                  Display the logs link at the bottom right corner of the screen
                </p>
              </div>
              <button
                id="show-log-link-toggle"
                role="switch"
                aria-checked="${this.preferences.showLogLink}"
                @click=${this.handleToggleShowLogLink}
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-green focus:ring-offset-2 focus:ring-offset-dark-bg ${
                  this.preferences.showLogLink ? 'bg-accent-green' : 'bg-dark-border'
                }"
              >
                <span
                  class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    this.preferences.showLogLink ? 'translate-x-5' : 'translate-x-0.5'
                  }"
                ></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Static method to get current preferences
  static getPreferences(): AppPreferences {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PREFERENCES, ...parsed };
      }
    } catch (error) {
      logger.warn('Failed to load app preferences', { error });
    }
    return { ...DEFAULT_PREFERENCES };
  }
}
