# Setup

This guide covers demo import and live activation on n8n `2.17.5`.

## 1. Import

1. Download `workflows/pulseops-api-reliability-control-tower.json`.
2. In n8n, choose **Import from File**.
3. Confirm the workflow is inactive.
4. Do not assign production credentials yet.
5. Run **Demo: Run Incident Cycle** and **Demo: Run Daily Digest**.

Demo mode is the default. An absent `PULSEOPS_DEMO_MODE` is interpreted as `true`.

## 2. Run the demos

The incident demo must return five checked services and three events:

- Authentication API → `incident_opened`;
- Payments API → `incident_recovered`;
- Search API → `performance_degraded`.

The SLO demo must return 1,440 checks and two breaches. Neither branch should execute an HTTP provider or Telegram node.

## 3. Choose a configuration route

PulseOps resolves every non-secret setting in this order:

1. an n8n Variable with the `PULSEOPS_*` name;
2. a self-hosted environment variable with the same name, if Code-node environment access is permitted;
3. the explicit `LOCAL_CONFIG` or `LOCAL_INTEGRATIONS` block in the two configuration Code nodes;
4. the documented default.

Use only one primary route per environment so ownership remains clear.

| Route | Best fit | Action |
| --- | --- | --- |
| n8n Variables | An edition that exposes global Variables | Create `PULSEOPS_*` values in the Variables UI |
| Environment | Self-hosted instance where Code nodes may read environment values | Add non-secret `PULSEOPS_*` values to the n8n runtime and restart it |
| Local fallback | Community/self-hosted installation without either feature | Edit only `LOCAL_CONFIG` and `LOCAL_INTEGRATIONS` in their named Code nodes |

The official reference for the first route is [Define custom variables](https://docs.n8n.io/build/code-in-n8n/define-custom-variables/) and the Code-node accessor is documented under [`$vars`](https://docs.n8n.io/build/code-in-n8n/cookbook/built-in-methods-and-variables-examples/vars/).

Use Code-node environment access only when it matches the security policy of the n8n instance. Keep the local fallback limited to non-secret values.

The repository includes `.env.example` as a non-secret reference. Do not turn it into a secret store or commit a populated `.env` file.

### Required configuration keys for live mode

| Variable | Example | Notes |
| --- | --- | --- |
| `PULSEOPS_DEMO_MODE` | `false` | Keep `true` until final cutover |
| `PULSEOPS_SERVICE_CATALOG_JSON` | See below | 1–100 services |
| `PULSEOPS_TELEGRAM_CHAT_ID` | `-1001234567890` | Identifier, not the bot token |
| `PULSEOPS_JIRA_BASE_URL` | `https://your-domain.atlassian.net` | Replace the placeholder; base URL only |
| `PULSEOPS_JIRA_PROJECT_KEY` | `OPS` | Uppercase Jira key |
| `PULSEOPS_JIRA_RESOLVE_TRANSITION_ID` | `31` | Workflow-specific transition ID |
| `PULSEOPS_STATUS_PAGE_WEBHOOK_URL` | `https://status-adapter.example.com/incidents` | Adapter/provider endpoint |
| `PULSEOPS_ON_CALL_WEBHOOK_URL` | `https://oncall-adapter.example.com/events` | Adapter/provider endpoint |

If `PULSEOPS_RUNBOOK_ENABLED=true`, `PULSEOPS_RUNBOOK_WEBHOOK_URL` is also required.

### Optional policy variables

| Variable | Default | Allowed range / behavior |
| --- | ---: | --- |
| `PULSEOPS_REQUEST_TIMEOUT_MS` | `8000` | 1,000–60,000 ms |
| `PULSEOPS_DOWN_AFTER_FAILURES` | `2` | 1–10 checks |
| `PULSEOPS_RECOVER_AFTER_SUCCESSES` | `2` | 1–10 checks |
| `PULSEOPS_ESCALATION_MINUTES` | `15` | 1–1,440 minutes |
| `PULSEOPS_ESCALATION_RETRY_MINUTES` | `5` | 1–120 minutes |
| `PULSEOPS_ROLLING_SAMPLE_LIMIT` | `288` | 10–10,000 samples per service/day |
| `PULSEOPS_METRICS_RETENTION_DAYS` | `14` | 1–90 UTC day buckets |
| `PULSEOPS_SLO_TARGET_PERCENT` | `99.9` | 90–99.999 |
| `PULSEOPS_JIRA_ISSUE_TYPE` | `Task` | Must exist in the target project |
| `PULSEOPS_RUNBOOK_ENABLED` | `false` live / `true` demo | Enables remediation call |
| `PULSEOPS_RUNBOOK_WEBHOOK_URL` | empty | Required when runbook is enabled |

### Service catalog

Store the JSON array as the value of `PULSEOPS_SERVICE_CATALOG_JSON` through the selected route:

```json
[
  {
    "id": "checkout-api",
    "name": "Checkout API",
    "url": "https://health.example.com/checkout",
    "expected_statuses": [200],
    "latency_threshold_ms": 600,
    "criticality": "critical"
  },
  {
    "id": "public-web",
    "name": "Public Website",
    "url": "https://www.example.com/health",
    "expected_statuses": [200, 204],
    "latency_threshold_ms": 900,
    "criticality": "high"
  }
]
```

Rules enforced at runtime:

- `id` is lowercase and uses letters, numbers, and hyphens;
- IDs are unique;
- `criticality` is `low`, `medium`, `high`, or `critical`;
- at least one valid expected HTTP status is required;
- the URL must be public HTTPS, without embedded credentials or a private literal IP;
- the catalog contains no more than 100 services.

The URL guard intentionally blocks private IP ranges. If your health endpoints are internal, do not weaken the guard blindly. Replace dynamic URL input with an explicit host allowlist and enforce the same boundary in your network egress policy.

## 4. Assign credentials

The workflow supports authentication modes configured through environment variables.

| Node group | n8n credential | Recommended scope |
| --- | --- | --- |
| `Jira: Create Incident`, `Jira: Resolve Incident` | HTTP Basic Auth | Dedicated Jira automation user; target project only |
| `Runbook: Dispatch Remediation` | HTTP Header Auth | One runbook endpoint; least privilege |
| `Status Page: Open Incident`, `Status Page: Resolve Incident` | HTTP Header Auth | Incident create/resolve only |
| `On-Call: Trigger Escalation` | HTTP Header Auth | Event trigger only |
| Five `Telegram:` nodes | Telegram API | One operational bot and chat |
| `API: Current Reliability Status` | Header Auth | Long random value; rotate periodically |

Keep bot tokens, Jira API tokens, and webhook secrets in n8n Credentials. Do not place them in Variables, Code nodes, sample JSON, or Git.

## 5. Configure Jira

The workflow uses Jira Cloud REST API v3:

- create issue: `POST /rest/api/3/issue`;
- resolve issue: `POST /rest/api/3/issue/{issueIdOrKey}/transitions`.

The transition ID is specific to the Jira workflow. Query the available transitions for a representative issue before setting `PULSEOPS_JIRA_RESOLVE_TRANSITION_ID`. See Atlassian's official [Issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).

Test permissions for:

- creating the configured issue type;
- applying labels;
- writing Atlassian Document Format descriptions;
- performing the chosen transition.

## 6. Define adapter contracts

Runbook, status-page, and on-call nodes deliberately use generic Header Auth HTTP endpoints. This keeps the workflow provider-neutral. Your endpoint or adapter must accept the contracts in [Data Contracts](DATA_CONTRACTS.md).

A successful provider action must return an HTTP 2xx status. Recommended response identifiers:

- runbook: `execution_id`, `job_id`, or `run_id`;
- status page: `status_page_incident_id`, `incident_id`, or `id`;
- on-call: any 2xx response; use `dedup_key` from the request for correlation.

## 7. Test live mode without activating schedules

1. Keep the workflow inactive.
2. Assign non-production credentials and endpoints.
3. Set `PULSEOPS_DEMO_MODE=false`.
4. Manually execute the monitoring path from the schedule branch or temporarily use a copied workflow dedicated to staging.
5. Test healthy, slow, first-failure, outage, recovery, and provider-error cases.
6. Confirm that Jira and status-page identifiers survive until recovery.
7. Confirm a failed on-call call is retried only after the configured cooldown.

Do not point a staging test at a production on-call service unless paging is explicitly intended.

## 8. Activate

Before activation:

- verify every endpoint and threshold;
- confirm the schedule timezone is UTC;
- confirm Jira transition behavior;
- verify the Telegram target;
- rotate any credential exposed during testing;
- send a request to the status API with and without Header Auth;
- confirm the service catalog, schedules, retention window, and escalation thresholds.

Activate the workflow only after the checklist passes.

## 9. Rollback

To stop all scheduled activity, deactivate the workflow. Deactivation does not automatically delete static state. If a clean state is required, create a controlled maintenance workflow or move state to an external database with an explicit reset procedure. Avoid ad-hoc edits to the production state object.
