# Data Contracts

All examples use synthetic data and reserved example domains.

## Service catalog item

```json
{
  "id": "checkout-api",
  "name": "Checkout API",
  "url": "https://health.example.com/checkout",
  "expected_statuses": [200],
  "latency_threshold_ms": 600,
  "criticality": "critical"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `id` | string | yes | Unique lowercase slug, 2–64 characters |
| `name` | string | yes | Non-empty, normalized, max 120 characters |
| `url` | string | yes | Public HTTPS URL, no embedded credentials |
| `expected_statuses` | integer array | yes | At least one value from 100–599 |
| `latency_threshold_ms` | integer | no | Defaults to 1,000; clamped to 50–120,000 |
| `criticality` | enum | no | `low`, `medium`, `high`, or `critical` |

## Normalized probe record

```json
{
  "service": {
    "id": "checkout-api",
    "name": "Checkout API"
  },
  "check": {
    "success": false,
    "status_code": 503,
    "latency_ms": 932,
    "error": "Unexpected HTTP status 503",
    "checked_at": "2026-09-06T18:00:00.000Z",
    "response_excerpt": "{\"status\":\"unavailable\"}",
    "provider": "live_http"
  }
}
```

`response_excerpt` is capped at 300 characters and applies pattern-based redaction for common credential labels. It is diagnostic only and must not be treated as a secure log sink.

## Probe batch

```json
{
  "run_id": "run_1788717600000_demo1234",
  "probe_summary": {
    "total": 5,
    "successful": 4,
    "failed": 1,
    "availability_percent": 80,
    "p50_latency_ms": 271,
    "p95_latency_ms": 2310
  },
  "checks": []
}
```

## Persisted service state

```json
{
  "service_id": "checkout-api",
  "service_name": "Checkout API",
  "state": "down",
  "previous_state": "degraded",
  "consecutive_failures": 2,
  "consecutive_successes": 0,
  "incident_id": "inc_checkout-api_1788717600000",
  "jira_issue_key": "OPS-100",
  "status_page_incident_id": "STATUS-100",
  "down_since": 1788717600000,
  "escalated": false,
  "escalation_attempts": 0,
  "last_escalation_attempt_at": null,
  "last_status_code": 503,
  "last_latency_ms": 932,
  "checked_at": "2026-09-06T18:00:00.000Z"
}
```

## Reliability event

```json
{
  "type": "incident_opened",
  "severity": "critical",
  "title": "Checkout API is DOWN",
  "message": "Unexpected HTTP status 503",
  "incident_id": "inc_checkout-api_1788717600000",
  "jira_issue_key": null,
  "status_page_incident_id": null,
  "service_id": "checkout-api",
  "service_name": "Checkout API",
  "criticality": "critical",
  "previous_state": "degraded",
  "current_state": "down",
  "status_code": 503,
  "latency_ms": 932,
  "occurred_at": "2026-09-06T18:00:00.000Z"
}
```

Allowed event types are `incident_opened`, `incident_recovered`, `incident_escalated`, `service_degraded`, `performance_degraded`, and `service_recovered`.

## Runbook request

```json
{
  "action": "restart_service",
  "service_id": "checkout-api",
  "incident_id": "inc_checkout-api_1788717600000",
  "run_id": "run_1788717600000_demo1234",
  "reason": "Unexpected HTTP status 503",
  "requested_at": "2026-09-06T18:15:00.000Z"
}
```

Recommended response:

```json
{
  "execution_id": "RUNBOOK-100",
  "status": "accepted"
}
```

## Status-page open request

```json
{
  "action": "open",
  "incident_id": "inc_checkout-api_1788717600000",
  "service_id": "checkout-api",
  "service_name": "Checkout API",
  "severity": "critical",
  "message": "Unexpected HTTP status 503",
  "started_at": "2026-09-06T18:00:00.000Z",
  "jira_issue_key": "OPS-100"
}
```

Recommended response:

```json
{
  "status_page_incident_id": "STATUS-100",
  "status": "open"
}
```

## Status-page resolve request

```json
{
  "action": "resolve",
  "incident_id": "inc_checkout-api_1788717600000",
  "status_page_incident_id": "STATUS-100",
  "service_id": "checkout-api",
  "resolved_at": "2026-09-06T18:25:00.000Z",
  "message": "Healthy after 2 consecutive successful checks",
  "jira_issue_key": "OPS-100"
}
```

## On-call request

```json
{
  "event_action": "trigger",
  "dedup_key": "inc_checkout-api_1788717600000",
  "severity": "critical",
  "service_id": "checkout-api",
  "summary": "Checkout API incident escalated",
  "source": "pulseops-n8n",
  "details": {
    "message": "Service has been down for at least 15 minutes",
    "status_code": 503,
    "latency_ms": 932,
    "jira_issue_key": "OPS-100"
  }
}
```

## Status API response

```json
{
  "success": true,
  "generated_at": "2026-09-06T18:30:00.000Z",
  "overall_state": "down",
  "counts": {
    "total": 5,
    "healthy": 3,
    "degraded": 1,
    "down": 1
  },
  "active_incidents": [
    {
      "service_id": "checkout-api",
      "service_name": "Checkout API",
      "incident_id": "inc_checkout-api_1788717600000",
      "jira_issue_key": "OPS-100",
      "down_since": "2026-09-06T18:00:00.000Z",
      "escalated": true
    }
  ],
  "services": []
}
```

The API intentionally omits response excerpts, integration endpoints, credentials, and raw metric history.

## Terminal outcome semantics

Live incident branches return `success=false` if any provider action failed. The event transition still remains persisted. The `status` field identifies the partial outcome, for example:

- `incident_opened`;
- `incident_opened_with_integration_errors`;
- `incident_recovered`;
- `incident_recovered_with_integration_errors`;
- `incident_escalated`;
- `incident_escalation_with_integration_errors`.

Detailed provider status is stored under `integration_results` where available.
