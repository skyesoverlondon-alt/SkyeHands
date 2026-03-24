import fs from 'node:fs';
import path from 'node:path';

import { appendAuditEvent } from './governance-manager.mjs';
import {
  getWorkspaceRuntime,
  listWorkspaces,
  runSnapshotRetentionCleanup,
  startWorkspace,
  stopWorkspace
} from './workspace-manager.mjs';
import { cleanupExpiredSessions } from './session-manager.mjs';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWorkspaceId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseTimestampMs(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function resolveBucketSizeMs(bucket) {
  const normalized = String(bucket || '').trim().toLowerCase();
  if (normalized === 'minute') {
    return { name: 'minute', sizeMs: 60 * 1000 };
  }

  if (normalized === 'hour') {
    return { name: 'hour', sizeMs: 60 * 60 * 1000 };
  }

  if (normalized === 'week') {
    return { name: 'week', sizeMs: 7 * 24 * 60 * 60 * 1000 };
  }

  return { name: 'day', sizeMs: 24 * 60 * 60 * 1000 };
}

function filterSchedulerHistoryEntries(entries, options = {}) {
  const trigger = String(options.trigger || '').trim() || null;
  const startAtMs = parseTimestampMs(options.startAt);
  const endAtMs = parseTimestampMs(options.endAt);

  return entries.filter(entry => {
    if (trigger && entry?.trigger !== trigger) {
      return false;
    }

    const completedAtMs = parseTimestampMs(entry?.completedAt || entry?.summary?.completedAt || null);
    if (startAtMs !== null && (completedAtMs === null || completedAtMs < startAtMs)) {
      return false;
    }

    if (endAtMs !== null && (completedAtMs === null || completedAtMs > endAtMs)) {
      return false;
    }

    return true;
  });
}

function aggregateTrendPoints(entries, bucketSizeMs) {
  const bucketMap = new Map();
  for (const entry of entries) {
    const completedAtMs = parseTimestampMs(entry?.completedAt || entry?.summary?.completedAt || null);
    if (completedAtMs === null) {
      continue;
    }

    const bucketStartMs = Math.floor(completedAtMs / bucketSizeMs) * bucketSizeMs;
    const current = bucketMap.get(bucketStartMs) || {
      runs: 0,
      remediations: 0,
      sessionCleanups: 0,
      retentionCleanups: 0,
      healthyCount: 0,
      unhealthyCount: 0
    };

    current.runs += 1;
    current.remediations += toInteger(entry?.delta?.remediations, toInteger(entry?.summary?.remediations, 0, 0), 0);
    current.sessionCleanups += toInteger(entry?.delta?.sessionCleanups, 0, 0);
    current.retentionCleanups += toInteger(entry?.delta?.retentionCleanups, 0, 0);
    current.healthyCount += toInteger(entry?.summary?.healthyCount, 0, 0);
    current.unhealthyCount += toInteger(entry?.summary?.unhealthyCount, 0, 0);
    bucketMap.set(bucketStartMs, current);
  }

  return Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStartMs, metrics]) => ({
      bucketStart: new Date(bucketStartMs).toISOString(),
      bucketEnd: new Date(bucketStartMs + bucketSizeMs).toISOString(),
      ...metrics
    }));
}

function toInteger(value, fallback, minimum = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (Number.isInteger(minimum) && parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    })
      .then(resolve)
      .catch(reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

export function getWorkspaceSchedulerPolicyPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'workspace-scheduler-policy.json');
}

export function getWorkspaceSchedulerStatePath(config) {
  return path.join(config.rootDir, '.skyequanta', 'workspace-scheduler-state.json');
}

function defaultWorkspaceSchedulerPolicy() {
  return {
    version: 1,
    enabled: parseBoolean(process.env.SKYEQUANTA_SCHEDULER_ENABLED, true),
    intervalMs: toInteger(process.env.SKYEQUANTA_SCHEDULER_INTERVAL_MS, 60000, 5000),
    healthTimeoutMs: toInteger(process.env.SKYEQUANTA_SCHEDULER_HEALTH_TIMEOUT_MS, 3000, 250),
    maxRestartsPerRun: toInteger(process.env.SKYEQUANTA_SCHEDULER_MAX_RESTARTS_PER_RUN, 3, 0),
    restartCooldownMs: toInteger(process.env.SKYEQUANTA_SCHEDULER_RESTART_COOLDOWN_MS, 300000, 0),
    cleanupExpiredSessions: parseBoolean(process.env.SKYEQUANTA_SCHEDULER_CLEANUP_EXPIRED_SESSIONS, true),
    retentionCleanupEnabled: parseBoolean(process.env.SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_ENABLED, true),
    retentionCleanupEveryRuns: toInteger(process.env.SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_EVERY_RUNS, 5, 1),
    historyMaxEntries: toInteger(process.env.SKYEQUANTA_SCHEDULER_HISTORY_MAX_ENTRIES, 500, 10)
  };
}

function normalizePolicy(policy) {
  const defaults = defaultWorkspaceSchedulerPolicy();
  const input = policy && typeof policy === 'object' ? policy : {};
  return {
    version: 1,
    enabled: parseBoolean(input.enabled, defaults.enabled),
    intervalMs: toInteger(input.intervalMs, defaults.intervalMs, 5000),
    healthTimeoutMs: toInteger(input.healthTimeoutMs, defaults.healthTimeoutMs, 250),
    maxRestartsPerRun: toInteger(input.maxRestartsPerRun, defaults.maxRestartsPerRun, 0),
    restartCooldownMs: toInteger(input.restartCooldownMs, defaults.restartCooldownMs, 0),
    cleanupExpiredSessions: parseBoolean(input.cleanupExpiredSessions, defaults.cleanupExpiredSessions),
    retentionCleanupEnabled: parseBoolean(input.retentionCleanupEnabled, defaults.retentionCleanupEnabled),
    retentionCleanupEveryRuns: toInteger(input.retentionCleanupEveryRuns, defaults.retentionCleanupEveryRuns, 1),
    historyMaxEntries: toInteger(input.historyMaxEntries, defaults.historyMaxEntries, 10)
  };
}

function defaultWorkspaceSchedulerState() {
  return {
    version: 1,
    running: false,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastRunSummary: null,
    totalRuns: 0,
    totalRemediations: 0,
    totalSessionCleanups: 0,
    totalRetentionCleanups: 0,
    lastError: null,
    history: [],
    workspaces: {}
  };
}

function normalizeState(state) {
  const defaults = defaultWorkspaceSchedulerState();
  const input = state && typeof state === 'object' ? state : {};
  const workspaces = input.workspaces && typeof input.workspaces === 'object' ? input.workspaces : {};
  const history = Array.isArray(input.history) ? input.history : [];

  return {
    version: 1,
    running: Boolean(input.running),
    lastStartedAt: input.lastStartedAt || null,
    lastStoppedAt: input.lastStoppedAt || null,
    lastRunAt: input.lastRunAt || null,
    lastCompletedAt: input.lastCompletedAt || null,
    lastRunSummary: input.lastRunSummary || null,
    totalRuns: toInteger(input.totalRuns, defaults.totalRuns, 0),
    totalRemediations: toInteger(input.totalRemediations, defaults.totalRemediations, 0),
    totalSessionCleanups: toInteger(input.totalSessionCleanups, defaults.totalSessionCleanups, 0),
    totalRetentionCleanups: toInteger(input.totalRetentionCleanups, defaults.totalRetentionCleanups, 0),
    lastError: input.lastError || null,
    history,
    workspaces
  };
}

export function getWorkspaceSchedulerHistory(config, options = {}) {
  const state = loadWorkspaceSchedulerState(config);
  const history = Array.isArray(state.history) ? state.history : [];
  const limit = toInteger(options.limit, 100, 1);
  const offset = normalizeOffset(options.offset);
  const filtered = filterSchedulerHistoryEntries(history, options);

  const total = filtered.length;
  const runs = filtered.slice(offset, offset + limit);
  const hasMore = offset + runs.length < total;

  return {
    total,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + runs.length : null,
    runs
  };
}

export function getWorkspaceSchedulerTrends(config, options = {}) {
  const state = loadWorkspaceSchedulerState(config);
  const history = Array.isArray(state.history) ? state.history : [];
  const filtered = filterSchedulerHistoryEntries(history, options);
  const { name: bucket, sizeMs: bucketSizeMs } = resolveBucketSizeMs(options.bucket);
  const offset = normalizeOffset(options.offset);
  const limit = toInteger(options.limit, 120, 1);
  const points = aggregateTrendPoints(filtered, bucketSizeMs);

  const total = points.length;
  const pagedPoints = points.slice(offset, offset + limit);
  const hasMore = offset + pagedPoints.length < total;
  const totals = pagedPoints.reduce((aggregate, point) => ({
    runs: aggregate.runs + point.runs,
    remediations: aggregate.remediations + point.remediations,
    sessionCleanups: aggregate.sessionCleanups + point.sessionCleanups,
    retentionCleanups: aggregate.retentionCleanups + point.retentionCleanups,
    healthyCount: aggregate.healthyCount + point.healthyCount,
    unhealthyCount: aggregate.unhealthyCount + point.unhealthyCount
  }), {
    runs: 0,
    remediations: 0,
    sessionCleanups: 0,
    retentionCleanups: 0,
    healthyCount: 0,
    unhealthyCount: 0
  });

  return {
    bucket,
    bucketSizeMs,
    total,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + pagedPoints.length : null,
    points: pagedPoints,
    totals,
    cumulativeTotals: {
      totalRuns: toInteger(state.totalRuns, 0, 0),
      totalRemediations: toInteger(state.totalRemediations, 0, 0),
      totalSessionCleanups: toInteger(state.totalSessionCleanups, 0, 0),
      totalRetentionCleanups: toInteger(state.totalRetentionCleanups, 0, 0)
    }
  };
}

export function getWorkspaceSchedulerTrendsCompact(config, options = {}) {
  const state = loadWorkspaceSchedulerState(config);
  const history = Array.isArray(state.history) ? state.history : [];
  const filtered = filterSchedulerHistoryEntries(history, options);
  const { name: bucket, sizeMs: bucketSizeMs } = resolveBucketSizeMs(options.bucket);
  const points = aggregateTrendPoints(filtered, bucketSizeMs);
  const latestBucket = points.length ? points[points.length - 1] : null;

  return {
    bucket,
    bucketSizeMs,
    totalBuckets: points.length,
    latestBucket,
    cumulativeTotals: {
      totalRuns: toInteger(state.totalRuns, 0, 0),
      totalRemediations: toInteger(state.totalRemediations, 0, 0),
      totalSessionCleanups: toInteger(state.totalSessionCleanups, 0, 0),
      totalRetentionCleanups: toInteger(state.totalRetentionCleanups, 0, 0)
    }
  };
}

export function loadWorkspaceSchedulerPolicy(config) {
  const filePath = getWorkspaceSchedulerPolicyPath(config);
  return normalizePolicy(readJson(filePath, null));
}

function saveWorkspaceSchedulerPolicy(config, policy) {
  writeJson(getWorkspaceSchedulerPolicyPath(config), normalizePolicy(policy));
}

export function updateWorkspaceSchedulerPolicy(config, updates = {}) {
  const current = loadWorkspaceSchedulerPolicy(config);
  const next = normalizePolicy({
    ...current,
    ...(updates && typeof updates === 'object' ? updates : {})
  });
  saveWorkspaceSchedulerPolicy(config, next);
  return next;
}

export function loadWorkspaceSchedulerState(config) {
  const filePath = getWorkspaceSchedulerStatePath(config);
  return normalizeState(readJson(filePath, null));
}

function saveWorkspaceSchedulerState(config, state) {
  writeJson(getWorkspaceSchedulerStatePath(config), normalizeState(state));
}

export function getWorkspaceSchedulerSnapshot(config) {
  return {
    policy: loadWorkspaceSchedulerPolicy(config),
    state: loadWorkspaceSchedulerState(config)
  };
}

async function probeHealth(url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(`${url.replace(/\/+$/, '')}/health`, timeoutMs);
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? 'ok' : 'unhealthy_http_status'
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function evaluateWorkspaceHealth(config, workspace, policy) {
  const runtime = getWorkspaceRuntime(config, workspace.id);
  const runtimeState = runtime?.state || null;

  if (!runtime?.runtime?.exists) {
    return {
      healthy: false,
      reason: 'runtime_not_provisioned',
      runtime
    };
  }

  if (!runtime?.runtime?.running) {
    return {
      healthy: false,
      reason: 'runtime_process_not_running',
      runtime
    };
  }

  if (!runtimeState?.urls?.ide || !runtimeState?.urls?.agent) {
    return {
      healthy: false,
      reason: 'runtime_urls_missing',
      runtime
    };
  }

  const [ide, agent] = await Promise.all([
    probeHealth(runtimeState.urls.ide, policy.healthTimeoutMs),
    probeHealth(runtimeState.urls.agent, policy.healthTimeoutMs)
  ]);

  if (ide.ok && agent.ok) {
    return {
      healthy: true,
      reason: 'healthy',
      runtime,
      checks: { ide, agent }
    };
  }

  return {
    healthy: false,
    reason: 'health_check_failed',
    runtime,
    checks: { ide, agent }
  };
}

function getCooldownRemainingMs(state, workspaceId, cooldownMs, timestampMs) {
  if (cooldownMs <= 0) {
    return 0;
  }

  const workspaceState = state.workspaces?.[workspaceId] || null;
  const lastRemediatedAt = workspaceState?.lastRemediatedAt || null;
  if (!lastRemediatedAt) {
    return 0;
  }

  const parsed = Date.parse(lastRemediatedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const elapsed = Math.max(0, timestampMs - parsed);
  return Math.max(0, cooldownMs - elapsed);
}

export async function runWorkspaceHealthSweep(config, options = {}) {
  const policy = loadWorkspaceSchedulerPolicy(config);
  const state = loadWorkspaceSchedulerState(config);
  const trigger = String(options.trigger || 'manual').trim() || 'manual';
  const targetWorkspaceId = normalizeWorkspaceId(options.workspaceId || null);

  const startedAt = nowIso();
  const startedAtMs = Date.parse(startedAt);
  const allWorkspaces = listWorkspaces(config).workspaces;
  const workspaces = targetWorkspaceId
    ? allWorkspaces.filter(workspace => workspace.id === targetWorkspaceId)
    : allWorkspaces;

  if (targetWorkspaceId && !workspaces.length) {
    throw new Error(`Workspace '${targetWorkspaceId}' is not registered.`);
  }

  let remediations = 0;
  const results = [];
  const previousTotals = {
    totalRuns: toInteger(state.totalRuns, 0, 0),
    totalRemediations: toInteger(state.totalRemediations, 0, 0),
    totalSessionCleanups: toInteger(state.totalSessionCleanups, 0, 0),
    totalRetentionCleanups: toInteger(state.totalRetentionCleanups, 0, 0)
  };
  const currentRunNumber = previousTotals.totalRuns + 1;
  const maintenance = {
    sessionCleanup: null,
    retentionCleanup: null
  };
  let sessionCleanupRemoved = 0;
  let retentionCleanupRemoved = 0;

  for (const workspace of workspaces) {
    const workspaceState = state.workspaces?.[workspace.id] || {};
    workspaceState.lastCheckedAt = nowIso();

    if (workspace.status !== 'running') {
      workspaceState.lastIssue = 'workspace_not_running';
      state.workspaces[workspace.id] = workspaceState;
      results.push({
        workspaceId: workspace.id,
        tenantId: workspace?.metadata?.tenantId || null,
        healthy: true,
        action: 'skipped',
        reason: 'workspace_not_running'
      });
      continue;
    }

    try {
      const health = await evaluateWorkspaceHealth(config, workspace, policy);
      if (health.healthy) {
        workspaceState.lastHealthyAt = nowIso();
        workspaceState.lastIssue = null;
        state.workspaces[workspace.id] = workspaceState;
        results.push({
          workspaceId: workspace.id,
          tenantId: workspace?.metadata?.tenantId || null,
          healthy: true,
          action: 'none',
          reason: health.reason,
          checks: health.checks || null
        });
        continue;
      }

      workspaceState.lastUnhealthyAt = nowIso();
      workspaceState.lastIssue = health.reason;

      const cooldownRemainingMs = getCooldownRemainingMs(state, workspace.id, policy.restartCooldownMs, startedAtMs);
      if (cooldownRemainingMs > 0) {
        state.workspaces[workspace.id] = workspaceState;
        results.push({
          workspaceId: workspace.id,
          tenantId: workspace?.metadata?.tenantId || null,
          healthy: false,
          action: 'skipped',
          reason: 'cooldown_active',
          cooldownRemainingMs,
          checks: health.checks || null
        });
        continue;
      }

      if (remediations >= policy.maxRestartsPerRun) {
        state.workspaces[workspace.id] = workspaceState;
        results.push({
          workspaceId: workspace.id,
          tenantId: workspace?.metadata?.tenantId || null,
          healthy: false,
          action: 'skipped',
          reason: 'max_restarts_per_run_reached',
          checks: health.checks || null
        });
        continue;
      }

      await stopWorkspace(config, workspace.id, 'scheduler_remediation_stop');
      await startWorkspace(config, workspace.id, 'scheduler_remediation_restart');
      remediations += 1;
      workspaceState.lastRemediatedAt = nowIso();
      workspaceState.lastIssue = `remediated:${health.reason}`;
      state.workspaces[workspace.id] = workspaceState;

      appendAuditEvent(config, {
        action: 'workspace.remediate',
        workspaceId: workspace.id,
        tenantId: workspace?.metadata?.tenantId,
        actorType: 'system',
        actorId: 'workspace-scheduler',
        detail: {
          trigger,
          reason: health.reason,
          checks: health.checks || null
        }
      });

      results.push({
        workspaceId: workspace.id,
        tenantId: workspace?.metadata?.tenantId || null,
        healthy: false,
        action: 'restart',
        reason: health.reason,
        checks: health.checks || null
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      workspaceState.lastIssue = detail;
      state.workspaces[workspace.id] = workspaceState;
      results.push({
        workspaceId: workspace.id,
        tenantId: workspace?.metadata?.tenantId || null,
        healthy: false,
        action: 'error',
        reason: detail
      });
    }
  }

  const completedAt = nowIso();

  if (policy.cleanupExpiredSessions) {
    maintenance.sessionCleanup = cleanupExpiredSessions(config, {
      actorId: `scheduler-${trigger}`
    });
    sessionCleanupRemoved = toInteger(maintenance.sessionCleanup?.removed, 0, 0);
    state.totalSessionCleanups = previousTotals.totalSessionCleanups + sessionCleanupRemoved;
  }

  const shouldRunRetentionCleanup = policy.retentionCleanupEnabled
    && (currentRunNumber % policy.retentionCleanupEveryRuns === 0 || trigger === 'manual' || trigger === 'cli_manual' || trigger === 'admin_api');
  if (shouldRunRetentionCleanup) {
    maintenance.retentionCleanup = runSnapshotRetentionCleanup(config, null, {
      actorId: `scheduler-${trigger}`
    });
    retentionCleanupRemoved = maintenance.retentionCleanup.results
      .reduce((count, item) => count + toInteger(item?.removedCount ?? item?.removedSnapshotCount, 0, 0), 0);
    state.totalRetentionCleanups = previousTotals.totalRetentionCleanups + retentionCleanupRemoved;
  }

  const summary = {
    trigger,
    workspaceCount: workspaces.length,
    remediations,
    healthyCount: results.filter(item => item.healthy).length,
    unhealthyCount: results.filter(item => !item.healthy).length,
    maintenance,
    completedAt
  };

  state.lastRunAt = startedAt;
  state.lastCompletedAt = completedAt;
  state.lastRunSummary = summary;
  state.totalRuns = currentRunNumber;
  state.totalRemediations = previousTotals.totalRemediations + remediations;
  if (!policy.cleanupExpiredSessions) {
    state.totalSessionCleanups = previousTotals.totalSessionCleanups;
  }
  if (!shouldRunRetentionCleanup) {
    state.totalRetentionCleanups = previousTotals.totalRetentionCleanups;
  }

  const runEntry = {
    runNumber: currentRunNumber,
    trigger,
    startedAt,
    completedAt,
    summary,
    delta: {
      remediations,
      sessionCleanups: sessionCleanupRemoved,
      retentionCleanups: retentionCleanupRemoved
    },
    totals: {
      totalRuns: state.totalRuns,
      totalRemediations: state.totalRemediations,
      totalSessionCleanups: state.totalSessionCleanups,
      totalRetentionCleanups: state.totalRetentionCleanups
    }
  };

  const history = Array.isArray(state.history) ? state.history : [];
  history.push(runEntry);
  if (history.length > policy.historyMaxEntries) {
    state.history = history.slice(history.length - policy.historyMaxEntries);
  } else {
    state.history = history;
  }
  state.lastError = null;
  saveWorkspaceSchedulerState(config, state);

  return {
    policy,
    summary,
    maintenance,
    results
  };
}

export function createWorkspaceSchedulerController(config) {
  let timer = null;
  let started = false;
  let inFlight = false;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function applyPolicyTimer() {
    stopTimer();
    const policy = loadWorkspaceSchedulerPolicy(config);
    if (!started || !policy.enabled) {
      return;
    }

    timer = setInterval(() => {
      void runNow({ trigger: 'interval' });
    }, policy.intervalMs);
  }

  function writeControllerRunning(nextRunning) {
    const state = loadWorkspaceSchedulerState(config);
    state.running = nextRunning;
    if (nextRunning) {
      state.lastStartedAt = nowIso();
      state.lastError = null;
    } else {
      state.lastStoppedAt = nowIso();
    }
    saveWorkspaceSchedulerState(config, state);
  }

  async function runNow(options = {}) {
    if (inFlight) {
      return {
        ok: false,
        skipped: true,
        reason: 'scheduler_run_in_flight',
        ...getWorkspaceSchedulerSnapshot(config)
      };
    }

    inFlight = true;
    try {
      const result = await runWorkspaceHealthSweep(config, options);
      return {
        ok: true,
        ...result,
        ...getWorkspaceSchedulerSnapshot(config)
      };
    } catch (error) {
      const state = loadWorkspaceSchedulerState(config);
      state.lastError = error instanceof Error ? error.message : String(error);
      saveWorkspaceSchedulerState(config, state);
      throw error;
    } finally {
      inFlight = false;
    }
  }

  function getStatus() {
    return {
      ...getWorkspaceSchedulerSnapshot(config),
      controller: {
        started,
        inFlight,
        timerActive: Boolean(timer)
      }
    };
  }

  function getHistory(options = {}) {
    return getWorkspaceSchedulerHistory(config, options);
  }

  function getTrends(options = {}) {
    return getWorkspaceSchedulerTrends(config, options);
  }

  function getTrendsCompact(options = {}) {
    return getWorkspaceSchedulerTrendsCompact(config, options);
  }

  function start() {
    if (started) {
      return getStatus();
    }

    started = true;
    writeControllerRunning(true);
    applyPolicyTimer();
    return getStatus();
  }

  function stop() {
    if (!started) {
      return getStatus();
    }

    started = false;
    stopTimer();
    writeControllerRunning(false);
    return getStatus();
  }

  function updatePolicy(updates = {}) {
    const policy = updateWorkspaceSchedulerPolicy(config, updates);
    applyPolicyTimer();
    return {
      policy,
      ...getStatus()
    };
  }

  return {
    getStatus,
    getHistory,
    getTrends,
    getTrendsCompact,
    start,
    stop,
    runNow,
    updatePolicy
  };
}
