/**
 * FastWayShare — main.js
 * Application entry point.
 */

// Styles (order matters: design system → components → animations)
import './styles/index.css';
import './styles/components.css';
import './styles/animations.css';

// App
import { App } from './ui/app.js';

// Check WebRTC support early
if (!window.RTCPeerConnection) {
  document.getElementById('app').innerHTML = `
    <div style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui;
      color: #fc4c4c;
      text-align: center;
      padding: 2rem;
    ">
      <div>
        <div style="font-size:3rem;margin-bottom:1rem;">⚠️</div>
        <h2>WebRTC not supported</h2>
        <p>Please use a modern browser (Chrome, Firefox, Edge, Safari) to use FastWayShare.</p>
      </div>
    </div>
  `;
} else {
  const app = new App();
  app.init();
}
