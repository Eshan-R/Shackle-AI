import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent page refresh in desktop environment to preserve state
window.addEventListener('keydown', (e) => {
  if (
    e.key === 'F5' ||
    (e.ctrlKey && (e.key === 'r' || e.key === 'R'))
  ) {
    e.preventDefault();
    console.warn("Page reload prevented to preserve focus session state.");
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
