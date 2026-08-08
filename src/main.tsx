import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { reactErrorHandler } from '@sentry/react';

import './instrument';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
