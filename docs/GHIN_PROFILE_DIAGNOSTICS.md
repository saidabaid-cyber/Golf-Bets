# GHIN profile diagnostics — Preview only

This diagnostic layer is intentionally limited to `POST /api/profile/ghin` in
Vercel Preview. It does not change the Firebase Installation, `golfer_login`,
golfer lookup, scores, token, retry, or persistence contracts.

Each server event starts with `[ghin-profile]` and contains only:

- `operation`: `authorize`, `reauthorize`, `refresh`, or `scores`;
- `stage`: the bounded stage name;
- `endpoint`: an allowlisted path with no query string;
- upstream `httpStatus` when one exists;
- normalized `code`;
- `retryable`;
- `durationMs`;
- `timestamp`;
- `errorName` only for an unexpected non-GHIN exception.

Password, login/email, GHIN number, request/response bodies, Firebase token,
golfer bearer, Authorization, cookies, user IDs, and raw upstream errors are
not accepted by the event contract. Unknown endpoints and codes are collapsed
to `/unknown` and `unknown`. Logging is disabled unless
`VERCEL_ENV === "preview"`.

## Current evidence boundary

| Flow | Status | Evidence |
| --- | --- | --- |
| Login using GHIN number | `NOT_TESTED` | The canonical sanitized live POC does not record a numeric login attempt. |
| Login using email | `PASS_LIVE` | The authorized QA credential configured for the canonical live POC was email-shaped; Firebase and `golfer_login` returned HTTP 200. The address is intentionally not retained here. |
| Identity from `golfer_login` | `NOT_TESTED` | The live evidence proves token extraction, then a separate golfer lookup; it does not prove that the login body contained usable golfer identity. |
| Fallback lookup by email | `PASS_MOCK_ONLY` | Covered by the GHIN client tests, including ambiguity rejection; no live upstream evidence exists yet. |
| Fallback lookup by GHIN number | `PASS_MOCK_ONLY` | The endpoint itself passed live for the fixed QA golfer, but the exact numeric-login fallback branch has only controlled test coverage. |

The next legitimate user attempt in `https://dev.thebackyard.com.mx` will make
the failing stage visible in server logs without adding internal detail to the
browser response. No artificial credentials should be used to manufacture the
event.
