/**
 * FastWayShare — app.js
 * Main application controller.
 * Handles: navbar, hero landing page, routing to send/receive views,
 * theme toggle, language toggle, scroll reveal, particles, history section.
 */

import {
	t,
	initI18n,
	setLang,
	getLang,
	applyTranslations,
} from '../i18n/i18n.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';
import { createHowItWorksSection } from './howItWorks.js';
import { RoomView } from './room.js';
import { addRipple } from '../utils/helpers.js';

export class App {
	#currentView = null; // RoomView instance

	async init() {
		initTheme();
		initI18n();

		this.#render();
		this.#setupScrollReveal();
		this.#handleHashRouting();

		// Listen for hash changes (back button / link navigation)
		window.addEventListener('hashchange', () => this.#handleHashRouting());
		// Re-apply translations on language change
		window.addEventListener('langchange', (e) => {
			applyTranslations();
			// Update active class on language toggle buttons
			const lang = e.detail?.lang || getLang();
			document.querySelectorAll('#lang-toggle .toggle-btn').forEach((btn) => {
				if (btn.dataset.lang === lang) {
					btn.classList.add('active');
				} else {
					btn.classList.remove('active');
				}
			});
		});
	}

	#render() {
		const app = document.getElementById('app');
		app.innerHTML = '';
		app.appendChild(this.#createNavbar());
		app.appendChild(this.#createMain());
		app.appendChild(this.#createFooter());
	}

	// ─── NAVBAR ────────────────────────────────────────────────────────────────

	#createNavbar() {
		const nav = document.createElement('nav');
		nav.className = 'navbar';
		nav.innerHTML = `
      <div class="container">
        <div class="navbar-inner">
          <a href="#/" class="navbar-logo" id="home-link">
            <span class="logo-icon">⚡</span>
            <span>Fast<em>Way</em>Share</span>
          </a>

          <div class="navbar-actions">
            <a href="#how-it-works" class="btn btn-ghost btn-sm">
              <span data-i18n="nav.how_it_works">${t('nav.how_it_works')}</span>
            </a>
            <a href="https://github.com/LukaLiuzzi/fastwayshare" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">
              <span data-i18n="nav.github">${t('nav.github')} ↗</span>
            </a>

            <!-- Language toggle -->
            <div class="control-group" id="lang-toggle">
              <button class="toggle-btn ${getLang() === 'en' ? 'active' : ''}" data-lang="en" id="btn-lang-en">EN</button>
              <button class="toggle-btn ${getLang() === 'es' ? 'active' : ''}" data-lang="es" id="btn-lang-es">ES</button>
            </div>

            <!-- Theme toggle -->
            <button class="btn-icon btn" id="theme-toggle-btn" aria-label="Toggle theme"
              data-i18n-title="${getTheme() === 'dark' ? 'theme.light' : 'theme.dark'}"
              title="${getTheme() === 'dark' ? t('theme.light') : t('theme.dark')}">
              ${getTheme() === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </div>
    `;

		// Theme toggle
		nav.querySelector('#theme-toggle-btn').addEventListener('click', (e) => {
			toggleTheme();
			const btn = e.currentTarget;
			btn.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
			const titleKey = getTheme() === 'dark' ? 'theme.light' : 'theme.dark';
			btn.setAttribute('data-i18n-title', titleKey);
			btn.title = t(titleKey);
		});

		// Language toggle
		nav.querySelectorAll('[data-lang]').forEach((btn) => {
			btn.addEventListener('click', () => {
				setLang(btn.dataset.lang);
			});
		});

		return nav;
	}

	// ─── MAIN ──────────────────────────────────────────────────────────────────

	#createMain() {
		const main = document.createElement('main');
		main.id = 'main-content';

		// Hero section (contains the workspace card)
		main.appendChild(this.#createHero());

		// How it works section
		main.appendChild(createHowItWorksSection());

		return main;
	}

	#createHero() {
		const hero = document.createElement('section');
		hero.className = 'hero bg-mesh';
		hero.id = 'hero';

		// Aurora Glow Blobs Background
		const aurora = document.createElement('div');
		aurora.className = 'hero-glow-blobs';
		aurora.innerHTML = `
			<div class="glow-blob glow-blob-1"></div>
			<div class="glow-blob glow-blob-2"></div>
			<div class="glow-blob glow-blob-3"></div>
		`;
		hero.appendChild(aurora);

		// Grid Overlay
		const grid = document.createElement('div');
		grid.className = 'hero-grid-overlay';
		hero.appendChild(grid);

		const content = document.createElement('div');
		content.className = 'hero-content';
		content.innerHTML = `
      <div class="hero-eyebrow anim-fade-in-down" data-i18n="hero.eyebrow">${t('hero.eyebrow')}</div>
      <h1 class="hero-title anim-fade-in-up anim-delay-100">
        <span data-i18n="hero.title_1">${t('hero.title_1')}</span><br/>
        <span class="text-gradient" data-i18n="hero.title_2">${t('hero.title_2')}</span>
      </h1>
      <p class="hero-subtitle anim-fade-in-up anim-delay-200" data-i18n="hero.subtitle">
        ${t('hero.subtitle')}
      </p>

      <!-- Unified Workspace Card -->
      <div class="workspace-wrapper anim-fade-in-up anim-delay-300">
        <div id="main-workspace" class="workspace-card"></div>
      </div>
    `;

		hero.appendChild(content);

		return hero;
	}

	// ─── ROUTING ───────────────────────────────────────────────────────────────

	#handleHashRouting() {
		const hash = location.hash;
		const mode =
			hash.startsWith('#/receive') || hash.startsWith('#/room/')
				? 'receive'
				: 'send';
		this.#showTransferView(mode);
	}

	#navigateTo(mode) {
		location.hash = `/${mode}`;
	}
	#showTransferView(mode) {
		const container = document.getElementById('main-workspace');
		if (!container) return;

		const hash = location.hash;
		const match = hash.match(/\/room\/([A-Z]{3}-\d{4})/);
		const targetRoomCode = match ? match[1] : null;

		let shouldRecreate = !this.#currentView || !container.children.length;

		if (this.#currentView) {
			const currentRoomCode = this.#currentView.getRoomCode();
			if (currentRoomCode !== targetRoomCode) {
				shouldRecreate = true;
			}
		}

		if (shouldRecreate) {
			if (this.#currentView) {
				this.#currentView.destroy();
			}
			this.#currentView = new RoomView(container);
			this.#currentView.init();
		}

		this.#currentView.setMode(mode);
	}
	// ─── FOOTER ────────────────────────────────────────────────────────────────

	#createFooter() {
		const footer = document.createElement('footer');
		footer.style.cssText = `
      padding: var(--space-8) 0;
      border-top: 1px solid var(--border-color);
      margin-top: var(--space-12);
    `;
		footer.innerHTML = `
      <div class="container text-center">
        <p class="text-muted text-sm">
          ⚡ <strong>FastWayShare</strong> —
          <a href="https://github.com/LukaLiuzzi/fastwayshare" target="_blank" rel="noopener" data-i18n="footer.open_source">${t('footer.open_source')}</a> •
          MIT License •
          <span data-i18n="privacy.e2e">${t('privacy.e2e')}</span>
        </p>
        <p class="text-muted" style="font-size:0.7rem;margin-top:var(--space-2);" data-i18n="footer.never_touch">
          ${t('footer.never_touch')}
        </p>
      </div>
    `;
		return footer;
	}

	// ─── SCROLL REVEAL ─────────────────────────────────────────────────────────

	#setupScrollReveal() {
		// Global intersection observer for .reveal elements added after render
		const observer = new IntersectionObserver(
			(entries) =>
				entries.forEach((e) => {
					if (e.isIntersecting) {
						e.target.classList.add('is-visible');
						observer.unobserve(e.target);
					}
				}),
			{ threshold: 0.1 }
		);

		// Observe existing and future elements
		const observe = () =>
			document
				.querySelectorAll('.reveal:not(.is-visible)')
				.forEach((el) => observer.observe(el));
		observe();
		setTimeout(observe, 500);
		setTimeout(observe, 1500);
	}
}
