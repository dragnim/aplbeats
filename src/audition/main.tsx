import { createRoot } from 'react-dom/client';
import { Bench } from './Bench';
import '@/styles/global.css';

/*
 * The audition bench's entry point.
 *
 * **No `StrictMode`**, and that is the one deliberate difference from `src/main.tsx`. Strict mode
 * mounts every effect twice, which the application tolerates by design — and which here would mean
 * two transports, two audio devices and two samplers racing to install into whichever survived.
 * The application is where that discipline is worth verifying; this is a tool for listening, and a
 * double-mounted transport would make it lie about what it is playing.
 */
const container = document.querySelector('#root');
if (container === null) {
  throw new Error('The audition bench could not find its mount point.');
}

createRoot(container).render(<Bench />);
