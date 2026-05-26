/**
 * FastWayShare — advancedOptions.js
 * UI Component for managing advanced options (E2E AES encryption, custom ICE, local mode, etc.).
 * Integrates directly with SettingsStore.
 */

import { settings } from '../core/settings.js';
import { t } from '../i18n/i18n.js';
import { addRipple } from '../utils/helpers.js';

export function createAdvancedOptions() {
  const el = document.createElement('div');
  el.className = 'advanced-options-container';
  
  // Initial state
  const aesEnabled = settings.get('aesEnabled');
  const aesPassphrase = settings.get('aesPassphrase') || '';
  const stunServers = settings.get('stunServers') || [];
  const turnUrls = settings.get('turnUrls') || '';
  const turnUsername = settings.get('turnUsername') || '';
  const turnCredential = settings.get('turnCredential') || '';
  const parallelChannels = settings.get('parallelChannels');

  el.innerHTML = `
    <div class="adv-header" id="adv-toggle">
      <span class="adv-title">
        ⚙️ <span data-i18n="options.title">${t('options.title') || 'Advanced Options'}</span>
      </span>
      <span class="adv-chevron" id="adv-chevron">▼</span>
    </div>
    
    <div class="adv-body collapsed" id="adv-body">
      <!-- CRYPTO SECTION -->
      <div class="adv-section">
        <h4 data-i18n="options.sec_crypto">${t('options.sec_crypto') || 'End-to-End Encryption'}</h4>
        <label class="checkbox-container">
          <input type="checkbox" id="opt-aes-enabled" ${aesEnabled ? 'checked' : ''} />
          <span class="checkmark"></span>
          <span class="label-text" data-i18n="options.aes_enable">${t('options.aes_enable') || 'Enable additional AES-256 encryption'}</span>
        </label>
        
        <div class="form-group margin-top ${aesEnabled ? '' : 'hidden'}" id="opt-passphrase-group">
          <label for="opt-aes-passphrase" data-i18n="options.aes_key">${t('options.aes_key') || 'Encryption Key (Passphrase)'}</label>
          <div class="input-password-wrapper">
            <input type="password" class="input input-sm" id="opt-aes-passphrase" 
              data-i18n-placeholder="options.aes_key_placeholder"
              placeholder="${t('options.aes_key_placeholder') || 'Enter secure passphrase'}"
              value="${aesPassphrase}" />
            <button class="btn btn-ghost btn-sm btn-pwd-toggle" type="button" id="opt-passphrase-toggle">👁️</button>
          </div>
          <span class="text-xs text-muted" data-i18n="options.aes_key_desc">${t('options.aes_key_desc') || 'If left blank, key is generated automatically via ECDH.'}</span>
        </div>
      </div>

      <div class="divider-sm"></div>

      <!-- CUSTOM STUN/TURN CONFIG -->
      <div class="adv-section">
        <h4 data-i18n="options.sec_ice">${t('options.sec_ice') || 'Custom ICE Servers (Optional)'}</h4>
        
        <div class="form-group">
          <label for="opt-stun" data-i18n="options.stun_urls">${t('options.stun_urls') || 'Custom STUN Server'}</label>
          <input type="text" class="input input-sm" id="opt-stun" 
            placeholder="stun:stun.l.google.com:19302"
            value="${stunServers.join(', ')}" />
        </div>

        <div class="form-group">
          <label for="opt-turn-urls" data-i18n="options.turn_urls">${t('options.turn_urls') || 'Custom TURN Server(s)'}</label>
          <input type="text" class="input input-sm" id="opt-turn-urls" 
            placeholder="turn:myturnserver.com:3478?transport=udp"
            value="${turnUrls}" />
        </div>

        <div class="grid grid-2 gap-2">
          <div class="form-group">
            <label for="opt-turn-user" data-i18n="options.turn_username">${t('options.turn_username') || 'TURN Username'}</label>
            <input type="text" class="input input-sm" id="opt-turn-user" 
              placeholder="username"
              value="${turnUsername}" />
          </div>
          <div class="form-group">
            <label for="opt-turn-cred" data-i18n="options.turn_credential">${t('options.turn_credential') || 'TURN Password'}</label>
            <input type="password" class="input input-sm" id="opt-turn-cred" 
              placeholder="password"
              value="${turnCredential}" />
          </div>
        </div>
      </div>

      <div class="divider-sm"></div>

      <!-- PERFORMANCE -->
      <div class="adv-section">
        <h4 data-i18n="options.sec_perf">${t('options.sec_perf') || 'Performance Tuning'}</h4>
        
        <div class="grid grid-2 gap-2 items-center" style="margin-bottom:var(--space-3);">
          <label for="opt-channels" data-i18n="options.channels_count">${t('options.channels_count') || 'Parallel DataChannels'}</label>
          <input type="number" class="input input-sm" id="opt-channels" 
            min="1" max="10" value="${parallelChannels}" />
        </div>

      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:var(--space-4);">
        <button class="btn btn-ghost btn-sm" id="opt-reset-btn" data-i18n="options.reset">${t('options.reset') || 'Reset to Default'}</button>
      </div>
    </div>
  `;

  // UI elements
  const toggleHeader = el.querySelector('#adv-toggle');
  const body = el.querySelector('#adv-body');
  const chevron = el.querySelector('#adv-chevron');

  const aesEnabledCheck = el.querySelector('#opt-aes-enabled');
  const passphraseGroup = el.querySelector('#opt-passphrase-group');
  const passphraseInput = el.querySelector('#opt-aes-passphrase');
  const passphraseToggle = el.querySelector('#opt-passphrase-toggle');
  
  const stunInput = el.querySelector('#opt-stun');
  const turnUrlsInput = el.querySelector('#opt-turn-urls');
  const turnUserInput = el.querySelector('#opt-turn-user');
  const turnCredInput = el.querySelector('#opt-turn-cred');
  
  const channelsInput = el.querySelector('#opt-channels');
  
  const resetBtn = el.querySelector('#opt-reset-btn');

  // Toggle options visibility
  toggleHeader.addEventListener('click', () => {
    body.classList.toggle('collapsed');
    chevron.textContent = body.classList.contains('collapsed') ? '▼' : '▲';
  });

  // Toggle passphrase input visibility based on checkbox
  aesEnabledCheck.addEventListener('change', () => {
    const enabled = aesEnabledCheck.checked;
    settings.set('aesEnabled', enabled);
    if (enabled) {
      passphraseGroup.classList.remove('hidden');
    } else {
      passphraseGroup.classList.add('hidden');
      settings.set('aesPassphrase', '');
      passphraseInput.value = '';
    }
  });

  // Save passphrase changes
  passphraseInput.addEventListener('input', () => {
    settings.set('aesPassphrase', passphraseInput.value);
  });

  // Show/Hide passphrase toggle
  passphraseToggle.addEventListener('click', (e) => {
    addRipple(passphraseToggle, e);
    const isPassword = passphraseInput.type === 'password';
    passphraseInput.type = isPassword ? 'text' : 'password';
    passphraseToggle.textContent = isPassword ? '🙈' : '👁️';
  });

  // ICE Server Inputs
  stunInput.addEventListener('input', () => {
    const val = stunInput.value.split(',').map(s => s.trim()).filter(Boolean);
    settings.set('stunServers', val);
  });

  const saveTurn = () => {
    settings.set('turnUrls', turnUrlsInput.value.trim());
    settings.set('turnUsername', turnUserInput.value.trim());
    settings.set('turnCredential', turnCredInput.value.trim());
  };
  turnUrlsInput.addEventListener('input', saveTurn);
  turnUserInput.addEventListener('input', saveTurn);
  turnCredInput.addEventListener('input', saveTurn);

  // Performance settings
  channelsInput.addEventListener('change', () => {
    let val = parseInt(channelsInput.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 10) val = 10;
    channelsInput.value = val;
    if (val) settings.set('parallelChannels', val);
  });

  // Reset button
  resetBtn.addEventListener('click', (e) => {
    addRipple(resetBtn, e);
    settings.reset();
    
    // Update inputs to new defaults
    aesEnabledCheck.checked = settings.get('aesEnabled');
    passphraseInput.value = '';
    passphraseGroup.classList.add('hidden');
    stunInput.value = '';
    turnUrlsInput.value = '';
    turnUserInput.value = '';
    turnCredInput.value = '';
    channelsInput.value = settings.get('parallelChannels');
  });

  // Ripple effect is handled in click listeners if needed

  return el;
}
