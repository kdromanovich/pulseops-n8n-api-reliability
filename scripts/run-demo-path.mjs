#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'workflows', 'pulseops-api-reliability-control-tower.json'), 'utf8'),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const staticData = {};
const executed = new Set();

function toItems(input) {
  if (input === undefined) return [];
  const values = Array.isArray(input) ? input : [input];
  return values.map((value) => (value && Object.hasOwn(value, 'json') ? value : { json: value }));
}

async function executeCode(name, input, lookups = {}, variables = {}, environment = {}) {
  const node = nodes.get(name);
  assert(node, `Missing node: ${name}`);
  assert.equal(node.type, 'n8n-nodes-base.code', `${name} is not a Code node`);
  const inputItems = toItems(input);
  const $input = { first: () => inputItems[0], all: () => inputItems };
  const $getWorkflowStaticData = () => staticData;
  const $ = (nodeName) => {
    assert(Object.hasOwn(lookups, nodeName), `Missing mocked lookup for ${nodeName}`);
    const items = toItems(lookups[nodeName]);
    return {
      first: () => items[0],
      item: items[0],
      all: () => items,
    };
  };
  const fn = new AsyncFunction(
    '$input',
    '$vars',
    '$env',
    '$execution',
    '$getWorkflowStaticData',
    '$',
    node.parameters.jsCode,
  );
  const result = await fn($input, variables, environment, { id: 'offline-demo' }, $getWorkflowStaticData, $);
  assert(Array.isArray(result), `${name} must return an item array`);
  for (const item of result) assert(item && typeof item.json === 'object', `${name} returned an invalid item`);
  executed.add(name);
  return result;
}

async function executeOne(name, input, lookups = {}, variables = {}, environment = {}) {
  const result = await executeCode(name, input, lookups, variables, environment);
  assert.equal(result.length, 1, `${name} must return exactly one item`);
  return result[0].json;
}

// Deterministic incident-cycle demo: five probes, three state-change events.
let monitor = await executeOne('Set Job Type: Monitor', {});
monitor = await executeOne('Load Runtime and Service Config', monitor);
assert.equal(monitor.config.demo_mode, true, 'default must be demo mode');
monitor = await executeOne('Load Integration Config', monitor);
let services = await executeCode('Fan Out Service Catalog', monitor);
assert.equal(services.length, 5);
services = await executeCode('Start Probe Timer', services);
let probeItems = await executeCode('Generate Demo Probe Results', services);
let batch = await executeOne('Aggregate Probe Results', probeItems);
batch = await executeOne('Evaluate Incident State Machine', batch);
assert.deepEqual(batch.state_summary, { overall_state: 'down', healthy: 3, degraded: 1, down: 1 });
assert.equal(batch.event_count, 3);
assert.deepEqual(batch.events.map((event) => event.type).sort(), [
  'incident_opened',
  'incident_recovered',
  'performance_degraded',
]);
let eventItems = await executeCode('Fan Out Reliability Events', batch);
eventItems = await executeCode('Simulate Incident Integrations', eventItems);
const demoSummary = await executeOne('Return Demo Incident Summary', eventItems);
assert.equal(demoSummary.status, 'demo_incident_cycle_completed');
assert.equal(demoSummary.event_count, 3);
assert.equal(demoSummary.events.find((event) => event.type === 'incident_opened').actions.jira, 'simulated_issue_created');

// Deterministic daily SLO demo.
let digest = await executeOne('Set Job Type: Daily Digest', {});
digest = await executeOne('Load Runtime and Service Config', digest);
digest = await executeOne('Load Integration Config', digest);
digest = await executeOne('Build Daily SLO Digest', digest);
assert.equal(digest.total_checks, 1440);
assert.equal(digest.breach_count, 2);
const demoDigest = await executeOne('Return Demo SLO Digest', digest);
assert.equal(demoDigest.status, 'demo_digest_completed');
assert.equal(demoDigest.delivery, 'simulated_telegram');
const liveDigest = await executeOne(
  'Return Daily Digest Outcome',
  { ok: true },
  { 'Build Daily SLO Digest': digest },
);
assert.equal(liveDigest.delivery, 'telegram_sent');

// Live configuration must fail closed and reject private probe targets.
await assert.rejects(
  () => executeCode('Load Runtime and Service Config', { job_type: 'monitor' }, {}, { PULSEOPS_DEMO_MODE: 'false' }),
  /PULSEOPS_SERVICE_CATALOG_JSON/,
);
const baseLiveVariables = {
  PULSEOPS_DEMO_MODE: 'false',
  PULSEOPS_TELEGRAM_CHAT_ID: '-1001234567890',
  PULSEOPS_JIRA_BASE_URL: 'https://your-domain.atlassian.net',
  PULSEOPS_JIRA_PROJECT_KEY: 'OPS',
  PULSEOPS_JIRA_RESOLVE_TRANSITION_ID: '31',
  PULSEOPS_SERVICE_CATALOG_JSON: JSON.stringify([
    {
      id: 'checkout-api',
      name: 'Checkout API',
      url: 'https://health.example.com/checkout',
      expected_statuses: [200],
      latency_threshold_ms: 600,
      criticality: 'critical',
    },
  ]),
};
let liveRoot = await executeOne('Load Runtime and Service Config', { job_type: 'monitor' }, {}, baseLiveVariables);
assert.equal(liveRoot.config.services.length, 1);
const environmentConfigured = await executeOne(
  'Load Runtime and Service Config',
  { job_type: 'monitor' },
  {},
  {},
  baseLiveVariables,
);
assert.equal(environmentConfigured.config.demo_mode, false);
assert.equal(environmentConfigured.config.services[0].id, 'checkout-api');
await assert.rejects(
  () => executeCode('Load Runtime and Service Config', { job_type: 'monitor' }, {}, {
    ...baseLiveVariables,
    PULSEOPS_SERVICE_CATALOG_JSON: JSON.stringify([
      { id: 'private-api', name: 'Private API', url: 'https://127.0.0.1/health', expected_statuses: [200], criticality: 'high' },
    ]),
  }),
  /safe public HTTPS URL/,
);
await assert.rejects(
  () => executeCode('Load Integration Config', liveRoot, {}, {}),
  /Missing live integration configuration/,
);
liveRoot = await executeOne('Load Integration Config', liveRoot, {}, {
  PULSEOPS_RUNBOOK_ENABLED: 'true',
  PULSEOPS_RUNBOOK_WEBHOOK_URL: 'https://automation.example.com/runbooks/restart',
  PULSEOPS_STATUS_PAGE_WEBHOOK_URL: 'https://status.example.com/incidents',
  PULSEOPS_ON_CALL_WEBHOOK_URL: 'https://oncall.example.com/events',
});

// Live probe normalization handles HTTP failures and redacts obvious secrets.
const liveServiceContext = {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  triggered_at: new Date().toISOString(),
  service_index: 0,
  service: liveRoot.config.services[0],
  check_started_at_ms: Date.now() - 125,
  statusCode: 500,
  body: '{"status":"failed","authorization":"Bearer do-not-publish-this-value","token":"second-secret-value"}',
};
const normalizedLive = await executeOne('Normalize Live Probe Result', liveServiceContext);
assert.equal(normalizedLive.check.success, false);
assert.match(normalizedLive.check.response_excerpt, /\[REDACTED\]/);
assert.doesNotMatch(normalizedLive.check.response_excerpt, /do-not-publish|second-secret/);

const makeCheck = (success, statusCode, latencyMs, error = null) => ({
  service: liveRoot.config.services[0],
  check: {
    success,
    status_code: statusCode,
    latency_ms: latencyMs,
    error,
    checked_at: new Date().toISOString(),
    response_excerpt: '',
    provider: 'offline_test',
  },
});
const stateBatch = (row) => ({
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  triggered_at: new Date().toISOString(),
  checks: [row],
  probe_summary: { total: 1, successful: row.check.success ? 1 : 0, failed: row.check.success ? 0 : 1, availability_percent: row.check.success ? 100 : 0, p50_latency_ms: row.check.latency_ms, p95_latency_ms: row.check.latency_ms },
});

staticData.pulseops_state = {};
staticData.pulseops_metrics = {};
let firstFailure = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(false, 503, 900, 'Unavailable')));
assert.equal(firstFailure.service_states[0].state, 'degraded');
assert.equal(firstFailure.events[0].type, 'service_degraded');
let opened = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(false, 503, 950, 'Unavailable')));
assert.equal(opened.service_states[0].state, 'down');
assert.equal(opened.events[0].type, 'incident_opened');
assert.equal(opened.events[0].jira_issue_key, null);

const openedContext = {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  event: opened.events[0],
  statusCode: 201,
  body: { key: 'OPS-100' },
};
const jiraPrepared = await executeOne('Persist Jira Key and Prepare Alert', openedContext);
assert.equal(jiraPrepared.integration_results.jira_creation, 'created');
assert.equal(staticData.pulseops_state['checkout-api'].jira_issue_key, 'OPS-100');
const controlsPrepared = await executeOne('Prepare Incident Control Actions', {
  ...jiraPrepared,
  statusCode: 202,
  body: { execution_id: 'RUNBOOK-100' },
});
assert.equal(controlsPrepared.integration_results.runbook_status, 'dispatched');
const incidentFinalized = await executeOne('Finalize Incident Integrations', {
  ...controlsPrepared,
  statusCode: 201,
  body: { id: 'STATUS-100' },
});
assert.equal(staticData.pulseops_state['checkout-api'].status_page_incident_id, 'STATUS-100');
const incidentOutcome = await executeOne(
  'Return Incident Outcome',
  { ok: true },
  { 'Finalize Incident Integrations': incidentFinalized },
);
assert.equal(incidentOutcome.success, true);

const tentativeRecovery = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(true, 200, 220)));
assert.equal(tentativeRecovery.service_states[0].state, 'down');
assert.equal(tentativeRecovery.event_count, 0);
const stableSnapshot = await executeOne('Return Stable Monitoring Snapshot', tentativeRecovery);
assert.equal(stableSnapshot.status, 'stable');
const recovery = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(true, 200, 210)));
assert.equal(recovery.service_states[0].state, 'healthy');
assert.equal(recovery.events[0].type, 'incident_recovered');
assert.equal(recovery.events[0].jira_issue_key, 'OPS-100');
assert.equal(recovery.events[0].status_page_incident_id, 'STATUS-100');
assert.equal(staticData.pulseops_state['checkout-api'].jira_issue_key, null);
const recoveryPrepared = await executeOne('Prepare Recovery Alert', {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  event: recovery.events[0],
  statusCode: 204,
  body: '',
});
assert.equal(recoveryPrepared.integration_results.jira_resolution, 'resolved');
const recoveryFinalized = await executeOne('Finalize Recovery Integrations', {
  ...recoveryPrepared,
  statusCode: 202,
  body: { ok: true },
});
const recoveryOutcome = await executeOne(
  'Return Recovery Outcome',
  { ok: true },
  { 'Finalize Recovery Integrations': recoveryFinalized },
);
assert.equal(recoveryOutcome.success, true);

// Degradation and escalation outcomes, including failed-page retry eligibility.
const stateChangePrepared = await executeOne('Prepare State-Change Alert', {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  event: firstFailure.events[0],
});
const stateChangeOutcome = await executeOne(
  'Return State-Change Outcome',
  { ok: true },
  { 'Prepare State-Change Alert': stateChangePrepared },
);
assert.equal(stateChangeOutcome.status, 'service_degraded');

staticData.pulseops_state['checkout-api'] = {
  service_id: 'checkout-api', service_name: 'Checkout API', state: 'down', previous_state: 'down',
  consecutive_failures: 4, consecutive_successes: 0, incident_id: 'inc_checkout_test',
  jira_issue_key: 'OPS-200', status_page_incident_id: 'STATUS-200',
  down_since: Date.now() - 20 * 60000, escalated: false,
  escalation_attempts: 0, last_escalation_attempt_at: null,
};
let escalation = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(false, 503, 1000, 'Unavailable')));
assert.equal(escalation.events[0].type, 'incident_escalated');
let escalationPrepared = await executeOne('Prepare Escalation Alert', {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  event: escalation.events[0],
  statusCode: 500,
  body: { error: 'provider unavailable' },
});
assert.equal(escalationPrepared.on_call_status, 'failed');
assert.equal(staticData.pulseops_state['checkout-api'].escalated, false);
const throttled = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(false, 503, 1000, 'Unavailable')));
assert.equal(throttled.event_count, 0);
staticData.pulseops_state['checkout-api'].last_escalation_attempt_at = Date.now() - 6 * 60000;
escalation = await executeOne('Evaluate Incident State Machine', stateBatch(makeCheck(false, 503, 1000, 'Unavailable')));
escalationPrepared = await executeOne('Prepare Escalation Alert', {
  config: liveRoot.config,
  run_id: liveRoot.run_id,
  event: escalation.events[0],
  statusCode: 202,
  body: { dedup_key: 'inc_checkout_test' },
});
assert.equal(staticData.pulseops_state['checkout-api'].escalated, true);
const escalationOutcome = await executeOne(
  'Return Escalation Outcome',
  { ok: true },
  { 'Prepare Escalation Alert': escalationPrepared },
);
assert.equal(escalationOutcome.success, true);

const status = await executeOne('Read Persisted Reliability State', {});
assert.equal(status.counts.total, 1);
assert.equal(status.active_incidents.length, 1);
assert.equal(status.active_incidents[0].escalated, true);

const codeNodeCount = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code').length;
assert.equal(executed.size, codeNodeCount, `Executed ${executed.size} of ${codeNodeCount} Code nodes`);

console.log(`PASS: offline scenarios executed all ${executed.size} production Code nodes without external calls`);
console.log('PASS: five-service demo produced one outage, one recovery, and one latency degradation');
console.log('PASS: SLO digest, live fail-closed config, URL guard, redaction, hysteresis, identifier lifecycle, integration failures, and escalation retry completed');
