// Global error logger for browser Inspect -> Console
window.addEventListener('error', (event) => {
  console.error('🚨 [Global Runtime Error]:', event.message, {
    file: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 [Unhandled Promise Rejection / API Error]:', event.reason);
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
