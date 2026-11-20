const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'owner';
process.env.ADMIN_PASSWORD = 'owner-pass';
process.env.AUTH_USERNAME = 'owner';
process.env.AUTH_PASSWORD = 'owner-pass';
process.env.STAFF1_USERNAME = 'staff1';
process.env.STAFF1_PASSWORD = 'staff1-pass';
process.env.STAFF1_NAME = 'Counter 1';
process.env.STAFF1_COUNTER = 'Counter 1';
process.env.STAFF2_USERNAME = 'staff2';
process.env.STAFF2_PASSWORD = 'staff2-pass';
process.env.STAFF2_NAME = 'Counter 2';
process.env.STAFF2_COUNTER = 'Counter 2';
process.env.GOOGLE_APPS_SCRIPT_URL = ''; // keep tests off the real sheet (dotenv won't override)

const app = require('../server');
const auth = require('../auth');
const sheetsService = require('../sheetsService');
const activityLog = require('../activityLog');
auth.setAccountsFileForTesting(null);
activityLog.setLogFileForTesting(null);

let authToken = null;

// Create an in-memory mock Google Sheets API v4 client to test exact Sheets v4 integration,
// rate limit retry logic, unique IDs, and cache refreshing after every write.
function createMockSheetsClient() {
  const store = {
    Customers: [
      sheetsService.CUSTOMER_HEADERS,
      [
        'CUST-TEST01',
        'Ibrahim Khan',
        '+91 9988776655',
        '10 Residency Rd',
        '1996-08-12',
        'LMV Car + Two Wheeler',
        '2026-11-01',
        5500,
        'Morning slot',
        'Verified',
        '2026-11-01T08:00:00.000Z',
      ],
    ],
    Payments: [
      sheetsService.PAYMENT_HEADERS,
      [
        'PAY-TEST01',
        'CUST-TEST01',
        '2026-11-02',
        2500,
        'UPI',
        'First installment',
      ],
    ],
  };

  let failNextWith429 = 0;

  return {
    store,
    triggerRateLimit(times = 1) {
      failNextWith429 = times;
    },
    spreadsheets: {
      get: async () => {
        if (failNextWith429 > 0) {
          failNextWith429--;
          const err = new Error('Quota exceeded for quota metric');
          err.code = 429;
          throw err;
        }
        return {
          data: {
            sheets: [
              { properties: { title: 'Customers', sheetId: 101 } },
              { properties: { title: 'Payments', sheetId: 102 } },
            ],
          },
        };
      },
      batchUpdate: async ({ requestBody }) => {
        for (const req of requestBody.requests || []) {
          if (req.deleteDimension) {
            const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
            const tab = sheetId === 101 ? 'Customers' : 'Payments';
            store[tab].splice(startIndex, endIndex - startIndex);
          }
        }
        return { data: { replies: [] } };
      },
      values: {
        batchGet: async () => {
          if (failNextWith429 > 0) {
            failNextWith429--;
            const err = new Error('Rate Limit Exceeded');
            err.code = 429;
            throw err;
          }
          return {
            data: {
              valueRanges: [
                { values: store.Customers.map((r) => [...r]) },
                { values: store.Payments.map((r) => [...r]) },
              ],
            },
          };
        },
        get: async ({ range }) => {
          const tab = range.split('!')[0];
          return {
            data: {
              values: store[tab].map((r) => [...r]),
            },
          };
        },
        append: async ({ range, requestBody }) => {
          if (failNextWith429 > 0) {
            failNextWith429--;
            const err = new Error('User rate limit exceeded');
            err.code = 429;
            throw err;
          }
          const tab = range.split('!')[0];
          for (const row of requestBody.values) {
            store[tab].push(row);
          }
          return { data: {} };
        },
        update: async ({ range, requestBody }) => {
          const [tab, cellRange] = range.split('!');
          const match = cellRange.match(/[A-Z]+(\d+)/);
          const rowIndex = match ? parseInt(match[1], 10) - 1 : 0;
          store[tab][rowIndex] = requestBody.values[0];
          return { data: {} };
        },
      },
    },
  };
}

function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        } catch (err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('Google Sheets Service & REST API Endpoints (Customers & Payments)', async (t) => {
  const mockClient = createMockSheetsClient();
  sheetsService.setSheetsClientForTesting(mockClient);
  await sheetsService.refreshCache();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  t.after(() => {
    server.close();
  });

  await t.test('auth: rejects no token and bad login, accepts good login', async () => {
    const noToken = await request(server, 'GET', '/api/customers');
    assert.equal(noToken.status, 401);

    const bad = await request(server, 'POST', '/api/auth/login', {
      username: 'owner',
      password: 'wrong',
    });
    assert.equal(bad.status, 401);

    const good = await request(server, 'POST', '/api/auth/login', {
      username: 'owner',
      password: 'owner-pass',
    });
    assert.equal(good.status, 200);
    authToken = good.body.token;
  });

  await t.test('GET /api/customers lists customers from memory cache with calculated balances', async () => {
    const res = await request(server, 'GET', '/api/customers');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, 'CUST-TEST01');
    assert.equal(res.body[0].paidAmount, 2500);
    assert.equal(res.body[0].balance, 3000);
  });

  let createdCustomerId = null;

  await t.test('POST /api/customers creates customer with unique ID, retries on 429 rate limit, and refreshes cache', async () => {
    mockClient.triggerRateLimit(2); // Simulate two 429 rate limit responses before succeeding

    const res = await request(server, 'POST', '/api/customers', {
      name: 'Zoya Merchant',
      phone: '+91 9123456780',
      address: '45 Brigade Road',
      dob: '2000-02-20',
      category: 'Training',
      enrollmentDate: '2026-11-14',
      totalFee: 6000,
      notes: 'Evening batch',
      documentStatus: 'Submitted',
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.id.startsWith('CUST-'));
    assert.equal(res.body.name, 'Zoya Merchant');
    assert.equal(res.body.balance, 6000);
    createdCustomerId = res.body.id;
  });

  await t.test('GET /api/customers/:id retrieves customer by unique ID', async () => {
    const res = await request(server, 'GET', `/api/customers/${createdCustomerId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdCustomerId);
    assert.equal(res.body.name, 'Zoya Merchant');
  });

  await t.test('PUT /api/customers/:id updates customer by unique ID and refreshes cache', async () => {
    const res = await request(server, 'PUT', `/api/customers/${createdCustomerId}`, {
      documentStatus: 'Verified',
      totalFee: 5800,
      notes: 'Discount applied',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.documentStatus, 'Verified');
    assert.equal(res.body.totalFee, 5800);
  });

  await t.test('POST /api/customers/:id/payments creates payment with unique ID and refreshes customer balance', async () => {
    const res = await request(server, 'POST', `/api/customers/${createdCustomerId}/payments`, {
      date: '2026-11-14',
      amount: 2000,
      mode: 'Cash',
      note: 'Booking advance',
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.paymentId.startsWith('PAY-'));
    assert.equal(res.body.customerId, createdCustomerId);
    assert.equal(res.body.amount, 2000);

    // Verify customer balance was refreshed in cache
    const custRes = await request(server, 'GET', `/api/customers/${createdCustomerId}`);
    assert.equal(custRes.body.paidAmount, 2000);
    assert.equal(custRes.body.balance, 3800);
    assert.equal(custRes.body.paymentStatus, 'Partial');
  });

  await t.test('GET /api/customers/:id/payments lists payments for customer', async () => {
    const res = await request(server, 'GET', `/api/customers/${createdCustomerId}/payments`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].amount, 2000);
  });

  await t.test('payments: total paid can never exceed the total fee', async () => {
    // fee is 5800, 2000 already paid -> 3800 left
    const over = await request(server, 'POST', `/api/customers/${createdCustomerId}/payments`, {
      date: '2026-11-14',
      amount: 3801,
      mode: 'UPI',
    });
    assert.equal(over.status, 400);
    assert.match(over.body.error, /exceeds the balance/i);

    const exact = await request(server, 'POST', `/api/customers/${createdCustomerId}/payments`, {
      date: '2026-11-15',
      amount: 3800,
      mode: 'UPI',
    });
    assert.equal(exact.status, 201);

    const cust = await request(server, 'GET', `/api/customers/${createdCustomerId}`);
    assert.equal(cust.body.balance, 0);
    assert.equal(cust.body.paymentStatus, 'Paid');

    const fullyPaid = await request(server, 'POST', `/api/customers/${createdCustomerId}/payments`, {
      date: '2026-11-16',
      amount: 1,
      mode: 'Cash',
    });
    assert.equal(fullyPaid.status, 400);

    // clean up the extra payment for later tests
    await request(server, 'DELETE', `/api/payments/${exact.body.paymentId}`);
  });

  await t.test('payments: edit and delete by payment ID, still capped by total fee', async () => {
    const list = await request(server, 'GET', `/api/customers/${createdCustomerId}/payments`);
    const payId = list.body[0].paymentId;

    const edited = await request(server, 'PUT', `/api/payments/${payId}`, { amount: 2500, mode: 'Cash', note: 'fixed typo' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.amount, 2500);
    assert.equal(edited.body.note, 'fixed typo');

    const tooMuch = await request(server, 'PUT', `/api/payments/${payId}`, { amount: 5801 });
    assert.equal(tooMuch.status, 400);

    const belowPaid = await request(server, 'PUT', `/api/customers/${createdCustomerId}`, { totalFee: 1000 });
    assert.equal(belowPaid.status, 400);

    const del = await request(server, 'DELETE', `/api/payments/${payId}`);
    assert.equal(del.status, 200);
    const after = await request(server, 'GET', `/api/customers/${createdCustomerId}`);
    assert.equal(after.body.paidAmount, 0);
    assert.equal(after.body.paymentStatus, 'Unpaid');

    const gone = await request(server, 'DELETE', `/api/payments/${payId}`);
    assert.equal(gone.status, 404);
  });

  await t.test('DELETE /api/customers/:id deletes customer and associated payments by unique ID', async () => {
    const res = await request(server, 'DELETE', `/api/customers/${createdCustomerId}`);
    assert.equal(res.status, 200);

    const checkRes = await request(server, 'GET', `/api/customers/${createdCustomerId}`);
    assert.equal(checkRes.status, 404);
  });

  await t.test('staff & admin roles, counter dashboard, and staff change tracking', async () => {
    activityLog.clearLogsForTesting();

    // Login as staff1 (Counter 1) and staff2 (Counter 2)
    const s1Login = await request(server, 'POST', '/api/auth/login', {
      username: 'staff1',
      password: 'staff1-pass',
    });
    assert.equal(s1Login.status, 200);
    assert.equal(s1Login.body.user.role, 'staff');
    assert.equal(s1Login.body.user.counter, 'Counter 1');
    const staff1Token = s1Login.body.token;

    const s2Login = await request(server, 'POST', '/api/auth/login', {
      username: 'staff2',
      password: 'staff2-pass',
    });
    assert.equal(s2Login.status, 200);
    assert.equal(s2Login.body.user.role, 'staff');
    assert.equal(s2Login.body.user.counter, 'Counter 2');
    const staff2Token = s2Login.body.token;

    // Helper using an explicit token
    const reqAs = (token, method, path, body) =>
      new Promise((resolve, reject) => {
        const addr = server.address();
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(data
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                : {}),
            },
          },
          (res) => {
            let raw = '';
            res.on('data', (chunk) => (raw += chunk));
            res.on('end', () => {
              let parsed = null;
              try {
                parsed = raw ? JSON.parse(raw) : null;
              } catch {
                parsed = raw;
              }
              resolve({ status: res.statusCode, body: parsed });
            });
          }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
      });

    // Staff cannot access admin dashboard
    const s1Admin = await reqAs(staff1Token, 'GET', '/api/admin/dashboard');
    assert.equal(s1Admin.status, 403);
    const s2Admin = await reqAs(staff2Token, 'GET', '/api/admin/dashboard');
    assert.equal(s2Admin.status, 403);

    // Staff1 creates a customer and records a Cash payment
    const c1 = await reqAs(staff1Token, 'POST', '/api/customers', {
      name: 'Rohan Das',
      phone: '9876500001',
      category: 'Two Wheeler',
      totalFee: 4000,
    });
    assert.equal(c1.status, 201);

    const p1 = await reqAs(staff1Token, 'POST', `/api/customers/${c1.body.id}/payments`, {
      amount: 1500,
      mode: 'Cash',
      note: 'Counter 1 advance',
    });
    assert.equal(p1.status, 201);

    // Staff2 updates that customer and records a UPI payment
    const c1Edit = await reqAs(staff2Token, 'PUT', `/api/customers/${c1.body.id}`, {
      phone: '9876500002',
      documentStatus: 'Verified',
    });
    assert.equal(c1Edit.status, 200);

    const p2 = await reqAs(staff2Token, 'POST', `/api/customers/${c1.body.id}/payments`, {
      amount: 2500,
      mode: 'UPI',
      note: 'Counter 2 balance',
    });
    assert.equal(p2.status, 201);

    // Admin checks dashboard
    const dash = await request(server, 'GET', '/api/admin/dashboard');
    assert.equal(dash.status, 200);

    const counter1 = dash.body.counters.find((c) => c.username === 'staff1');
    const counter2 = dash.body.counters.find((c) => c.username === 'staff2');
    assert.ok(counter1);
    assert.ok(counter2);

    assert.equal(counter1.todayStats.customersCreated, 1);
    assert.equal(counter1.todayStats.paymentsCreated, 1);
    assert.equal(counter1.todayStats.paymentCollectedAmount, 1500);
    assert.equal(counter1.todayStats.paymentModeBreakdown.Cash, 1500);

    assert.equal(counter2.todayStats.customersUpdated, 1);
    assert.equal(counter2.todayStats.paymentsCreated, 1);
    assert.equal(counter2.todayStats.paymentCollectedAmount, 2500);
    assert.equal(counter2.todayStats.paymentModeBreakdown.UPI, 2500);

    // Verify field-level change diff for staff2's customer update
    const updateLog = dash.body.logs.find(
      (l) => l.actor.username === 'staff2' && l.entityType === 'customer' && l.action === 'UPDATE'
    );
    assert.ok(updateLog);
    assert.ok(updateLog.changes.some((ch) => ch.field === 'phone' && ch.from === '9876500001' && ch.to === '9876500002'));
    assert.ok(updateLog.changes.some((ch) => ch.field === 'documentStatus' && ch.from === 'Pending' && ch.to === 'Verified'));

    // Staff cannot manage staff accounts
    const s1Manage = await reqAs(staff1Token, 'PUT', '/api/admin/accounts/staff2', {
      name: 'Blocked',
      counter: 'Counter 2',
      username: 'staff2',
    });
    assert.equal(s1Manage.status, 403);

    // Admin can update staff2 name, counter, username, and password
    const updatedStaff2 = await request(server, 'PUT', '/api/admin/accounts/staff2', {
      name: 'Ameen Staff',
      counter: 'Front Desk 2',
      username: 'desk2',
      password: 'new-desk2-pass',
    });
    assert.equal(updatedStaff2.status, 200);
    assert.equal(updatedStaff2.body.name, 'Ameen Staff');
    assert.equal(updatedStaff2.body.counter, 'Front Desk 2');
    assert.equal(updatedStaff2.body.username, 'desk2');

    // Old credentials fail, new credentials succeed with updated name & counter
    const oldLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'staff2',
      password: 'staff2-pass',
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'desk2',
      password: 'new-desk2-pass',
    });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.user.name, 'Ameen Staff');
    assert.equal(newLogin.body.user.counter, 'Front Desk 2');
  });
});
