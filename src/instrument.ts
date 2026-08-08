import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,

  integrations: [Sentry.browserTracingIntegration()],

  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
  tracePropagationTargets: ['localhost'],
});
