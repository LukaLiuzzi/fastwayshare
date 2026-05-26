/**
 * FastWayShare — howItWorks.js
 * Renders the "How it Works" section with animated steps,
 * P2P flow diagram, and privacy bullets.
 */

import { t } from '../i18n/i18n.js';

const STEPS = [
  {
    icon: '🔗',
    titleKey: 'how.step1_title',
    descKey: 'how.step1_desc',
  },
  {
    icon: '🔑',
    titleKey: 'how.step2_title',
    descKey: 'how.step2_desc',
  },
  {
    icon: '⚡',
    titleKey: 'how.step3_title',
    descKey: 'how.step3_desc',
  },
  {
    icon: '✅',
    titleKey: 'how.step4_title',
    descKey: 'how.step4_desc',
  },
];

const PRIVACY_BULLETS = [
  { icon: '🚫', key: 'privacy.zero_storage' },
  { icon: '🔒', key: 'privacy.e2e' },
  { icon: '⭐', key: 'privacy.open_source' },
  { icon: '👤', key: 'privacy.no_account' },
  { icon: '📡', key: 'privacy.p2p' },
];

/**
 * Renders the complete "How it Works" section.
 * @returns {HTMLElement}
 */
export function createHowItWorksSection() {
  const section = document.createElement('section');
  section.className = 'how-it-works';
  section.id = 'how-it-works';

  section.innerHTML = `
    <div class="container">
      <div class="text-center reveal">
        <h2 data-i18n="how.title">${t('how.title')}</h2>
        <p style="margin-top:1rem;max-width:560px;margin-left:auto;margin-right:auto;" data-i18n="how.subtitle">${t('how.subtitle')}</p>
      </div>

      <!-- P2P Flow Diagram -->
      <div class="flow-diagram reveal delay-1">
        <div style="width: 100%; max-width: 700px; margin: 0 auto; display: block;">
          ${createFlowDiagramSVG()}
        </div>
      </div>

      <!-- Steps -->
      <div class="how-step-grid">
        ${STEPS.map((step, i) => `
          <div class="how-step reveal delay-${i + 1}">
            <div class="how-step-icon">
              ${step.icon}
              <span class="how-step-number">${i + 1}</span>
            </div>
            <div class="how-step-title" data-i18n="${step.titleKey}">${t(step.titleKey)}</div>
            <p class="how-step-desc" data-i18n="${step.descKey}">${t(step.descKey)}</p>
          </div>
        `).join('')}
      </div>

      <!-- Advanced Tech Features Showcase -->
      <div class="text-center reveal" style="margin-top: var(--space-12); margin-bottom: var(--space-6);">
        <h3 data-i18n="how.tech_title" style="font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 700; color: var(--text-primary);">${t('how.tech_title') || 'Next-Gen Transfer Protocol'}</h3>
        <p style="max-width:560px; margin: var(--space-2) auto 0; font-size: var(--text-sm); color: var(--text-secondary);" data-i18n="how.tech_subtitle">${t('how.tech_subtitle') || 'High-performance engine designed for speed, resilience, and maximum security.'}</p>
      </div>

      <div class="tech-features-grid reveal delay-2">
        <div class="tech-feature-card">
          <div class="tech-icon">🌐</div>
          <h4 data-i18n="how.tech1_title">${t('how.tech1_title') || 'Ultra Local Mode'}</h4>
          <p class="tech-desc" data-i18n="how.tech1_desc">${t('how.tech1_desc') || 'Bypasses TURN relays when devices share the same Wi-Fi network, ensuring maximum LAN speeds.'}</p>
        </div>
        <div class="tech-feature-card">
          <div class="tech-icon">⚡</div>
          <h4 data-i18n="how.tech2_title">${t('how.tech2_title') || 'Parallel DataChannels'}</h4>
          <p class="tech-desc" data-i18n="how.tech2_desc">${t('how.tech2_desc') || 'Multiplexes files across multiple WebRTC DataChannels in parallel to overcome packet losses and boost throughput.'}</p>
        </div>
        <div class="tech-feature-card">
          <div class="tech-icon">📈</div>
          <h4 data-i18n="how.tech3_title">${t('how.tech3_title') || 'Adaptive Chunk Sizing'}</h4>
          <p class="tech-desc" data-i18n="how.tech3_desc">${t('how.tech3_desc') || 'Dynamically scales chunk size based on real-time RTT and jitter tracking to optimize pipeline efficiency.'}</p>
        </div>
        <div class="tech-feature-card">
          <div class="tech-icon">🛡️</div>
          <h4 data-i18n="how.tech4_title">${t('how.tech4_title') || 'Passphrase-based AES-256'}</h4>
          <p class="tech-desc" data-i18n="how.tech4_desc">${t('how.tech4_desc') || 'Optionally secure transfers with user passphrase key derivation using PBKDF2 on top of standard WebRTC encryption.'}</p>
        </div>
        <div class="tech-feature-card">
          <div class="tech-icon">🔄</div>
          <h4 data-i18n="how.tech5_title">${t('how.tech5_title') || 'Smart Deduplication'}</h4>
          <p class="tech-desc" data-i18n="how.tech5_desc">${t('how.tech5_desc') || 'Skips transmission of already received file chunks during resume attempts, saving valuable bandwidth.'}</p>
        </div>
        <div class="tech-feature-card">
          <div class="tech-icon">📱</div>
          <h4 data-i18n="how.tech6_title">${t('how.tech6_title') || 'Mobile Optimization'}</h4>
          <p class="tech-desc" data-i18n="how.tech6_desc">${t('how.tech6_desc') || 'Implements Screen Wake Lock, background transfer awareness, and automatic reconnection triggers.'}</p>
        </div>
      </div>

      <!-- Privacy bullets -->
      <div class="privacy-bullets reveal" style="margin-top: var(--space-12);">
        ${PRIVACY_BULLETS.map(b => `
          <div class="privacy-bullet">
            <span class="bullet-icon">${b.icon}</span>
            <span data-i18n="${b.key}">${t(b.key)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Scroll reveal observer
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }
  );

  // Observe reveal elements after DOM is in document
  requestAnimationFrame(() => {
    section.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  });

  return section;
}

function createFlowDiagramSVG() {
  return `
    <svg viewBox="0 0 700 120" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;height:auto;display:block;">
      <!-- Peer A node -->
      <g>
        <circle cx="148" cy="60" r="32" class="flow-peer-a-circle" fill="rgba(255,143,21,0.15)" stroke="#FF8F15" stroke-width="2"/>
        <text x="148" y="56" text-anchor="middle" font-size="18">💻</text>
        <text x="148" y="75" text-anchor="middle" font-size="11" class="flow-peer-a-text" fill="#FF8F15" font-weight="bold">Peer A</text>
      </g>

      <!-- Arrow A → Signal -->
      <path d="M183 60 Q243 30 303 60" class="flow-arrow-path" stroke="#5A7C9E" stroke-width="1.5" fill="none" stroke-dasharray="4 3" opacity="0.6"/>
      <polygon points="301,54 309,60 301,66" class="flow-arrow-head" fill="#5A7C9E" opacity="0.6"/>

      <!-- Signaling server -->
      <g>
        <rect x="308" y="28" width="80" height="64" rx="12" class="flow-server-rect"
              fill="rgba(66,71,105,0.3)" stroke="#424769" stroke-width="2"/>
        <text x="348" y="55" text-anchor="middle" font-size="16">☁️</text>
        <text x="348" y="70" text-anchor="middle" font-size="9.5" class="flow-server-text" fill="#a8bfce">Signaling</text>
        <text x="348" y="82" text-anchor="middle" font-size="9.5" class="flow-server-text" fill="#a8bfce">Server</text>
      </g>

      <!-- Arrow Signal → B -->
      <path d="M393 60 Q453 30 513 60" class="flow-arrow-path" stroke="#5A7C9E" stroke-width="1.5" fill="none" stroke-dasharray="4 3" opacity="0.6"/>
      <polygon points="511,54 519,60 511,66" class="flow-arrow-head" fill="#5A7C9E" opacity="0.6"/>

      <!-- Peer B node -->
      <g>
        <circle cx="553" cy="60" r="32" class="flow-peer-b-circle" fill="rgba(252,185,66,0.15)" stroke="#FCB942" stroke-width="2"/>
        <text x="553" y="56" text-anchor="middle" font-size="18">📱</text>
        <text x="553" y="75" text-anchor="middle" font-size="11" class="flow-peer-b-text" fill="#FCB942" font-weight="bold">Peer B</text>
      </g>

      <!-- Direct P2P arrow (bold, orange) -->
      <path d="M183 75 Q348 110 513 75" class="flow-p2p-path" stroke="#FF8F15" stroke-width="2.5" fill="none"/>
      <polygon points="511,69 520,75 511,81" class="flow-p2p-head" fill="#FF8F15"/>
      <text x="348" y="108" text-anchor="middle" font-size="10" class="flow-p2p-text" fill="#FF8F15" font-weight="600">
        🔒 AES-256-GCM encrypted • Direct P2P
      </text>

      <!-- Labels -->
      <text x="248" y="30" text-anchor="middle" font-size="9" class="flow-label" fill="#5A7C9E">Handshake</text>
      <text x="450" y="30" text-anchor="middle" font-size="9" class="flow-label" fill="#5A7C9E">Handshake</text>
    </svg>
  `;
}
