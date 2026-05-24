/**
 * FastWayShare — preview.js
 * File preview component: images, video, and generic file icons.
 */

import { getFileIcon } from '../utils/helpers.js';
import { IMAGE_TYPES, VIDEO_TYPES } from '../utils/constants.js';

/**
 * Create a preview thumbnail for a file.
 * @param {File} file
 * @returns {HTMLElement}
 */
export function createFilePreview(file) {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-icon';

  if (IMAGE_TYPES.includes(file.type)) {
    const img = document.createElement('img');
    img.alt = file.name;
    img.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:6px;';
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => {}; // keep blob alive
    // Revoke after display
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    wrapper.appendChild(img);
  } else {
    wrapper.textContent = getFileIcon(file.type, file.name);
  }

  return wrapper;
}

/**
 * Render a preview grid for multiple files.
 * @param {File[]} files
 * @param {HTMLElement} container
 */
export function renderPreviewGrid(files, container) {
  container.innerHTML = '';
  if (files.length === 0) return;

  files.slice(0, 12).forEach(file => {
    if (IMAGE_TYPES.includes(file.type)) {
      const item = document.createElement('div');
      item.style.cssText = `
        width: 72px; height: 72px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--border-color);
        flex-shrink: 0;
      `;
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.alt = file.name;
      const url = URL.createObjectURL(file);
      img.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      item.appendChild(img);
      container.appendChild(item);
    }
  });
}
