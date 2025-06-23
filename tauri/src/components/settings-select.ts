import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface SelectChangeEvent extends CustomEvent {
  detail: {
    settingKey: string;
    value: string;
  };
}

@customElement('settings-select')
export class SettingsSelect extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .form-group {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .select-wrapper {
      position: relative;
      display: inline-block;
      width: 100%;
    }

    select {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      padding: 8px 32px 8px 12px;
      font-size: 14px;
      color: var(--text-primary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    select:hover {
      border-color: var(--border-secondary);
      background: var(--bg-hover);
    }

    select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .arrow {
      position: absolute;
      top: 50%;
      right: 12px;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-secondary);
    }

    .help {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }
  `;

  @property({ type: String })
  label = '';

  @property({ type: String })
  value = '';

  @property({ type: String })
  settingKey = '';

  @property({ type: String })
  help = '';

  @property({ type: Array })
  options: Array<{ value: string; label: string }> = [];

  private handleChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.value = select.value;
    
    this.dispatchEvent(new CustomEvent('change', {
      detail: {
        settingKey: this.settingKey,
        value: select.value
      },
      bubbles: true,
      composed: true
    }) as SelectChangeEvent);
  }

  override render() {
    return html`
      <div class="form-group">
        ${this.label ? html`<label for="${this.settingKey}">${this.label}</label>` : ''}
        <div class="select-wrapper">
          <select
            id="${this.settingKey}"
            .value=${this.value}
            @change=${this.handleChange}
          >
            ${this.options.map(option => html`
              <option value="${option.value}" ?selected=${this.value === option.value}>
                ${option.label}
              </option>
            `)}
          </select>
          <svg class="arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        ${this.help ? html`<small class="help">${this.help}</small>` : ''}
      </div>
    `;
  }
}