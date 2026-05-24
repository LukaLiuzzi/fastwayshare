/**
 * FastWayShare — dropzone.js
 * Drag & drop file selection with previews, folder support, and file list management.
 */

import { formatBytes } from '../utils/helpers.js';
import { t } from '../i18n/i18n.js';
import { createFilePreview } from './preview.js';
import { compressToZip } from '../core/chunker.js';

export class Dropzone {
  #el;
  #files = [];
  #onChangeCallback = null;

  /**
   * @param {HTMLElement} container  Where to mount the dropzone
   */
  constructor(container) {
    this.#el = this.#render();
    container.appendChild(this.#el);
    this.#setupEvents();
  }

  #render() {
    const el = document.createElement('div');
    el.className = 'dropzone';
    el.id = 'dropzone';
    el.innerHTML = `
      <input type="file" id="file-input" multiple aria-label="Select files" />
      <div class="dropzone-icon anim-float">📂</div>
      <div>
        <div class="dropzone-title" data-i18n="drop.title">${t('drop.title')}</div>
        <p class="dropzone-subtitle" data-i18n="drop.subtitle">${t('drop.subtitle')}</p>
      </div>
      <label for="file-input" class="btn btn-secondary btn-sm" style="cursor:pointer;" id="browse-btn">
        📄 <span data-i18n="drop.browse">${t('drop.browse')}</span>
      </label>
    `;
    return el;
  }

  async #traverseDirectory(entry, path = '') {
    const files = [];
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      Object.defineProperty(file, 'webkitRelativePath', {
        value: path ? `${path}/${file.name}` : file.name,
        writable: true
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const entries = await new Promise((resolve, reject) => {
        const allEntries = [];
        function read() {
          dirReader.readEntries((results) => {
            if (results.length === 0) {
              resolve(allEntries);
            } else {
              allEntries.push(...results);
              read();
            }
          }, reject);
        }
        read();
      });
      for (const childEntry of entries) {
        const childFiles = await this.#traverseDirectory(childEntry, path ? `${path}/${entry.name}` : entry.name);
        files.push(...childFiles);
      }
    }
    return files;
  }

  #setupEvents() {
    const fileInput = this.#el.querySelector('#file-input');

    // File input
    fileInput.addEventListener('change', (e) => this.#addFiles(Array.from(e.target.files)));

    // Drag events
    this.#el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.#el.classList.add('drag-over');
    });
    this.#el.addEventListener('dragleave', () => this.#el.classList.remove('drag-over'));
    this.#el.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.#el.classList.remove('drag-over');

      const items = e.dataTransfer.items;
      if (!items) {
        const files = Array.from(e.dataTransfer.files);
        if (files.length) this.#addFiles(files);
        return;
      }

      const filesToProcess = [];
      const foldersToZip = new Map();
      const promises = [];

      for (const item of items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isFile) {
              promises.push(new Promise((resolve) => {
                entry.file((file) => {
                  filesToProcess.push(file);
                  resolve();
                });
              }));
            } else if (entry.isDirectory) {
              promises.push(
                this.#traverseDirectory(entry).then((dirFiles) => {
                  foldersToZip.set(entry.name, dirFiles);
                })
              );
            }
          }
        }
      }

      await Promise.all(promises);

      const finalFiles = [...filesToProcess];

      for (const [folderName, dirFiles] of foldersToZip.entries()) {
        if (dirFiles.length > 0) {
          try {
            const zipResult = await compressToZip(dirFiles, folderName);
            const zipFile = new File([zipResult.data], `${folderName}.zip`, { type: 'application/zip' });
            finalFiles.push(zipFile);
          } catch (err) {
            console.error('Failed to compress folder:', err);
          }
        }
      }

      if (finalFiles.length) {
        this.#addFiles(finalFiles);
      }
    });
  }

  #addFiles(newFiles) {
    this.#files.push(...newFiles);
    this.#el.classList.add('hidden');
    this.#onChangeCallback?.(this.#files);
  }

  onChange(cb) {
    this.#onChangeCallback = cb;
  }

  reset() {
    this.#files = [];
    this.#el.classList.remove('hidden');
    this.#el.querySelector('#file-input').value = '';
  }

  get files() { return this.#files; }
}

/**
 * Create a file list display below the dropzone.
 * @param {File[]} files
 * @param {Function} onRemove  callback(index)
 * @returns {HTMLElement}
 */
export function createFileList(files, onRemove) {
  const wrapper = document.createElement('div');
  wrapper.className = 'anim-fade-in';

  const summary = document.createElement('p');
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  summary.className = 'text-sm text-muted text-center';
  summary.style.marginBottom = 'var(--space-3)';
  summary.textContent = t('drop.selected', { count: files.length, size: formatBytes(totalSize) });

  const list = document.createElement('div');
  list.className = 'file-list';

  files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const preview = createFilePreview(file);

    const info = document.createElement('div');
    info.className = 'file-info';
    info.innerHTML = `
      <div class="file-name" title="${file.name}">${file.name}</div>
      <div class="file-size">${formatBytes(file.size)}</div>
    `;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-remove';
    removeBtn.setAttribute('aria-label', 'Remove file');
    removeBtn.dataset.index = i;
    removeBtn.innerHTML = '✕';

    item.appendChild(preview);
    item.appendChild(info);
    item.appendChild(removeBtn);
    list.appendChild(item);
  });

  list.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      onRemove(index);
    });
  });

  wrapper.appendChild(summary);
  wrapper.appendChild(list);
  return wrapper;
}
