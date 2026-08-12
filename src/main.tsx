import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';

const container = document.querySelector('#root');
if (container === null) {
  throw new Error('APL Beats could not find its mount point.');
}

/*
 * Strict mode is on, which for an audio application is a choice rather than a
 * default: it mounts every effect twice, so anything holding a device has to
 * tolerate being built, torn down and built again. `useTransport` does — it
 * constructs a transport that opens no audio device until asked, and disposes it on
 * cleanup — and having that verified on every render in development is worth more
 * than the double mount costs.
 */
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
