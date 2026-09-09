import * as Sentry from '@sentry/node';

// Headers that must never reach Sentry — auth tokens and session cookies.
const SCRUBBED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);

function scrubEvent(event) {
  // Remove auth headers.
  if (event.request?.headers) {
    const headers = { ...event.request.headers };
    for (const key of Object.keys(headers)) {
      if (SCRUBBED_HEADERS.has(key.toLowerCase())) {
        headers[key] = '[Filtered]';
      }
    }
    event.request = { ...event.request, headers };
  }

  // Remove request body — may contain financial amounts, account details, or credentials.
  if (event.request) {
    event.request = { ...event.request, data: '[Filtered]' };
  }

  return event;
}

/**
 * Initialise Sentry error monitoring. No-op when dsn is absent or empty —
 * safe to call unconditionally in all environments.
 */
export function initSentry(dsn) {
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    maxBreadcrumbs: 20,
  });
}

export { Sentry };
