# Error Handling & Logging Standards

> Mandatory standards for all projects built on this scaffold.
> Agents MUST follow these rules when generating backend and frontend code.

---

## 1. Error Safety: Never Expose Internal Details

### Rule

**Frontend must NEVER display raw backend errors to users.** Internal errors (stack traces, database errors, internal service names, file paths) are security risks and confuse users.

### Implementation

#### Backend: Return Safe Error Responses

Every API endpoint must return errors in this format:

```typescript
// Standard error response shape
interface ApiError {
  error: {
    code: string;      // machine-readable, e.g. "AUTH_INVALID_TOKEN"
    message: string;   // user-friendly, e.g. "Your session has expired. Please log in again."
  };
}
```

Error code conventions:

| Prefix | Category | Example |
|--------|----------|---------|
| `AUTH_` | Authentication | `AUTH_INVALID_TOKEN`, `AUTH_SESSION_EXPIRED` |
| `VALIDATION_` | Input validation | `VALIDATION_EMAIL_INVALID`, `VALIDATION_REQUIRED_FIELD` |
| `PAYMENT_` | Payment/billing | `PAYMENT_CHECKOUT_FAILED`, `PAYMENT_PLAN_NOT_FOUND` |
| `RATE_LIMIT_` | Rate limiting | `RATE_LIMIT_EXCEEDED` |
| `INTERNAL_` | Server errors | `INTERNAL_ERROR` (generic — never expose details) |
| `NOT_FOUND_` | Resource not found | `NOT_FOUND_USER`, `NOT_FOUND_RESOURCE` |

#### Backend: Log the Real Error Internally

```typescript
// In your API error handler:
function handleError(err: Error, req: Request, res: Response) {
  // Log the FULL error internally (for debugging)
  logger.error({
    errorId: generateErrorId(),    // unique ID to correlate user report with log
    error: err.message,
    stack: err.stack,
    userId: req.user?.id ?? null,
    ip: req.ip,
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString()
  });

  // Return SAFE error to user
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again or contact support.",
      errorId: generateErrorId()  // so user can report this ID
    }
  });
}
```

#### Frontend: Display Generic Messages

```typescript
// BAD — exposes internal details
catch (err) {
  showToast(err.response.data.detail);
  // "psycopg2.errors.UniqueViolation: duplicate key value violates unique constraint"
}

// GOOD — uses the safe error from backend
catch (err) {
  const apiError = err.response?.data?.error;
  showToast(apiError?.message ?? "Something went wrong. Please try again.");
}
```

### Review Checklist

- [ ] Grep for `err.message` or `error.message` in frontend code — it should never be shown to users directly
- [ ] Grep for `stack` or `stackTrace` in API responses — must never appear
- [ ] Every API error handler returns the standard `{ error: { code, message } }` shape
- [ ] 500 errors always return `INTERNAL_ERROR` with a generic message

---

## 2. Logging System Design

### What to Log

Every project must capture these dimensions for each log entry:

| Field | Required | Purpose |
|-------|----------|---------|
| `timestamp` | Yes | When it happened (ISO 8601) |
| `level` | Yes | `error`, `warn`, `info`, `debug` |
| `message` | Yes | Human-readable description |
| `userId` | If authenticated | Who triggered it |
| `ip` | For API requests | Client identification |
| `method` | For API requests | HTTP method |
| `path` | For API requests | Request path |
| `statusCode` | For API responses | HTTP response code |
| `duration` | For API responses | Request duration in ms |
| `errorId` | For errors | Unique ID for correlation |
| `error` | For errors | Error message (internal only) |
| `stack` | For errors | Stack trace (internal only) |
| `action` | For business events | What the user did (e.g., "checkout_started", "plan_changed") |
| `metadata` | Optional | Additional context (plan type, product ID, etc.) |

### Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `error` | Something broke, needs fixing | Unhandled exception, payment webhook failed, database connection lost |
| `warn` | Potential problem, not broken yet | Rate limit approaching, deprecated API usage, auth token near expiry |
| `info` | Normal operations worth tracking | User logged in, subscription created, deployment started |
| `debug` | Development-only detail | Request/response payloads, SQL queries, cache hits/misses |

### Architecture

```
Frontend Error                Backend Error
     |                              |
     v                              v
POST /api/log/error           Logger middleware
  { code, context,              { timestamp, level,
    userAgent, url,               userId, ip, method,
    timestamp }                   path, error, stack }
     |                              |
     v                              v
  ┌──────────────────────────────────────┐
  │          Structured Log Store        │
  │  (file / stdout / external service)  │
  └──────────────────────────────────────┘
```

### Frontend Error Reporting

Frontend errors (uncaught exceptions, failed API calls) should be reported to the backend:

```typescript
// Frontend: error reporter
async function reportError(error: Error, context?: Record<string, unknown>) {
  try {
    await fetch("/api/log/error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        ...context
      })
    });
  } catch {
    // Logging failure should never break the app
  }
}

// Use in error boundary
class ErrorBoundary extends React.Component {
  componentDidCatch(error, info) {
    reportError(error, { componentStack: info.componentStack });
  }
}

// Use in API calls
catch (err) {
  reportError(err, { action: "checkout", plan: selectedPlan });
  showToast("Something went wrong. Please try again.");
}
```

### Backend: Log Endpoint

```typescript
// POST /api/log/error — receives frontend error reports
// Rate-limited to prevent abuse (e.g., 10 reports per minute per IP)
// Logged at "error" level with source: "frontend"
```

### Minimum Viable Implementation

For projects that don't need an external service yet:

1. **File-based**: Write structured JSON logs to `logs/app.log` (one JSON object per line)
2. **Rotation**: Use a simple size-based rotation (e.g., 10MB max, keep last 5 files)
3. **Stdout**: In containerized environments, log to stdout and let the platform handle collection

For production scale:

1. **Sentry** — error tracking with source maps, release tracking, user context
2. **Datadog / Grafana** — metrics, dashboards, alerting
3. **Custom** — any service that accepts structured JSON logs

---

## 3. Review Checklist for Error Handling & Logging

When reviewing code (Stage 4b of review-code.md), verify:

- [ ] No internal error details exposed in API responses (grep for stack traces in responses)
- [ ] All API endpoints use the standard error response shape
- [ ] Error codes follow the naming convention (PREFIX_DESCRIPTION)
- [ ] Logger is used consistently (no bare `console.log` in production code)
- [ ] API requests are logged with: timestamp, userId, method, path, statusCode, duration
- [ ] Errors are logged with: errorId, full error message, stack trace
- [ ] Frontend has an error boundary at the app root
- [ ] Frontend errors are reported to `/api/log/error`
- [ ] Frontend never displays `err.message` directly to users
- [ ] Rate limiting on the error reporting endpoint

---

*Last updated: 2026-03-20*
