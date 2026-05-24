/**
 * FastWayShare — theme.js
 * Dark/light theme toggle with system detection and persistence.
 */

import { detectTheme } from '../utils/helpers.js';

const STORAGE_KEY = 'fws-theme';

export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme = stored || detectTheme();
  applyTheme(theme);
  return theme;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Listen for system preference changes */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  // Only auto-switch if user hasn't manually set a preference
  if (!localStorage.getItem(STORAGE_KEY)) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});
