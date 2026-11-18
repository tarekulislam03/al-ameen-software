const { google } = require('googleapis');
const crypto = require('crypto');

const CUSTOMERS_TAB = 'Customers';
const PAYMENTS_TAB = 'Payments';

const CUSTOMER_HEADERS = [
  'ID',
  'name',
  'phone',
  'address',
  'DOB',
  'category',
  'enrollment date',
  'total fee',
  'notes',
  'document status',
  'created at',
];

const PAYMENT_HEADERS = [
  'payment ID',
  'customer ID',
  'date',
  'amount',
  'mode',
  'note',
];

// In-memory cache
let cache = {
  customers: [],
  payments: [],
  initialized: false,
  lastSyncedAt: null,
  syncSource: 'memory', // 'google_sheets' | 'memory'
  sheetIds: {
    [CUSTOMERS_TAB]: null,
    [PAYMENTS_TAB]: null,
  },
};

// Mock / fallback rows when Google Sheets credentials are not configured (or injected in tests)
let customSheetsClient = null;

function setSheetsClientForTesting(client) {
  customSheetsClient = client;
}

function getAppsScriptUrl() {
  return (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim();
}

function getSpreadsheetId() {
  return (
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    process.env.SPREADSHEET_ID ||
    process.env.GOOGLE_SPREADSHEET_ID ||
    ''
  ).trim();
}

function getCredentialsFromEnv() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch (err) {
      console.warn('Invalid GOOGLE_SERVICE_ACCOUNT_JSON:', err.message);
    }
  }

  const email = (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    ''
  ).trim();
  const rawKey =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    '';
  const privateKey = rawKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();

  if (email && privateKey && !email.includes('your-service-account')) {
    return {
      client_email: email,
      private_key: privateKey,
    };
  }
  return null;
}

function isAppsScriptConfigured() {
  const url = getAppsScriptUrl();
  return Boolean(url && url.startsWith('http') && !url.includes('YOUR_SCRIPT_ID'));
}

function isSheetsConfigured() {
  if (customSheetsClient) return true;
  if (isAppsScriptConfigured()) return true;
  const spreadsheetId = getSpreadsheetId();
  const creds = getCredentialsFromEnv();
  return Boolean(
    spreadsheetId &&
      spreadsheetId !== 'your_spreadsheet_id_here' &&
      creds &&
      creds.client_email &&
      creds.private_key
  );
}

async function callAppsScript(action, payload = {}) {
  const url = getAppsScriptUrl();
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow',
    });
    if (res.status === 429 || res.status === 503) {
      const err = new Error(`Rate limit (${res.status})`);
      err.code = res.status;
      throw err;
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const err = new Error(
        `Apps Script returned HTML instead of JSON (HTTP ${res.status}). ` +
          'Check GOOGLE_APPS_SCRIPT_URL: it must be the Web app URL ending in /exec, ' +
          'deployed with "Execute as: Me" and "Who has access: Anyone". ' +
          'After editing the script, create a NEW deployment version.'
      );
      err.code = 'BAD_APPS_SCRIPT_RESPONSE';
      throw err;
    }
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data;
  });
}

let cachedSheetsApi = null;

function getSheetsClient() {
  if (customSheetsClient) return customSheetsClient;
  if (cachedSheetsApi) return cachedSheetsApi;

  const creds = getCredentialsFromEnv();
  if (!creds) {
    throw new Error(
      'Google Sheets service account credentials are not configured in environment variables.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedSheetsApi = google.sheets({ version: 'v4', auth });
  return cachedSheetsApi;
}

/**
 * Exponential backoff retry wrapper for Google Sheets API rate limits (429, 503, quotaExceeded)
 */
async function withRetry(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const status =
        error?.code ||
        error?.status ||
        error?.response?.status ||
        error?.response?.data?.error?.code;
      const reason =
        error?.errors?.[0]?.reason ||
        error?.response?.data?.error?.errors?.[0]?.reason ||
        '';
      const message = String(error?.message || '').toLowerCase();

      const isRateLimit =
        status === 429 ||
        status === 503 ||
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded' ||
        reason === 'quotaExceeded' ||
        message.includes('rate limit') ||
        message.includes('quota exceeded') ||
        message.includes('too many requests');

      if (!isRateLimit || attempt > maxRetries) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 150);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function generateId(prefix) {
  const randomPart = crypto.randomUUID().split('-')[0].toUpperCase();
  const timePart = Date.now().toString(36).toUpperCase().slice(-4);
  return `${prefix}-${timePart}${randomPart}`;
}

function rowToCustomer(row) {
  return {
    id: String(row[0] ?? '').trim(),
    name: String(row[1] ?? '').trim(),
    phone: String(row[2] ?? '').trim(),
    address: String(row[3] ?? '').trim(),
    dob: String(row[4] ?? '').trim(),
    category: String(row[5] ?? '').trim(),
    enrollmentDate: String(row[6] ?? '').trim(),
    totalFee: Number(row[7] ?? 0) || 0,
    notes: String(row[8] ?? '').trim(),
    documentStatus: String(row[9] ?? 'Pending').trim() || 'Pending',
    createdAt: String(row[10] ?? '').trim(),
  };
}

function customerToRow(customer) {
  return [
    customer.id,
    customer.name || '',
    customer.phone || '',
    customer.address || '',
    customer.dob || '',
    customer.category || '',
    customer.enrollmentDate || '',
    Number(customer.totalFee ?? 0) || 0,
    customer.notes || '',
    customer.documentStatus || 'Pending',
    customer.createdAt || new Date().toISOString(),
  ];
}

function rowToPayment(row) {
  return {
    paymentId: String(row[0] ?? '').trim(),
    customerId: String(row[1] ?? '').trim(),
    date: String(row[2] ?? '').trim(),
    amount: Number(row[3] ?? 0) || 0,
    mode: String(row[4] ?? 'Cash').trim() || 'Cash',
    note: String(row[5] ?? '').trim(),
  };
}

function paymentToRow(payment) {
  return [
    payment.paymentId,
    payment.customerId,
    payment.date || new Date().toISOString().slice(0, 10),
    Number(payment.amount ?? 0) || 0,
    payment.mode || 'Cash',
    payment.note || '',
  ];
}

/**
 * Ensures both 'Customers' and 'Payments' tabs exist with headers.
 */
async function ensureSheetsAndHeaders() {
  if (!isSheetsConfigured()) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';

  const metaResp = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId })
  );

  const existingSheets = metaResp?.data?.sheets || [];
  const requests = [];

  for (const sheet of existingSheets) {
    const title = sheet?.properties?.title;
    const sheetId = sheet?.properties?.sheetId;
    if (title === CUSTOMERS_TAB || title === PAYMENTS_TAB) {
      cache.sheetIds[title] = sheetId;
    }
  }

  if (cache.sheetIds[CUSTOMERS_TAB] === null || cache.sheetIds[CUSTOMERS_TAB] === undefined) {
    requests.push({
      addSheet: {
        properties: { title: CUSTOMERS_TAB },
      },
    });
  }

  if (cache.sheetIds[PAYMENTS_TAB] === null || cache.sheetIds[PAYMENTS_TAB] === undefined) {
    requests.push({
      addSheet: {
        properties: { title: PAYMENTS_TAB },
      },
    });
  }

  if (requests.length > 0) {
    const batchResp = await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      })
    );
    const replies = batchResp?.data?.replies || [];
    for (const reply of replies) {
      const props = reply?.addSheet?.properties;
      if (props?.title) {
        cache.sheetIds[props.title] = props.sheetId;
      }
    }
  }
}

/**
 * Replace the in-memory cache with the full sheet snapshot returned by Apps Script.
 */
function applyAppsScriptData(data) {
  const customerRows = data.customers || [];
  const paymentRows = data.payments || [];

  const cStart =
    customerRows.length > 0 &&
    String(customerRows[0][0] || '').trim().toLowerCase() === 'id'
      ? 1
      : 0;
  const pStart =
    paymentRows.length > 0 &&
    String(paymentRows[0][0] || '').trim().toLowerCase() === 'payment id'
      ? 1
      : 0;

  cache.customers = customerRows
    .slice(cStart)
    .filter((r) => r && String(r[0] ?? '').trim())
    .map(rowToCustomer);
  cache.payments = paymentRows
    .slice(pStart)
    .filter((r) => r && String(r[0] ?? '').trim())
    .map(rowToPayment);
  cache.initialized = true;
  cache.lastSyncedAt = new Date().toISOString();
  cache.syncSource = 'apps_script';
}

/**
 * Apps Script write actions return the fresh sheet snapshot, so one round trip
 * both writes and refreshes the cache. Falls back to a full re-read if the
 * deployed script is an older version that doesn't return the snapshot.
 */
async function refreshAfterAppsScriptWrite(result) {
  if (result && Array.isArray(result.customers) && Array.isArray(result.payments)) {
    applyAppsScriptData(result);
  } else {
    await refreshCache();
  }
}

/**
 * Refreshes the server memory cache directly from Google Sheets API v4.
 * Called on startup and after every write operation.
 */
async function refreshCache() {
  if (!isSheetsConfigured()) {
    if (!cache.initialized) {
      seedInitialMemoryData();
      cache.initialized = true;
    }
    cache.lastSyncedAt = new Date().toISOString();
    cache.syncSource = 'memory';
    return cache;
  }

  if (isAppsScriptConfigured()) {
    applyAppsScriptData(await callAppsScript('getAll'));
    return cache;
  }

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';

  await ensureSheetsAndHeaders();

  const batchRes = await withRetry(() =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [`${CUSTOMERS_TAB}!A1:K`, `${PAYMENTS_TAB}!A1:F`],
    })
  );

  const valueRanges = batchRes?.data?.valueRanges || [];
  const customerRows = valueRanges[0]?.values || [];
  const paymentRows = valueRanges[1]?.values || [];

  // Initialize headers if sheet is empty
  if (customerRows.length === 0) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${CUSTOMERS_TAB}!A1:K1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [CUSTOMER_HEADERS] },
      })
    );
  }

  if (paymentRows.length === 0) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${PAYMENTS_TAB}!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [PAYMENT_HEADERS] },
      })
    );
  }

  // Skip header row if row[0] matches header name "ID" / "payment ID"
  const cStartIndex =
    customerRows.length > 0 &&
    String(customerRows[0][0] || '').trim().toLowerCase() === 'id'
      ? 1
      : 0;

  const pStartIndex =
    paymentRows.length > 0 &&
    String(paymentRows[0][0] || '').trim().toLowerCase() === 'payment id'
      ? 1
      : 0;

  const customers = [];
  for (let i = cStartIndex; i < customerRows.length; i++) {
    const row = customerRows[i];
    if (!row || !String(row[0] ?? '').trim()) continue;
    customers.push(rowToCustomer(row));
  }

  const payments = [];
  for (let i = pStartIndex; i < paymentRows.length; i++) {
    const row = paymentRows[i];
    if (!row || !String(row[0] ?? '').trim()) continue;
    payments.push(rowToPayment(row));
  }

  cache.customers = customers;
  cache.payments = payments;
  cache.initialized = true;
  cache.lastSyncedAt = new Date().toISOString();
  cache.syncSource = 'google_sheets';

  return cache;
}

function seedInitialMemoryData() {
  const now = new Date().toISOString();
  cache.customers = [
    {
      id: 'CUST-1001A',
      name: 'Mohammed Tariq',
      phone: '+91 98765 43210',
      address: '14 MG Road, Indiranagar',
      dob: '1998-05-14',
      category: 'New DL',
      enrollmentDate: '2026-10-15',
      totalFee: 6500,
      notes: 'Morning batch 7:00 AM - 8:00 AM. Learner licence approved.',
      documentStatus: 'Verified',
      createdAt: now,
    },
    {
      id: 'CUST-1002B',
      name: 'Ayesha Siddiqui',
      phone: '+91 98450 11223',
      address: '22 Park Street, Frazer Town',
      dob: '2001-11-02',
      category: 'Training',
      enrollmentDate: '2026-11-01',
      totalFee: 5000,
      notes: 'Needs weekend driving practice slots.',
      documentStatus: 'Submitted',
      createdAt: now,
    },
    {
      id: 'CUST-1003C',
      name: 'Rohan Deshmukh',
      phone: '+91 99001 55667',
      address: '88 Residency Layout, Koramangala',
      dob: '1995-03-21',
      category: 'Renew DL',
      enrollmentDate: '2026-11-10',
      totalFee: 4200,
      notes: 'Awaiting medical certificate upload.',
      documentStatus: 'Pending',
      createdAt: now,
    },
  ];

  cache.payments = [
    {
      paymentId: 'PAY-5001X',
      customerId: 'CUST-1001A',
      date: '2026-10-15',
      amount: 3500,
      mode: 'UPI',
      note: 'Advance installment at enrollment',
    },
    {
      paymentId: 'PAY-5002Y',
      customerId: 'CUST-1001A',
      date: '2026-11-02',
      amount: 3000,
      mode: 'Cash',
      note: 'Final balance cleared before DL test',
    },
    {
      paymentId: 'PAY-5003Z',
      customerId: 'CUST-1002B',
      date: '2026-11-01',
      amount: 2500,
      mode: 'UPI',
      note: 'First installment',
    },
  ];
}

async function ensureInitialized() {
  if (!cache.initialized) {
    await refreshCache();
  }
}

/**
 * Compute payment summary for a customer from cached payments
 */
function enrichCustomerWithPayments(customer) {
  const customerPayments = cache.payments.filter(
    (p) => p.customerId === customer.id
  );
  const paidAmount = customerPayments.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );
  const totalFee = Number(customer.totalFee) || 0;
  const balance = Math.max(0, totalFee - paidAmount);
  const paymentStatus =
    totalFee <= 0
      ? 'Paid'
      : paidAmount >= totalFee
      ? 'Paid'
      : paidAmount > 0
      ? 'Partial'
      : 'Unpaid';

  return {
    ...customer,
    paidAmount,
    balance,
    paymentCount: customerPayments.length,
    paymentStatus,
  };
}

/**
 * Helper to locate the 1-based sheet row index for a given unique ID in a tab
 * (Used internally to update/delete by unique ID, never exposing row numbers in the API)
 */
async function findSheetRowNumberById(tabName, uniqueId) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';

  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A:A`,
    })
  );

  const rows = res?.data?.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? '').trim() === String(uniqueId).trim()) {
      return i + 1; // 1-based row number for Google Sheets A1 notation
    }
  }
  return null;
}

// ==========================================
// CUSTOMERS OPERATIONS
// ==========================================

async function listCustomers() {
  await ensureInitialized();
  return cache.customers.map(enrichCustomerWithPayments);
}

async function getCustomerById(customerId) {
  await ensureInitialized();
  const customer = cache.customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const payments = cache.payments
    .filter((p) => p.customerId === customerId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    ...enrichCustomerWithPayments(customer),
    payments,
  };
}

async function createCustomer(payload) {
  let scriptResult = null;
  await ensureInitialized();

  const newCustomer = {
    id: payload.id ? String(payload.id).trim() : generateId('CUST'),
    name: String(payload.name ?? '').trim(),
    phone: String(payload.phone ?? '').trim(),
    address: String(payload.address ?? '').trim(),
    dob: String(payload.dob ?? '').trim(),
    category: String(payload.category ?? payload.course ?? '').trim(),
    enrollmentDate:
      String(payload.enrollmentDate ?? '').trim() ||
      new Date().toISOString().slice(0, 10),
    totalFee: Number(payload.totalFee ?? 0) || 0,
    notes: String(payload.notes ?? '').trim(),
    documentStatus: String(payload.documentStatus ?? 'Pending').trim() || 'Pending',
    createdAt: payload.createdAt || new Date().toISOString(),
  };

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('createCustomer', { row: customerToRow(newCustomer) });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';

    await withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${CUSTOMERS_TAB}!A:K`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [customerToRow(newCustomer)],
        },
      })
    );
  } else {
    cache.customers.push(newCustomer);
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  return getCustomerById(newCustomer.id);
}

async function updateCustomer(customerId, updates) {
  let scriptResult = null;
  await ensureInitialized();

  const existing = cache.customers.find((c) => c.id === customerId);
  if (!existing) {
    return null;
  }

  const updatedCustomer = {
    ...existing,
    name:
      updates.name !== undefined ? String(updates.name).trim() : existing.name,
    phone:
      updates.phone !== undefined
        ? String(updates.phone).trim()
        : existing.phone,
    address:
      updates.address !== undefined
        ? String(updates.address).trim()
        : existing.address,
    dob: updates.dob !== undefined ? String(updates.dob).trim() : existing.dob,
    category:
      updates.category !== undefined
        ? String(updates.category).trim()
        : updates.course !== undefined
          ? String(updates.course).trim()
          : existing.category,
    enrollmentDate:
      updates.enrollmentDate !== undefined
        ? String(updates.enrollmentDate).trim()
        : existing.enrollmentDate,
    totalFee:
      updates.totalFee !== undefined
        ? Number(updates.totalFee) || 0
        : existing.totalFee,
    notes:
      updates.notes !== undefined
        ? String(updates.notes).trim()
        : existing.notes,
    documentStatus:
      updates.documentStatus !== undefined
        ? String(updates.documentStatus).trim()
        : existing.documentStatus,
    id: existing.id, // ID is immutable
    createdAt: existing.createdAt,
  };

  const alreadyPaid = paidFor(customerId, null);
  if (updatedCustomer.totalFee < alreadyPaid) {
    throw httpError(
      400,
      `Total fee cannot be less than the amount already paid (${alreadyPaid}). Edit or delete payments first.`
    );
  }

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('updateCustomer', {
      id: customerId,
      row: customerToRow(updatedCustomer),
    });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';
    const rowNumber = await findSheetRowNumberById(CUSTOMERS_TAB, customerId);

    if (!rowNumber) {
      return null;
    }

    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${CUSTOMERS_TAB}!A${rowNumber}:K${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [customerToRow(updatedCustomer)],
        },
      })
    );
  } else {
    const idx = cache.customers.findIndex((c) => c.id === customerId);
    if (idx !== -1) {
      cache.customers[idx] = updatedCustomer;
    }
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  return getCustomerById(customerId);
}

async function deleteCustomer(customerId) {
  let scriptResult = null;
  await ensureInitialized();

  const existing = cache.customers.find((c) => c.id === customerId);
  if (!existing) {
    return false;
  }

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('deleteCustomer', { id: customerId });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';
    const rowNumber = await findSheetRowNumberById(CUSTOMERS_TAB, customerId);

    if (!rowNumber) {
      return false;
    }

    const customerSheetId = cache.sheetIds[CUSTOMERS_TAB] ?? 0;

    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: customerSheetId,
                  dimension: 'ROWS',
                  startIndex: rowNumber - 1,
                  endIndex: rowNumber,
                },
              },
            },
          ],
        },
      })
    );

    // Also delete associated payments for this customer if any exist in the Payments tab
    const paymentSheetId = cache.sheetIds[PAYMENTS_TAB] ?? 1;
    const payColRes = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${PAYMENTS_TAB}!A:B`,
      })
    );
    const payRows = payColRes?.data?.values || [];
    const deletePayRequests = [];
    // Traverse bottom-up so row indices don't shift while deleting
    for (let i = payRows.length - 1; i >= 1; i--) {
      if (String(payRows[i]?.[1] ?? '').trim() === String(customerId).trim()) {
        deletePayRequests.push({
          deleteDimension: {
            range: {
              sheetId: paymentSheetId,
              dimension: 'ROWS',
              startIndex: i,
              endIndex: i + 1,
            },
          },
        });
      }
    }
    if (deletePayRequests.length > 0) {
      await withRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: deletePayRequests },
        })
      );
    }
  } else {
    cache.customers = cache.customers.filter((c) => c.id !== customerId);
    cache.payments = cache.payments.filter((p) => p.customerId !== customerId);
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  if (isAppsScriptConfigured() && cache.customers.some((c) => c.id === customerId)) {
    throw new Error(
      'Customer was not deleted from Google Sheets. Check that Row 1 of the Customers sheet is a header row (starting with "ID"), not a customer record.'
    );
  }
  return true;
}

// ==========================================
// PAYMENTS OPERATIONS
// ==========================================

async function listPaymentsByCustomer(customerId) {
  await ensureInitialized();
  return cache.payments
    .filter((p) => p.customerId === customerId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function listAllPayments() {
  await ensureInitialized();
  return cache.payments
    .map((p) => {
      const customer = cache.customers.find((c) => c.id === p.customerId);
      return {
        ...p,
        customerName: customer ? customer.name : 'Unknown Customer',
        customerPhone: customer ? customer.phone : '',
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function paidFor(customerId, excludePaymentId) {
  return round2(
    cache.payments
      .filter((p) => p.customerId === customerId && p.paymentId !== excludePaymentId)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  );
}

/** Validates fields and that the customer's total paid never exceeds the total fee. */
function validatePayment(customer, fields, excludePaymentId) {
  const amount = round2(fields.amount);
  if (!(amount > 0)) throw httpError(400, 'Payment amount must be greater than zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
    throw httpError(400, 'Payment date must be in YYYY-MM-DD format');
  }
  const othersPaid = paidFor(customer.id, excludePaymentId);
  const maxAllowed = round2(Math.max(0, Number(customer.totalFee) - othersPaid));
  if (amount > maxAllowed) {
    throw httpError(
      400,
      maxAllowed === 0
        ? `${customer.name} has no balance due. Total fee is already fully paid.`
        : `Amount exceeds the balance due. Maximum allowed is ${maxAllowed}.`
    );
  }
  return amount;
}

async function createPayment(payload) {
  let scriptResult = null;
  await ensureInitialized();

  const customer = cache.customers.find((c) => c.id === payload.customerId);
  if (!customer) {
    throw httpError(404, `Customer with ID ${payload.customerId} not found`);
  }

  const newPayment = {
    paymentId: generateId('PAY'),
    customerId: String(payload.customerId).trim(),
    date:
      String(payload.date ?? '').trim() ||
      new Date().toISOString().slice(0, 10),
    amount: Number(payload.amount ?? 0) || 0,
    mode: String(payload.mode ?? 'Cash').trim() || 'Cash',
    note: String(payload.note ?? '').trim(),
  };
  newPayment.amount = validatePayment(customer, newPayment, null);

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('createPayment', { row: paymentToRow(newPayment) });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';

    await withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${PAYMENTS_TAB}!A:F`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [paymentToRow(newPayment)],
        },
      })
    );
  } else {
    cache.payments.push(newPayment);
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  return newPayment;
}

async function updatePayment(paymentId, updates) {
  let scriptResult = null;
  await ensureInitialized();

  const existing = cache.payments.find((p) => p.paymentId === paymentId);
  if (!existing) return null;
  const customer = cache.customers.find((c) => c.id === existing.customerId);
  if (!customer) throw httpError(404, `Customer with ID ${existing.customerId} not found`);

  const updated = {
    ...existing,
    date: updates.date !== undefined ? String(updates.date).trim() : existing.date,
    amount: updates.amount !== undefined ? Number(updates.amount) || 0 : existing.amount,
    mode: updates.mode !== undefined ? String(updates.mode).trim() || existing.mode : existing.mode,
    note: updates.note !== undefined ? String(updates.note).trim() : existing.note,
    paymentId: existing.paymentId, // IDs are immutable
    customerId: existing.customerId,
  };
  updated.amount = validatePayment(customer, updated, paymentId);

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('updatePayment', { id: paymentId, row: paymentToRow(updated) });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';
    const rowNumber = await findSheetRowNumberById(PAYMENTS_TAB, paymentId);
    if (!rowNumber) return null;
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${PAYMENTS_TAB}!A${rowNumber}:F${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [paymentToRow(updated)] },
      })
    );
  } else {
    const idx = cache.payments.findIndex((p) => p.paymentId === paymentId);
    cache.payments[idx] = updated;
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  return cache.payments.find((p) => p.paymentId === paymentId) || updated;
}

async function deletePayment(paymentId) {
  let scriptResult = null;
  await ensureInitialized();

  const existing = cache.payments.find((p) => p.paymentId === paymentId);
  if (!existing) return null;

  if (isAppsScriptConfigured()) {
    scriptResult = await callAppsScript('deletePayment', { id: paymentId });
  } else if (isSheetsConfigured()) {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId() || 'test-spreadsheet-id';
    const rowNumber = await findSheetRowNumberById(PAYMENTS_TAB, paymentId);
    if (!rowNumber) return null;
    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: cache.sheetIds[PAYMENTS_TAB] ?? 1,
                  dimension: 'ROWS',
                  startIndex: rowNumber - 1,
                  endIndex: rowNumber,
                },
              },
            },
          ],
        },
      })
    );
  } else {
    cache.payments = cache.payments.filter((p) => p.paymentId !== paymentId);
  }

  await refreshAfterAppsScriptWrite(scriptResult);
  return existing;
}

function getCacheStatus() {
  return {
    initialized: cache.initialized,
    lastSyncedAt: cache.lastSyncedAt,
    syncSource: cache.syncSource,
    sheetsConfigured: isSheetsConfigured(),
    customerCount: cache.customers.length,
    paymentCount: cache.payments.length,
  };
}

module.exports = {
  CUSTOMERS_TAB,
  PAYMENTS_TAB,
  CUSTOMER_HEADERS,
  PAYMENT_HEADERS,
  withRetry,
  refreshCache,
  getCacheStatus,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listPaymentsByCustomer,
  listAllPayments,
  createPayment,
  updatePayment,
  deletePayment,
  setSheetsClientForTesting,
};
