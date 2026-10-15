# Rule 35 — Observability and error tracking

> **Activation:** Always On. Required by the graduation brief (section 2.2). Breaking any rule fails the task.

- **O-01** Log **every request** with: request ID, user ID (when authenticated), HTTP method and route, response time, result (ok or error code). Use the structured logger. Never log tokens, passwords, reset or magic links, payment secrets, push tokens, or shift notes.
- **O-02** Log **every job attempt** with: job name, attempt number, outcome, error code, duration, and the related event ID (outbox event, webhook event, or notification job). A job that fails its last attempt must appear in the failed list and in Sentry.
- **O-03** Run **Sentry on both the server and the mobile app**. Scrub `Authorization` headers, tokens, push tokens, secrets, and notes before sending (`beforeSend`). Tag events with the request ID. Never put a Sentry auth token (source-map upload) in the app bundle or any `EXPO_PUBLIC_` variable. The mobile DSN is public by design and may be `EXPO_PUBLIC_`; list it in `SECURITY.md`.
- **O-04** Log the **payment trail**: request ID, idempotency key, quote ID, provider event ID, and ledger entry ID at each step of checkout and webhook processing. `ARCHITECTURE.md` must contain the walkthrough that answers "what happened to this user's payment at 3:14pm?" using a log query and a ledger query.
- Test: a deliberate error on the API and in the app shows up in Sentry with a request ID and with no token or note in the payload.
