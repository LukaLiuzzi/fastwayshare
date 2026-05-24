/**
 * FastWayShare — i18n.js
 * Lightweight internationalization engine.
 * Supports EN / ES with system detection and manual toggle.
 */

import { detectLanguage } from '../utils/helpers.js';
import en from './en.json';
import es from './es.json';

const translations = { en, es };
let currentLang = null;

/** Supported languages */
export const SUPPORTED_LANGS = ['en', 'es'];

/**
 * Initialize i18n — detects browser language, respects localStorage override.
 */
export function initI18n() {
  const stored = localStorage.getItem('fws-lang');
  currentLang = SUPPORTED_LANGS.includes(stored) ? stored : detectLanguage();
  applyTranslations();
  return currentLang;
}

/**
 * Get current language code.
 * @returns {'en'|'es'}
 */
export function getLang() {
  return currentLang;
}

/**
 * Set language and re-render all translated elements.
 * @param {'en'|'es'} lang
 */
export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  currentLang = lang;
  localStorage.setItem('fws-lang', lang);
  applyTranslations();
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

/**
 * Translate a key, with optional interpolation.
 * @param {string} key  dot-notated key e.g. 'room.create'
 * @param {Record<string,string>} [vars]  {name: 'Alice'}
 * @returns {string}
 */
export function t(key, vars = {}) {
  const dict = translations[currentLang] || translations.en;
  let str = dict[key] ?? translations.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

/**
 * Apply translations to all DOM elements with data-i18n attribute.
 * <span data-i18n="room.create"></span>
 * <input data-i18n-placeholder="room.code_placeholder" />
 */
export function applyTranslations() {
  if (!currentLang) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  document.documentElement.lang = currentLang;
}
