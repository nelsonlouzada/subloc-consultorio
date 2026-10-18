import * as Sentry from '@sentry/nextjs';

// O valor de NEXT_PUBLIC_SENTRY_DSN é embutido na hora do build (mesmo DSN do projeto web).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
