import { t } from '../i18n/i18n.js';

/**
 * Generate a QR code as an <img> element using Google Charts API (reliable fallback).
 * @param {string} data  URL or text to encode
 * @param {number} size  pixel size of QR code
 * @returns {HTMLImageElement}
 */
export function generateQRImage(data, size = 200) {
  const img = document.createElement('img');
  const encoded = encodeURIComponent(data);
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&bgcolor=ffffff&color=021526&margin=10`;
  img.width = size;
  img.height = size;
  img.alt = 'QR Code';
  img.style.borderRadius = '8px';
  img.style.display = 'block';
  return img;
}

/**
 * Render a QR code into a container element.
 * @param {HTMLElement} container
 * @param {string} url
 */
export function renderQR(container, url) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'qr-canvas-wrapper';
  const img = generateQRImage(url, 180);
  wrapper.appendChild(img);
  container.appendChild(wrapper);
}

/**
 * Create the full QR container section with title and download button.
 * @param {string} url
 * @param {string} labelText
 * @returns {HTMLElement}
 */
export function createQRSection(url, labelText) {
  const section = document.createElement('div');
  section.className = 'qr-container';

  const title = document.createElement('p');
  title.className = 'text-sm text-muted';
  title.setAttribute('data-i18n', 'room.share_qr');
  title.textContent = labelText;

  const qrWrapper = document.createElement('div');
  qrWrapper.id = 'qr-wrapper';
  renderQR(qrWrapper, url);

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'btn btn-ghost btn-sm';
  downloadBtn.innerHTML = `⬇ <span data-i18n="btn.download_qr">${t('btn.download_qr')}</span>`;
  downloadBtn.addEventListener('click', () => downloadQR(url));

  section.appendChild(title);
  section.appendChild(qrWrapper);
  section.appendChild(downloadBtn);
  return section;
}

/**
 * Trigger download of the QR code image.
 */
function downloadQR(url) {
  const size = 400;
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&bgcolor=ffffff&color=021526&margin=20`;
  const a = document.createElement('a');
  a.href = src;
  a.download = 'fastwayshare-qr.png';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
