const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.example.test/exec';

const sheetsService = require('../sheetsService');

// Fake Apps Script web app: write actions return the full snapshot.
function installFakeAppsScript({ returnSnapshot }) {
  const customers = [sheetsService.CUSTOMER_HEADERS];
  const payments = [sheetsService.PAYMENT_HEADERS];
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.action);
    if (body.action === 'createCustomer') customers.push(body.row.map(String));
    if (body.action === 'createPayment') payments.push(body.row.map(String));
    const snapshot = { customers: customers.map((r) => [...r]), payments: payments.map((r) => [...r]) };
    const payload =
      body.action === 'getAll' ? snapshot : returnSnapshot ? { ok: true, ...snapshot } : { ok: true };
    return { status: 200, text: async () => JSON.stringify(payload) };
  };
  return calls;
}

test('write uses one Apps Script call when the script returns a snapshot', async () => {
  const calls = installFakeAppsScript({ returnSnapshot: true });
  await sheetsService.refreshCache();
  calls.length = 0;

  const created = await sheetsService.createCustomer({ name: 'Fast Fatima', phone: '99999', totalFee: 1000 });
  assert.deepEqual(calls, ['createCustomer']);
  assert.equal(created.name, 'Fast Fatima');

  await sheetsService.createPayment({ customerId: created.id, amount: 400 });
  assert.deepEqual(calls, ['createCustomer', 'createPayment']);
  const again = await sheetsService.getCustomerById(created.id);
  assert.equal(again.paidAmount, 400);
});

test('falls back to a full re-read when an old script returns no snapshot', async () => {
  const calls = installFakeAppsScript({ returnSnapshot: false });
  await sheetsService.refreshCache();
  calls.length = 0;

  const created = await sheetsService.createCustomer({ name: 'Old Script', phone: '88888' });
  assert.deepEqual(calls, ['createCustomer', 'getAll']);
  assert.equal(created.name, 'Old Script');
});
