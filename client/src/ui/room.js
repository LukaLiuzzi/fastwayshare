/**
 * FastWayShare — room.js
 * Room creation / joining UI.
 * Handles the full transfer flow: room setup → signaling → WebRTC → transfer.
 */

import { t } from '../i18n/i18n.js';
import { createRoom, SignalingClient } from '../core/signaling.js';
import { WebRTCManager } from '../core/webrtc.js';
import { TransferManager } from '../core/transfer.js';
import {
	generateECDHKeyPair,
	importPeerPublicKey,
	deriveSharedKey,
} from '../core/crypto.js';
import { MSG, ROOM_CODE_REGEX } from '../utils/constants.js';
import { fetchTURNCredentials } from '../utils/constants.js';
import { copyToClipboard, addRipple } from '../utils/helpers.js';
import { createQRSection } from './qrcode.js';
import { Dropzone, createFileList } from './dropzone.js';
import { createProgressBar } from './progress.js';
import { addHistoryEntry } from './history.js';
import { notifyTransferComplete, showToast } from './notification.js';
import { requestNotificationPermission } from './notification.js';
import { createAdvancedOptions } from './advancedOptions.js';
import { settings } from '../core/settings.js';

export class RoomView {
	#container;
	#signaling = null;
	#rtc = null;
	#transfer = null;
	#keyPair = null;
	#roomCode = null;
	#roomUrl = null;
	#progressBar = null;
	#dropzone = null;
	#files = [];
	#sendBtn = null;
	#mode = 'send'; // 'send' | 'receive'
	#statusState = null;
	#connectionType = null;
	#onLangChange = null;

	/**
	 * @param {HTMLElement} container
	 */
	constructor(container) {
		this.#container = container;
	}

	async init() {
		this.#container.innerHTML = '';
		this.#container.classList.remove('single-panel');
		requestNotificationPermission();

		this.#renderLayout();
		this.#setupEvents();

		// Add Advanced Options
		const advSend = createAdvancedOptions();
		const sendOpts = this.#container.querySelector('#advanced-options-send');
		if (sendOpts) {
			sendOpts.appendChild(advSend);
			sendOpts.classList.remove('hidden');
		}

		this.#onLangChange = () => {
			this.#updateDynamicTranslations();
			const sendPanel = this.#container.querySelector('#send-panel');
			if (sendPanel && this.#files.length > 0) {
				this.#renderFileList(sendPanel, this.#files);
			}
		};
		window.addEventListener('langchange', this.#onLangChange);
	}

	#renderLayout() {
		this.#container.innerHTML = `
      <div class="workspace-grid show-send" id="workspace-grid">
        <!-- SEND PANEL -->
        <div class="workspace-panel" id="send-panel">
          <div class="flex items-center gap-3" style="margin-bottom: var(--space-4);">
            <div class="how-step-icon" style="width:40px;height:40px;font-size:20px;">📤</div>
            <h3 data-i18n="room.send_title">${t('room.send_title')}</h3>
          </div>
          <div id="dropzone-container"></div>
          <div id="file-list-container" style="margin-top:var(--space-4);"></div>

          <!-- Room creation loading -->
          <div class="card-flat hidden" id="room-creating-card" style="text-align: center; padding: var(--space-8) var(--space-6); background: rgba(10, 15, 26, 0.4); border-color: rgba(255, 255, 255, 0.05);">
            <span class="anim-spin" style="font-size:2.5rem; display:block; margin-bottom:var(--space-4);">⏳</span>
            <p class="text-secondary" data-i18n="room.creating">${t('room.creating')}</p>
          </div>

          <!-- Room setup info -->
          <div class="card-flat hidden" id="room-setup-card" style="background: rgba(10, 15, 26, 0.4); border-color: rgba(255, 255, 255, 0.05);"></div>

          <!-- Advanced Options Send -->
          <div id="advanced-options-send"></div>

          <div class="workspace-footer" id="send-footer-area">
            <a href="#/receive" class="btn btn-ghost btn-sm">
              📥 <span data-i18n="room.receive_label">${t('room.receive_label')}</span>
            </a>
          </div>
        </div>

        <!-- RECEIVE PANEL -->
        <div class="workspace-panel" id="receive-panel">
          <div class="flex items-center gap-3" style="margin-bottom:var(--space-4);">
            <div class="how-step-icon" style="width:40px;height:40px;font-size:20px;">📥</div>
            <h3 data-i18n="room.receive_title">${t('room.receive_title')}</h3>
          </div>
          
          <div class="receive-form">
            <p class="text-sm text-secondary" style="margin-bottom:var(--space-4);" data-i18n="room.enter_code_desc">${t('room.enter_code_desc')}</p>
            <div class="input-group" style="margin-bottom:var(--space-6);">
              <input class="input input-code" id="code-input"
                data-i18n-placeholder="room.code_placeholder"
                placeholder="${t('room.code_placeholder')}"
                maxlength="8" autocomplete="off" spellcheck="false" />
            </div>
            <button class="btn btn-primary" id="join-btn" disabled style="width:100%;">
              🔗 <span data-i18n="room.receive_btn_join">${t('room.receive_btn_join')}</span>
            </button>
          </div>

          <div class="card-flat hidden" id="connection-card" style="background: rgba(10, 15, 26, 0.4); border-color: rgba(255, 255, 255, 0.05);"></div>



          <div class="workspace-footer" id="receive-footer-area">
            <a href="#/" class="btn btn-ghost btn-sm">
              📤 <span data-i18n="room.send_label">${t('room.send_label')}</span>
            </a>
          </div>
        </div>
      </div>
    `;
	}

	#setupEvents() {
		const grid = this.#container.querySelector('#workspace-grid');
		const sendPanel = grid.querySelector('#send-panel');
		const recvPanel = grid.querySelector('#receive-panel');
		const codeInput = recvPanel.querySelector('#code-input');
		const joinBtn = recvPanel.querySelector('#join-btn');

		// Initialize dropzone
		this.#dropzone = new Dropzone(
			sendPanel.querySelector('#dropzone-container')
		);
		this.#dropzone.onChange(async (files) => {
			this.#files = files;
			this.#renderFileList(sendPanel, files);

			if (files.length > 0 && !this.#roomCode) {
				// Transition layout to single panel focus
				grid.classList.add('single-panel');
				this.#container.classList.add('single-panel');
				recvPanel.classList.add('hidden');
				sendPanel.querySelector('#send-footer-area')?.classList.add('hidden');

				// Show creating loader
				const creatingCard = sendPanel.querySelector('#room-creating-card');
				creatingCard.classList.remove('hidden');

				// Auto-create room
				await this.#createAndConnect(sendPanel);
			}

			if (this.#sendBtn) {
				this.#sendBtn.disabled = files.length === 0;
				this.#sendBtn.textContent = t('transfer.send', { count: files.length });
			}
		});

		// Auto-format code input: uppercase + hyphen
		codeInput.addEventListener('input', (e) => {
			let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
			if (val.length > 3) val = val.slice(0, 3) + '-' + val.slice(3, 7);
			codeInput.value = val;
			joinBtn.disabled = !ROOM_CODE_REGEX.test(val);
		});

		joinBtn.addEventListener('click', async (e) => {
			addRipple(joinBtn, e);
			const code = codeInput.value.trim();
			if (!ROOM_CODE_REGEX.test(code)) {
				showToast(t('error.room_join'), 'error');
				return;
			}
			this.#roomCode = code;
			joinBtn.disabled = true;
			codeInput.disabled = true;
			joinBtn.innerHTML = `<span class="anim-spin">⏳</span> ${t('connection.connecting')}`;

			// Hide other views/panels for receiver focus
			grid.classList.add('single-panel');
			this.#container.classList.add('single-panel');
			sendPanel.classList.add('hidden');
			recvPanel.querySelector('.receive-form').classList.add('hidden');
			recvPanel.querySelector('#receive-footer-area')?.classList.add('hidden');

			const connCard = recvPanel.querySelector('#connection-card');
			connCard.classList.remove('hidden');
			connCard.innerHTML = `
        <div id="connection-status-area"></div>
        <div class="transfer-steps" style="margin-top:var(--space-4);"></div>
      `;
			const statusEl = connCard.querySelector('#connection-status-area');
			this.#renderConnectionStatus(statusEl, 'connecting');

			await this.#startSignaling(code, 'receiver');
		});
	}

	setMode(mode) {
		this.#mode = mode;
		const grid = this.#container.querySelector('#workspace-grid');
		if (!grid) return;

		if (mode === 'receive') {
			grid.classList.remove('show-send');
			grid.classList.add('show-receive');
		} else {
			grid.classList.remove('show-receive');
			grid.classList.add('show-send');
		}

		// Pre-fill and trigger autoconnect if direct room code exists in url hash
		const hash = location.hash;
		const match = hash.match(/\/room\/([A-Z]{3}-\d{4})/);
		if (match) {
			const codeInput = grid.querySelector('#code-input');
			const joinBtn = grid.querySelector('#join-btn');
			if (codeInput && joinBtn && !codeInput.disabled) {
				codeInput.value = match[1];
				joinBtn.disabled = false;
				setTimeout(() => joinBtn.click(), 100);
			}
		}
	}

	#renderFileList(panel, files) {
		const container = panel.querySelector('#file-list-container');
		container.innerHTML = '';
		if (files.length === 0) return;

		const listEl = createFileList(files, (index) => {
			this.#files.splice(index, 1);
			if (this.#files.length === 0) {
				this.#dropzone.reset();
				// If they clear all files and we hadn't connected, we can show the toggle footer again
				if (!this.#rtc?.isOpen) {
					const grid = this.#container.querySelector('#workspace-grid');
					const recvPanel = grid?.querySelector('#receive-panel');
					grid?.classList.remove('single-panel');
					this.#container.classList.remove('single-panel');
					recvPanel?.classList.remove('hidden');
					panel.querySelector('#send-footer-area')?.classList.remove('hidden');
					panel.querySelector('#room-setup-card')?.classList.add('hidden');
				}
			}
			this.#renderFileList(panel, this.#files);

			if (this.#sendBtn) {
				this.#sendBtn.disabled = this.#files.length === 0;
				this.#sendBtn.textContent = t('transfer.send', {
					count: this.#files.length,
				});
			}
		});
		container.appendChild(listEl);
	}

	async #createAndConnect(panel) {
		try {
			const { roomCode } = await createRoom();
			this.#roomCode = roomCode;
			this.#roomUrl = `${location.origin}${location.pathname}#/room/${roomCode}`;

			await this.#renderRoomInfo(panel);
			await this.#startSignaling(roomCode, 'sender');
		} catch (err) {
			showToast(t('error.room_create'), 'error');
			const grid = this.#container.querySelector('#workspace-grid');
			const recvPanel = grid?.querySelector('#receive-panel');
			grid?.classList.remove('single-panel');
			this.#container.classList.remove('single-panel');
			recvPanel?.classList.remove('hidden');
			panel.querySelector('#room-creating-card')?.classList.add('hidden');
			panel.querySelector('#send-footer-area')?.classList.remove('hidden');
			this.#dropzone.reset();
			this.#files = [];
			this.#renderFileList(panel, []);
		}
	}

	async #renderRoomInfo(panel) {
		const card = panel.querySelector('#room-setup-card');
		card.classList.remove('hidden');

		const creatingCard = panel.querySelector('#room-creating-card');
		if (creatingCard) creatingCard.classList.add('hidden');

		const shareUrl = this.#roomUrl;

		card.innerHTML = `
      <div style="margin-bottom:var(--space-4);">
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3);" data-i18n="room.share_code">${t('room.share_code')}</p>
        <div class="room-code-display">
          <span class="room-code-text" id="room-code-text">${this.#roomCode}</span>
          <button class="copy-btn" id="copy-code-btn" data-i18n-title="room.copy_code" title="${t('room.copy_code')}">📋</button>
        </div>
      </div>

      <div class="divider-text" style="margin:var(--space-4) 0;">
        <span data-i18n="room.or_divider">${t('room.or_divider')}</span>
      </div>

      <div style="margin-bottom:var(--space-4);">
        <p class="text-sm text-muted" style="margin-bottom:var(--space-2);" data-i18n="room.share_link">${t('room.share_link')}</p>
        <div class="flex gap-2">
          <input class="input" id="link-input" readonly value="${shareUrl}" style="font-size:0.8rem;" />
          <button class="copy-btn" id="copy-link-btn" data-i18n-title="room.copy_link" title="${t('room.copy_link')}">📋</button>
        </div>
      </div>

      <div id="qr-section" style="margin-bottom:var(--space-4);"></div>

      <div id="connection-status-area"></div>

      <div class="transfer-steps" style="margin-top:var(--space-4);"></div>
    `;

		// QR code
		const qrSection = card.querySelector('#qr-section');
		qrSection.appendChild(createQRSection(shareUrl, t('room.share_qr')));

		// Copy buttons
		card
			.querySelector('#copy-code-btn')
			.addEventListener('click', async (e) => {
				const success = await copyToClipboard(this.#roomCode);
				if (success) {
					const btn = e.currentTarget;
					btn.textContent = '✅';
					btn.classList.add('copied');
					setTimeout(() => {
						btn.textContent = '📋';
						btn.classList.remove('copied');
					}, 2000);
					showToast(t('btn.copied'), 'success', 2000);
				}
			});

		card
			.querySelector('#copy-link-btn')
			.addEventListener('click', async (e) => {
				const success = await copyToClipboard(shareUrl);
				if (success) {
					const btn = e.currentTarget;
					btn.textContent = '✅';
					btn.classList.add('copied');
					setTimeout(() => {
						btn.textContent = '📋';
						btn.classList.remove('copied');
					}, 2000);
					showToast(t('btn.copied'), 'success', 2000);
				}
			});

		// Status area
		this.#renderConnectionStatus(
			card.querySelector('#connection-status-area'),
			'connecting'
		);
	}

	// ─── SIGNALING + WEBRTC ────────────────────────────────────────────────────

	async #startSignaling(roomCode, role) {
		// Generate ECDH key pair
		this.#keyPair = await generateECDHKeyPair();

		this.#signaling = new SignalingClient();
		this.#rtc = new WebRTCManager();

		// Signaling events
		this.#signaling.addEventListener('JOINED', async (e) => {
			const { peerId } = e.detail;
			// Only the receiver (peerId === '1') sends its public key immediately,
			// since the sender is already in the room.
			if (peerId === '1') {
				this.#signaling.send({
					type: MSG.ECDH_KEY,
					publicKey: this.#keyPair.publicKeyB64,
				});
			}
		});

		this.#signaling.addEventListener('PEER_JOINED', async () => {
			showToast(t('room.peer_connected'), 'success');
			this.#updateStatusUI('connecting');
			// The sender sends its public key now that the receiver has joined.
			if (role === 'sender') {
				this.#signaling.send({
					type: MSG.ECDH_KEY,
					publicKey: this.#keyPair.publicKeyB64,
				});
			}
		});

		this.#signaling.addEventListener('ECDH_KEY', async (e) => {
			// Derive shared AES key from peer's public key
			const peerPublicKey = await importPeerPublicKey(e.detail.publicKey);
			const sharedKey = await deriveSharedKey(
				this.#keyPair.privateKey,
				peerPublicKey
			);

			if (!this.#transfer) {
				this.#transfer = new TransferManager(this.#rtc);
				this.#setupTransferListeners();
			}
			this.#transfer.setSharedKey(sharedKey);
			await this.#transfer.configureEncryption();
			this.#transfer.startRTTMonitor();

			// Both peers initialize WebRTC once they have the other's public key.
			// The sender acts as the initiator. Close existing connection first.
			this.#rtc.close();
			// Fetch Cloudflare TURN credentials (cached after first call).
			const iceServers = await fetchTURNCredentials();
			await this.#rtc.init(this.#signaling, role === 'sender', {
				iceServers,
				channelCount: settings.get('parallelChannels'),
			});
		});

		this.#signaling.addEventListener('OFFER', async (e) => {
			await this.#rtc.handleOffer(e.detail.sdp, this.#signaling);
		});

		// ICE restart request: receiver asks sender to restart ICE with TURN
		this.#signaling.addEventListener('ICE_RESTART_REQUEST', async () => {
			if (role === 'sender' && this.#rtc) {
				try {
					const restartOffer = await this.#rtc.pc?.createOffer({ iceRestart: true });
					if (restartOffer) {
						await this.#rtc.pc.setLocalDescription(restartOffer);
						this.#signaling.send({ type: MSG.OFFER, sdp: restartOffer });
					}
				} catch (e) {
					console.warn('[Room] ICE restart offer failed:', e);
				}
			}
		});

		this.#signaling.addEventListener('ANSWER', async (e) => {
			await this.#rtc.handleAnswer(e.detail.sdp);
		});

		this.#signaling.addEventListener('ICE', async (e) => {
			await this.#rtc.addIceCandidate(e.detail.candidate);
		});

		this.#signaling.addEventListener('PEER_DISCONNECTED', () => {
			showToast(t('room.peer_disconnected'), 'info');
			this.#updateStatusUI('error');
			this.#rtc.close();
			this.#resetReceiverUI();
		});

		this.#signaling.addEventListener('ROOM_FULL', () => {
			showToast(t('room.full'), 'error');
			this.#resetReceiverUI();
		});

		// WebRTC connection events
		this.#rtc.addEventListener('connected', () => {
			this.#updateStatusUI('connected');
			showToast(t('room.connected'), 'success');
			if (role === 'sender') {
				this.#showSendReady();
			} else {
				const joinBtn = this.#container.querySelector('#join-btn');
				if (joinBtn) {
					joinBtn.innerHTML = `✅ ${t('room.connected')}`;
					joinBtn.disabled = true;
				}
			}
		});

		this.#rtc.addEventListener('connectiontype', (e) => {
			this.#updateConnectionType(e.detail.type);
		});

		this.#rtc.addEventListener('disconnected', () => {
			this.#updateStatusUI('error');
			this.#rtc.close();
			this.#resetReceiverUI();
		});

		// WebRTC data channel: sender gets FILE_ACCEPT signal here
		this.#rtc.addEventListener('message', (e) => {
			if (e.detail?.type === MSG.FILE_ACCEPT) {
				this.#transfer?.onAccepted();
			} else if (e.detail?.type === 'RETRY_TRANSFER') {
				const sendActionCard = this.#container.querySelector('#send-action-card');
				if (sendActionCard) sendActionCard.remove();
				this.#showSendReady();
			}
		});

		// Connect to signaling
		await this.#signaling.connect(roomCode, role);
		this.#updateStatusUI('connecting');
	}

	#setupTransferListeners() {
		if (!this.#transfer) return;

		this.#transfer.addEventListener('progress', (e) => {
			this.#progressBar?.update({ ...e.detail, showControls: true });
		});

		this.#transfer.addEventListener('needs_password', (e) => {
			const isError = e.detail?.error;
			
			const overlay = document.createElement('div');
			overlay.className = 'modal-backdrop anim-fade-in';
			// Centering via flexbox is much more robust
			overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 999; backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: var(--space-4);';

			const promptCard = document.createElement('div');
			promptCard.className = 'card-flat anim-fade-in-up';
			promptCard.style.cssText = 'box-shadow: 0 10px 40px rgba(0,0,0,0.8); max-width: 400px; width: 100%; background: var(--bg-card);';
			promptCard.innerHTML = `
				<h4 style="margin-bottom: var(--space-3);">🔒 <span data-i18n="options.aes_key">${t('options.aes_key') || 'Contraseña Requerida'}</span></h4>
				<p class="text-sm text-secondary" style="margin-bottom: var(--space-4);"><span data-i18n="room.pwd_desc">${t('room.pwd_desc') || 'El emisor ha protegido esta transferencia con una contraseña. Introdúcela para descargar.'}</span></p>
				${isError ? `<p class="text-sm" style="color: #ff6b6b; margin-bottom: var(--space-3);">❌ Contraseña incorrecta. Intente de nuevo.</p>` : ''}
				<input type="password" class="input ${isError ? 'input-error' : ''}" id="pwd-input" placeholder="********" style="margin-bottom: var(--space-4);" />
				<div class="flex gap-2">
					<button class="btn btn-ghost" id="pwd-cancel" style="flex: 1;">Cancelar</button>
					<button class="btn btn-primary" id="pwd-submit" style="flex: 1;">Aceptar</button>
				</div>
			`;

			overlay.appendChild(promptCard);
			document.body.appendChild(overlay);

			const cleanup = () => {
				overlay.remove();
			};

			promptCard.querySelector('#pwd-cancel').addEventListener('click', () => {
				cleanup();
				this.#transfer.providePassword(null);
			});

			promptCard.querySelector('#pwd-submit').addEventListener('click', () => {
				const pwd = promptCard.querySelector('#pwd-input').value;
				if (!pwd) return;
				cleanup();
				this.#transfer.providePassword(pwd);
			});
			
			promptCard.querySelector('#pwd-input').addEventListener('keydown', (e) => {
			    if (e.key === 'Enter') promptCard.querySelector('#pwd-submit').click();
			});

			promptCard.querySelector('#pwd-input').focus();
		});

		this.#transfer.addEventListener('paused', (e) => {
			this.#progressBar?.setPausedState(true);
		});

		this.#transfer.addEventListener('resumed', (e) => {
			this.#progressBar?.setPausedState(false);
		});

		this.#transfer.addEventListener('cancelled', () => {
			this.#progressBar?.reset();
			
			const sendActionCard = this.#container.querySelector('#send-action-card');
			if (sendActionCard) {
				sendActionCard.innerHTML = `
					<p class="text-sm text-secondary" style="margin-bottom:var(--space-3);">
						⚠️ <span data-i18n="transfer.cancelled">${t('transfer.cancelled') || 'Transferencia cancelada'}</span>
					</p>
					<button class="btn btn-primary" id="retry-send-btn" style="width:100%;">
						🔄 <span data-i18n="btn.retry">${t('btn.retry') || 'Reintentar'}</span>
					</button>
				`;
				sendActionCard.querySelector('#retry-send-btn').addEventListener('click', () => {
					sendActionCard.remove();
					this.#showSendReady();
				});
			}

			const recvProgressCard = this.#container.querySelector('#receive-progress-card');
			if (recvProgressCard) {
				recvProgressCard.innerHTML = `
					<p class="text-sm text-secondary" style="margin-bottom:var(--space-3);">
						⚠️ <span data-i18n="transfer.cancelled">${t('transfer.cancelled') || 'Transferencia cancelada'}</span>
					</p>
					<button class="btn btn-primary" id="retry-recv-btn" style="width:100%;">
						🔄 <span data-i18n="btn.retry">${t('btn.retry') || 'Reintentar'}</span>
					</button>
				`;
				recvProgressCard.querySelector('#retry-recv-btn').addEventListener('click', () => {
					recvProgressCard.remove();
					this.#rtc.sendMessage({ type: 'RETRY_TRANSFER' });
					
					const transferCard = this.#container.querySelector('.transfer-steps') || this.#container;
					const card = document.createElement('div');
					card.className = 'card-flat anim-fade-in';
					card.id = 'receive-progress-card';
					card.innerHTML = `<span class="anim-spin">⏳</span> <span class="text-sm text-secondary" data-i18n="room.waiting">${t('room.waiting')}</span>`;
					transferCard.appendChild(card);
				});
			}

			showToast(t('transfer.cancelled') || 'Transfer cancelled.', 'info');
		});

		this.#transfer.addEventListener('receive_started', (e) => {
			this.#showReceiveProgress(e.detail.meta, e.detail.isResuming, e.detail.bytesReceived);
		});

		this.#transfer.addEventListener('receive_complete', (e) => {
			const { meta, hashMatch, receivedHash, duration, blob } = e.detail;
			this.#progressBar?.update({
				filename: meta.filename,
				progress: 1,
				speed: 0,
				eta: 0,
				bytesReceived: meta.size,
				totalSize: meta.size,
			});
			this.#progressBar?.showHash(receivedHash, hashMatch);
			notifyTransferComplete(meta.filename, 'received');
			addHistoryEntry({
				filename: meta.filename,
				size: meta.size,
				direction: 'receive',
				duration,
				hashMatch,
			});
			this.#showCompletionAnimation();

			// Add a Save File button to let the user save the received file manually if they canceled the automatic prompt or if it failed
			if (blob) {
				const progressCard = this.#container.querySelector('#receive-progress-card');
				if (progressCard) {
					// Check if save button already exists to avoid duplicates
					if (!progressCard.querySelector('#save-file-btn')) {
						const saveBtn = document.createElement('button');
						saveBtn.className = 'btn btn-primary';
						saveBtn.id = 'save-file-btn';
						saveBtn.style.width = '100%';
						saveBtn.style.marginTop = 'var(--space-4)';
						saveBtn.innerHTML = `💾 ${t('btn.download')}`;
						saveBtn.addEventListener('click', (e) => {
							addRipple(saveBtn, e);
							const url = URL.createObjectURL(blob);
							const a = document.createElement('a');
							a.href = url;
							a.download = meta.filename;
							document.body.appendChild(a);
							a.click();
							document.body.removeChild(a);
							setTimeout(() => URL.revokeObjectURL(url), 10000);
						});
						progressCard.appendChild(saveBtn);
					}
				}
			}
		});

		this.#transfer.addEventListener('send_complete', (e) => {
			const { meta, duration } = e.detail;
			this.#progressBar?.update({
				filename: meta.filename,
				progress: 1,
				speed: 0,
				eta: 0,
				bytesSent: meta.size,
				totalSize: meta.size,
			});
			notifyTransferComplete(meta.filename, 'sent');
			addHistoryEntry({
				filename: meta.filename,
				size: meta.size,
				direction: 'send',
				duration,
				hashMatch: true,
			});
			this.#showCompletionAnimation();
		});

		this.#transfer.addEventListener('queue_complete', () => {
			if (this.#sendBtn) {
				this.#sendBtn.disabled = this.#files.length === 0;
				this.#sendBtn.textContent = t('transfer.send', {
					count: this.#files.length,
				});
			}
		});

		this.#transfer.addEventListener('cancelled', () => {
			if (this.#sendBtn) {
				this.#sendBtn.disabled = this.#files.length === 0;
				this.#sendBtn.textContent = t('transfer.send', {
					count: this.#files.length,
				});
			}
		});

		this.#transfer.addEventListener('error', (e) => {
			console.error('[UI] Transfer error:', e.detail.error);
			showToast(t('error.transfer') || 'Transfer error occurred.', 'error', 5000);
			this.#updateStatusUI('error');
		});

		this.#transfer.addEventListener('decryption_error', (e) => {
			console.error('[UI] Decryption error:', e.detail.error);
			showToast(t('error.transfer') || 'Security decryption error.', 'error', 5000);
			this.#updateStatusUI('error');
		});
	}

	// ─── UI HELPERS ────────────────────────────────────────────────────────────

	#renderConnectionStatus(container, state) {
		this.#statusState = state;
		this.#connectionType = null;
		container.className = 'anim-fade-in';
		container.innerHTML = this.#getStatusHTML(state);
		this.#container._statusEl = container;
	}

	#updateStatusUI(state) {
		this.#statusState = state;
		this.#connectionType = null;
		const el = this.#container._statusEl;
		if (el) el.innerHTML = this.#getStatusHTML(state);
	}

	#updateConnectionType(type) {
		this.#statusState = 'connected';
		this.#connectionType = type;
		const el = this.#container._statusEl;
		if (el) {
			const label =
				type === 'direct' ? t('connection.direct') : t('connection.relay');
			const tooltip =
				type === 'direct'
					? t('connection.direct_tooltip')
					: t('connection.relay_tooltip');
			el.innerHTML = this.#getStatusHTML('connected', label, tooltip);
		}
	}

	#updateDynamicTranslations() {
		// 1. Re-render connection status if we have one
		if (this.#statusState) {
			if (this.#statusState === 'connected' && this.#connectionType) {
				this.#updateConnectionType(this.#connectionType);
			} else {
				this.#updateStatusUI(this.#statusState);
			}
		}

		// 2. Re-render join button text if it was modified dynamically
		const joinBtn = this.#container.querySelector('#join-btn');
		if (joinBtn) {
			if (this.#statusState === 'connecting') {
				joinBtn.innerHTML = `<span class="anim-spin">⏳</span> ${t('connection.connecting')}`;
			} else if (this.#statusState === 'connected') {
				joinBtn.innerHTML = `✅ ${t('room.connected')}`;
			} else {
				joinBtn.innerHTML = `🔗 <span data-i18n="room.receive_btn_join">${t('room.receive_btn_join')}</span>`;
			}
		}

		// 3. Re-render progress/sending card texts if active
		const sendActionCard = this.#container.querySelector('#send-action-card');
		if (sendActionCard) {
			const statusLabel = sendActionCard.querySelector('p');
			if (statusLabel) {
				statusLabel.innerHTML = `⚡ <span data-i18n="transfer.sending">${t('transfer.sending')}</span>`;
			}
		}

		const recvProgressCard = this.#container.querySelector('#receive-progress-card');
		if (recvProgressCard) {
			const statusLabel = recvProgressCard.querySelector('p');
			if (statusLabel) {
				statusLabel.innerHTML = `<span data-i18n="transfer.receiving">${t('transfer.receiving')}</span>`;
			}
		}

		const saveFileBtn = this.#container.querySelector('#save-file-btn');
		if (saveFileBtn) {
			saveFileBtn.innerHTML = `💾 ${t('btn.download')}`;
		}
	}

	#getStatusHTML(state, label = null, tooltip = null) {
		const labels = {
			connecting: t('connection.connecting'),
			connected: label || t('room.connected'),
			direct: label || t('connection.direct'),
			relay: label || t('connection.relay'),
			error: t('room.error'),
		};
		const stateClass = state === 'connected' ? 'connected' : state;
		const txt = labels[state] || state;
		const waiting =
			state === 'connecting'
				? `<p class="text-sm text-muted" style="margin-top:var(--space-3);">${t('room.waiting')}</p>`
				: '';
		return `
      <div class="connection-status ${stateClass}" ${tooltip ? `title="${tooltip}"` : ''}>
        <span class="status-dot${state === 'connecting' ? ' pulse' : ''}"></span>
        <span>${txt}</span>
        ${tooltip ? '<span style="font-size:14px;opacity:0.6;" title="' + tooltip + '">ℹ️</span>' : ''}
      </div>
      ${waiting}
    `;
	}

	#showSendReady() {
		// Show the progress bar and send button in the send flow
		const transferCard = this.#container.querySelector('.transfer-steps');
		if (!transferCard) return;

		const existingActions = transferCard.querySelector('#send-action-card');
		if (existingActions) return;

		const actionCard = document.createElement('div');
		actionCard.className = 'card-flat anim-fade-in';
		actionCard.id = 'send-action-card';

		const pb = createProgressBar({
			onPause: () => {
				this.#transfer.pauseSend();
				pb.setPausedState(true);
			},
			onResume: () => {
				this.#transfer.resumeSend();
				pb.setPausedState(false);
			},
			onCancel: () => {
				this.#transfer.cancelSend();
			}
		});
		this.#progressBar = pb;

		const statusLabel = document.createElement('p');
		statusLabel.className = 'text-sm text-secondary';
		statusLabel.style.marginBottom = 'var(--space-3)';
		statusLabel.innerHTML = `⚡ <span data-i18n="transfer.sending">${t('transfer.sending')}</span>`;

		actionCard.appendChild(statusLabel);
		actionCard.appendChild(pb.el);
		transferCard.appendChild(actionCard);

		// Automatically trigger the send of files!
		if (this.#files.length > 0) {
			this.#transfer.send(this.#files).catch((err) => {
				console.error('Failed to auto-send files:', err);
			});
		}
	}

	#showReceiveProgress(meta, isResuming = false, bytesReceived = 0) {
		const transferCard =
			this.#container.querySelector('.transfer-steps') || this.#container;

		// Clear any existing receive progress card to avoid duplicates
		const existingCard = transferCard.querySelector('#receive-progress-card');
		if (existingCard) {
			existingCard.remove();
		}

		const progressCard = document.createElement('div');
		progressCard.className = 'card-flat anim-fade-in';
		progressCard.id = 'receive-progress-card';

		const pb = createProgressBar({
			onPause: () => {
				this.#transfer.pauseReceive();
				pb.setPausedState(true);
			},
			onResume: () => {
				this.#transfer.resumeReceive();
				pb.setPausedState(false);
			},
			onCancel: () => {
				this.#transfer.cancelReceive();
			}
		});
		this.#progressBar = pb;
		const progress = bytesReceived / meta.size;
		pb.update({
			filename: meta.filename,
			progress,
			speed: 0,
			eta: Infinity,
			bytesReceived,
			totalSize: meta.size,
			isResuming,
		});

		progressCard.innerHTML = `<p class="text-sm text-muted" style="margin-bottom:var(--space-3);">${t('transfer.receiving')}</p>`;
		progressCard.appendChild(pb.el);
		transferCard.appendChild(progressCard);
	}

	#showCompletionAnimation() {
		const overlay = document.createElement('div');
		overlay.className = 'completion-overlay';
		overlay.innerHTML = `<div class="completion-circle">✅</div>`;
		document.body.appendChild(overlay);
		setTimeout(() => overlay.remove(), 2500);
		showToast(t('transfer.complete'), 'success', 5000);
	}

	#resetReceiverUI() {
		if (this.#mode === 'receive') {
			const joinBtn = this.#container.querySelector('#join-btn');
			const codeInput = this.#container.querySelector('#code-input');
			if (joinBtn) {
				joinBtn.disabled = false;
				joinBtn.innerHTML = `🔗 ${t('room.join')}`;
			}
			if (codeInput) {
				codeInput.disabled = false;
			}
		}
	}

	getRoomCode() {
		return this.#roomCode;
	}

	destroy() {
		this.#signaling?.close();
		this.#rtc?.close();
		if (this.#onLangChange) {
			window.removeEventListener('langchange', this.#onLangChange);
		}
		this.#container.classList.remove('single-panel');
		this.#container.innerHTML = '';
	}
}
