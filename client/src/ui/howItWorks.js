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

      <!-- Privacy bullets -->
      <div class="privacy-bullets reveal">
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
