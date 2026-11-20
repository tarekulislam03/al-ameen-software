const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LOG_FILE = path.join(__dirname, 'data', 'activity-log.json');
const MAX_LOGS = 5000;

let logFilePath = DEFAULT_LOG_FILE;
let logsCache = null;

const CUSTOMER_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'dob', label: 'DOB' },
  { key: 'category', label: 'Category' },
  { key: 'enrollmentDate', label: 'Enrollment Date' },
  { key: 'totalFee', label: 'Total Fee' },
  { key: 'notes', label: 'Notes' },
  { key: 'documentStatus', label: 'Document Status' },
];

const PAYMENT_FIELDS = [
  { key: 'date', label: 'Date' },
  { key: 'amount', label: 'Amount' },
  { key: 'mode', label: 'Mode' },
  { key: 'note', label: 'Note' },
];

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setLogFileForTesting(customPath) {
  logFilePath = customPath;
  logsCache = null;
}

function clearLogsForTesting() {
  logsCache = [];
  if (logFilePath) {
    try {
      if (fs.existsSync(logFilePath)) fs.unlinkSync(logFilePath);
    } catch {
      // ignore
    }
  }
}

function loadLogs() {
  if (logsCache !== null) return logsCache;
  if (!logFilePath) {
    logsCache = [];
    return logsCache;
  }
  try {
    if (fs.existsSync(logFilePath)) {
      const raw = fs.readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      logsCache = Array.isArray(parsed) ? parsed : [];
    } else {
      logsCache = [];
    }
  } catch (err) {
    console.warn('[ActivityLog] Failed to load log file:', err.message);
    logsCache = [];
  }
  return logsCache;
}

function saveLogs(logs) {
  logsCache = logs;
  if (!logFilePath) return;
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.warn('[ActivityLog] Failed to save log file:', err.message);
  }
}

function diffFields(before, after, fieldSpecs) {
  if (!before || !after) return [];
  const changes = [];
  for (const { key, label } of fieldSpecs) {
    const prev = before[key] ?? '';
    const next = after[key] ?? '';
    if (String(prev) !== String(next)) {
      changes.push({
        field: key,
        label,
        from: prev,
        to: next,
      });
    }
  }
  return changes;
}

function recordActivity({
  user,
  action,
  entityType,
  entityId,
  customerId,
  customerName,
  summary,
  changes = [],
  amount = null,
  mode = null,
}) {
  const now = new Date();
  const entry = {
    id: `LOG-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    timestamp: now.toISOString(),
    date: localDateString(now),
    actor: {
      id: user?.id || null,
      username: user?.username || user?.sub || 'unknown',
      name: user?.name || user?.username || user?.sub || 'Unknown',
      role: user?.role || 'staff',
      counter: user?.counter ?? null,
    },
    action,
    entityType,
    entityId: String(entityId || ''),
    customerId: String(customerId || ''),
    customerName: String(customerName || ''),
    summary: String(summary || ''),
    changes: Array.isArray(changes) ? changes : [],
    amount: amount !== null && amount !== undefined ? Number(amount) : null,
    mode: mode ? String(mode) : null,
  };

  const logs = loadLogs();
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) {
    logs.length = MAX_LOGS;
  }
  saveLogs(logs);
  return entry;
}

function toIsoFromDate(dateStr, fallbackIso) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return `${dateStr}T12:00:00.000Z`;
  }
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallbackIso || new Date().toISOString();
}

/**
 * Idempotently backfill CREATE logs for existing Customers & Payments from Google Sheets
 * so historical Counter 1 records appear in the Admin Counter Dashboard.
 */
function backfillFromSheets({ customers = [], payments = [], actor }) {
  if (!actor || (!customers.length && !payments.length)) return 0;

  const logs = loadLogs();
  const existingCustomerIds = new Set(
    logs.filter((l) => l.entityType === 'customer' && l.action === 'CREATE').map((l) => l.entityId)
  );
  const existingPaymentIds = new Set(
    logs.filter((l) => l.entityType === 'payment' && l.action === 'CREATE').map((l) => l.entityId)
  );

  const customerNameById = new Map();
  for (const c of customers) {
    customerNameById.set(c.id, c.name || c.id);
  }

  let added = 0;
  const actorObj = {
    id: actor.id || 'staff1',
    username: actor.username,
    name: actor.name || actor.counter || actor.username,
    role: actor.role || 'staff',
    counter: actor.counter ?? 'Counter 1',
  };

  for (const c of customers) {
    if (!c.id || existingCustomerIds.has(c.id)) continue;
    const timestamp = toIsoFromDate(c.createdAt || c.enrollmentDate);
    const date =
      c.enrollmentDate && /^\d{4}-\d{2}-\d{2}$/.test(c.enrollmentDate)
        ? c.enrollmentDate
        : timestamp.slice(0, 10);
    logs.push({
      id: `LOG-HIST-${c.id}`,
      timestamp,
      date,
      actor: actorObj,
      action: 'CREATE',
      entityType: 'customer',
      entityId: c.id,
      customerId: c.id,
      customerName: c.name || '',
      summary: `Created customer "${c.name}" (${c.category || 'No category'}, Fee ₹${c.totalFee || 0})`,
      changes: [],
      amount: null,
      mode: null,
    });
    added += 1;
  }

  for (const p of payments) {
    if (!p.paymentId || existingPaymentIds.has(p.paymentId)) continue;
    const customerName = customerNameById.get(p.customerId) || p.customerName || p.customerId;
    const timestamp = toIsoFromDate(p.date);
    const date =
      p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : timestamp.slice(0, 10);
    logs.push({
      id: `LOG-HIST-${p.paymentId}`,
      timestamp,
      date,
      actor: actorObj,
      action: 'CREATE',
      entityType: 'payment',
      entityId: p.paymentId,
      customerId: p.customerId,
      customerName,
      summary: `Recorded payment ₹${p.amount} (${p.mode || 'Cash'}) for "${customerName}"`,
      changes: [],
      amount: Number(p.amount) || 0,
      mode: p.mode || 'Cash',
    });
    added += 1;
  }

  if (added > 0) {
    logs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }
    saveLogs(logs);
  }
  return added;
}

function emptyStats() {
  return {
    customersCreated: 0,
    customersUpdated: 0,
    customersDeleted: 0,
    paymentsCreated: 0,
    paymentsUpdated: 0,
    paymentsDeleted: 0,
    paymentCollectedAmount: 0,
    paymentModeBreakdown: {},
    totalActions: 0,
  };
}

function applyEntryToStats(stats, entry) {
  stats.totalActions += 1;
  if (entry.entityType === 'customer') {
    if (entry.action === 'CREATE') stats.customersCreated += 1;
    else if (entry.action === 'UPDATE') stats.customersUpdated += 1;
    else if (entry.action === 'DELETE') stats.customersDeleted += 1;
  } else if (entry.entityType === 'payment') {
    if (entry.action === 'CREATE') {
      stats.paymentsCreated += 1;
      const amt = Number(entry.amount) || 0;
      stats.paymentCollectedAmount += amt;
      const mode = entry.mode || 'Other';
      stats.paymentModeBreakdown[mode] = (stats.paymentModeBreakdown[mode] || 0) + amt;
    } else if (entry.action === 'UPDATE') {
      stats.paymentsUpdated += 1;
    } else if (entry.action === 'DELETE') {
      stats.paymentsDeleted += 1;
    }
  }
}

function getDashboard({
  accounts = [],
  from = '',
  to = '',
  actor = '',
  entityType = '',
  action = '',
  search = '',
  limit = 200,
} = {}) {
  const logs = loadLogs();
  const today = localDateString();

  // Build lookup maps so renamed staff/counters keep all their historical logs unified
  const accountById = new Map();
  const accountByUsername = new Map();
  const counterMap = new Map();
  for (const acc of accounts) {
    const key = acc.id || acc.username;
    if (acc.id) accountById.set(acc.id, acc);
    accountByUsername.set(acc.username, acc);
    counterMap.set(key, {
      id: acc.id,
      username: acc.username,
      name: acc.name,
      role: acc.role,
      counter: acc.counter,
      todayStats: emptyStats(),
      periodStats: emptyStats(),
      lastActivityAt: null,
      lastSummary: null,
    });
  }

  const resolveActor = (entry) => {
    const rawActor = entry.actor || {};
    let matched =
      (rawActor.id && accountById.get(rawActor.id)) ||
      (rawActor.username && accountByUsername.get(rawActor.username)) ||
      null;
    if (!matched && String(entry.id || '').startsWith('LOG-HIST-')) {
      matched = accountById.get('staff1') || accounts.find((a) => a.role === 'staff') || null;
    }
    if (matched) {
      return {
        id: matched.id || rawActor.id || null,
        username: matched.username,
        name: matched.name,
        role: matched.role,
        counter: matched.counter,
      };
    }
    return rawActor;
  };

  const inPeriod = (entryDate) => {
    if (from && entryDate < from) return false;
    if (to && entryDate > to) return false;
    return true;
  };

  const resolvedLogs = logs.map((entry) => {
    const resolvedActor = resolveActor(entry);
    const key = resolvedActor.id || resolvedActor.username || 'unknown';
    if (!counterMap.has(key)) {
      counterMap.set(key, {
        id: resolvedActor.id || undefined,
        username: resolvedActor.username || 'unknown',
        name: resolvedActor.name || resolvedActor.username || 'Unknown',
        role: resolvedActor.role || 'staff',
        counter: resolvedActor.counter ?? null,
        todayStats: emptyStats(),
        periodStats: emptyStats(),
        lastActivityAt: null,
        lastSummary: null,
      });
    }
    const bucket = counterMap.get(key);
    if (!bucket.lastActivityAt) {
      bucket.lastActivityAt = entry.timestamp;
      bucket.lastSummary = entry.summary;
    }
    if (entry.date === today) {
      applyEntryToStats(bucket.todayStats, entry);
    }
    if (inPeriod(entry.date)) {
      applyEntryToStats(bucket.periodStats, entry);
    }
    return { ...entry, actor: resolvedActor };
  });

  const q = String(search || '').trim().toLowerCase();
  const filteredLogs = resolvedLogs.filter((entry) => {
    if (!inPeriod(entry.date)) return false;
    if (actor && actor !== 'All' && entry.actor?.username !== actor) return false;
    if (entityType && entityType !== 'All' && entry.entityType !== entityType) return false;
    if (action && action !== 'All' && entry.action !== action) return false;
    if (q) {
      const hay = [
        entry.customerName,
        entry.customerId,
        entry.entityId,
        entry.summary,
        entry.actor?.name,
        entry.actor?.counter,
        entry.actor?.username,
        ...(entry.changes || []).map((c) => `${c.label} ${c.from} ${c.to}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const maxItems = Math.min(Math.max(Number(limit) || 200, 1), 1000);

  return {
    today,
    counters: Array.from(counterMap.values()),
    totalMatchingLogs: filteredLogs.length,
    logs: filteredLogs.slice(0, maxItems),
  };
}

function getCustomerAttributionMap(accounts = []) {
  const logs = loadLogs();
  const accountById = new Map();
  const accountByUsername = new Map();
  for (const acc of accounts) {
    if (acc.id) accountById.set(acc.id, acc);
    accountByUsername.set(acc.username, acc);
  }
  const fallbackStaff1 =
    accountById.get('staff1') || accounts.find((a) => a.role === 'staff') || null;

  const map = new Map();
  for (const entry of logs) {
    if (entry.entityType !== 'customer' || entry.action !== 'CREATE' || !entry.customerId) {
      continue;
    }
    if (map.has(entry.customerId)) continue;

    const rawActor = entry.actor || {};
    let matched =
      (rawActor.id && accountById.get(rawActor.id)) ||
      (rawActor.username && accountByUsername.get(rawActor.username)) ||
      null;
    if (!matched && String(entry.id || '').startsWith('LOG-HIST-')) {
      matched = fallbackStaff1;
    }

    const resolved = matched || rawActor;
    map.set(entry.customerId, {
      counterId: resolved.id || null,
      counterName: resolved.counter || resolved.name || resolved.username || 'Counter 1',
      staffName: resolved.name || resolved.username || 'Staff',
      staffUsername: resolved.username || '',
    });
  }
  return { map, fallbackStaff1 };
}

module.exports = {
  CUSTOMER_FIELDS,
  PAYMENT_FIELDS,
  diffFields,
  recordActivity,
  backfillFromSheets,
  getDashboard,
  getCustomerAttributionMap,
  setLogFileForTesting,
  clearLogsForTesting,
};
