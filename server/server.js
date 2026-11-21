require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sheetsService = require('./sheetsService');
const auth = require('./auth');
const activityLog = require('./activityLog');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Public: root + liveness + login
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'AL AMIN MOTOR TRAINING API' });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});
app.post('/api/auth/login', auth.login);

// Everything below requires a valid JWT
app.use('/api', auth.requireAuth);
app.get('/api/auth/me', auth.me);

app.get('/api/status', async (req, res, next) => {
  try {
    await sheetsService.listCustomers();
    res.json({
      status: 'ok',
      cache: sheetsService.getCacheStatus(),
    });
  } catch (err) {
    next(err);
  }
});

// Force refresh cache from Google Sheets
app.post('/api/sync', async (req, res, next) => {
  try {
    await sheetsService.refreshCache();
    res.json({
      message: 'Cache refreshed successfully',
      cache: sheetsService.getCacheStatus(),
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// COUNTER-SCOPED ACCESS HELPERS
// ==========================================

function getCustomerAttribution() {
  const accounts = auth.getPublicAccounts();
  const { map: attrMap, fallbackStaff1 } = activityLog.getCustomerAttributionMap(accounts);
  const fallbackAttr = {
    counterId: fallbackStaff1?.id || null,
    counterName: fallbackStaff1?.counter || fallbackStaff1?.name || 'Counter 1',
    staffName: fallbackStaff1?.name || 'Counter 1',
    staffUsername: fallbackStaff1?.username || '',
  };
  return (customerId) => attrMap.get(customerId) || fallbackAttr;
}

function canAccessCustomer(user, attr) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (attr?.counterId && user.id) {
    return attr.counterId === user.id;
  }
  if (attr?.staffUsername && user.username) {
    return attr.staffUsername === user.username;
  }
  return false;
}

// ==========================================
// CUSTOMERS REST ENDPOINTS
// ==========================================

// 1. List customers
app.get('/api/customers', async (req, res, next) => {
  try {
    const customers = await sheetsService.listCustomers();
    const { search, documentStatus, paymentStatus } = req.query;

    let filtered = customers;
    if (req.user?.role !== 'admin') {
      const getAttr = getCustomerAttribution();
      filtered = filtered.filter((c) => canAccessCustomer(req.user, getAttr(c.id)));
    }
    if (search) {
      const q = String(search).toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
      );
    }
    if (documentStatus && documentStatus !== 'All') {
      filtered = filtered.filter(
        (c) => c.documentStatus.toLowerCase() === String(documentStatus).toLowerCase()
      );
    }
    if (paymentStatus && paymentStatus !== 'All') {
      filtered = filtered.filter(
        (c) => c.paymentStatus.toLowerCase() === String(paymentStatus).toLowerCase()
      );
    }

    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

// 2. Get single customer by unique ID
app.get('/api/customers/:id', async (req, res, next) => {
  try {
    const customer = await sheetsService.getCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (!canAccessCustomer(req.user, getCustomerAttribution()(customer.id))) {
      return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
    }
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// 3. Create customer
app.post('/api/customers', async (req, res, next) => {
  try {
    const {
      name,
      phone,
      address,
      dob,
      category,
      course,
      enrollmentDate,
      totalFee,
      notes,
      documentStatus,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'Customer phone is required' });
    }

    const created = await sheetsService.createCustomer({
      name,
      phone,
      address,
      dob,
      category: category ?? course,
      enrollmentDate,
      totalFee,
      notes,
      documentStatus,
    });

    activityLog.recordActivity({
      user: req.user,
      action: 'CREATE',
      entityType: 'customer',
      entityId: created.id,
      customerId: created.id,
      customerName: created.name,
      summary: `Created customer "${created.name}" (${created.category || 'No category'}, Fee ₹${created.totalFee || 0})`,
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// 4. Update customer by unique ID
const handleUpdateCustomer = async (req, res, next) => {
  try {
    const before = await sheetsService.getCustomerById(req.params.id);
    if (!before) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (!canAccessCustomer(req.user, getCustomerAttribution()(before.id))) {
      return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
    }
    const updated = await sheetsService.updateCustomer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const changes = activityLog.diffFields(before, updated, activityLog.CUSTOMER_FIELDS);
    const changedLabels = changes.map((c) => c.label).join(', ');
    activityLog.recordActivity({
      user: req.user,
      action: 'UPDATE',
      entityType: 'customer',
      entityId: updated.id,
      customerId: updated.id,
      customerName: updated.name,
      summary: changedLabels
        ? `Updated customer "${updated.name}": ${changedLabels}`
        : `Updated customer "${updated.name}"`,
      changes,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

app.put('/api/customers/:id', handleUpdateCustomer);
app.patch('/api/customers/:id', handleUpdateCustomer);

// 5. Delete customer by unique ID
app.delete('/api/customers/:id', async (req, res, next) => {
  try {
    const before = await sheetsService.getCustomerById(req.params.id);
    if (!before) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (!canAccessCustomer(req.user, getCustomerAttribution()(before.id))) {
      return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
    }
    const deleted = await sheetsService.deleteCustomer(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    activityLog.recordActivity({
      user: req.user,
      action: 'DELETE',
      entityType: 'customer',
      entityId: req.params.id,
      customerId: req.params.id,
      customerName: before.name,
      summary: `Deleted customer "${before.name}" (${before.phone || req.params.id})`,
    });
    res.json({ message: 'Customer deleted successfully', id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// PAYMENTS REST ENDPOINTS
// ==========================================

// 1. List payments by customer (via /api/customers/:id/payments)
app.get('/api/customers/:id/payments', async (req, res, next) => {
  try {
    const customer = await sheetsService.getCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (!canAccessCustomer(req.user, getCustomerAttribution()(customer.id))) {
      return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
    }
    const payments = await sheetsService.listPaymentsByCustomer(req.params.id);
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

// 1b. List payments (supports ?customerId=... or all payments)
app.get('/api/payments', async (req, res, next) => {
  try {
    const { customerId } = req.query;
    if (customerId) {
      const targetId = String(customerId);
      const customer = await sheetsService.getCustomerById(targetId);
      if (customer && !canAccessCustomer(req.user, getCustomerAttribution()(customer.id))) {
        return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
      }
      const payments = await sheetsService.listPaymentsByCustomer(targetId);
      return res.json(payments);
    }
    const payments = await sheetsService.listAllPayments();
    if (req.user?.role !== 'admin') {
      const getAttr = getCustomerAttribution();
      return res.json(payments.filter((p) => canAccessCustomer(req.user, getAttr(p.customerId))));
    }
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

// 2. Create payment (via /api/payments or /api/customers/:id/payments)
const handleCreatePayment = async (req, res, next) => {
  try {
    const customerId = req.params.id || req.body.customerId;
    const { date, amount, mode, note } = req.body;

    if (!customerId || !String(customerId).trim()) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return res
        .status(400)
        .json({ error: 'Valid positive payment amount is required' });
    }

    const customer = await sheetsService.getCustomerById(customerId);
    if (customer && !canAccessCustomer(req.user, getCustomerAttribution()(customer.id))) {
      return res.status(403).json({ error: 'Access denied: this customer belongs to another counter' });
    }

    const payment = await sheetsService.createPayment({
      customerId,
      date,
      amount: numericAmount,
      mode,
      note,
    });

    const customerName = customer?.name || customerId;
    activityLog.recordActivity({
      user: req.user,
      action: 'CREATE',
      entityType: 'payment',
      entityId: payment.paymentId,
      customerId: payment.customerId,
      customerName,
      summary: `Recorded payment ₹${payment.amount} (${payment.mode || 'Cash'}) for "${customerName}"`,
      amount: payment.amount,
      mode: payment.mode || 'Cash',
    });

    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
};

app.post('/api/payments', handleCreatePayment);
app.post('/api/customers/:id/payments', handleCreatePayment);

// 3. Edit a payment by its unique payment ID
const handleUpdatePayment = async (req, res, next) => {
  try {
    const allPayments = await sheetsService.listAllPayments();
    const before = allPayments.find((p) => p.paymentId === req.params.paymentId);
    if (!before) return res.status(404).json({ error: 'Payment not found' });
    if (!canAccessCustomer(req.user, getCustomerAttribution()(before.customerId))) {
      return res.status(403).json({ error: 'Access denied: this payment belongs to another counter' });
    }

    const { date, amount, mode, note } = req.body || {};
    const updated = await sheetsService.updatePayment(req.params.paymentId, {
      date,
      amount,
      mode,
      note,
    });
    if (!updated) return res.status(404).json({ error: 'Payment not found' });

    const customer = await sheetsService.getCustomerById(updated.customerId);
    const customerName = customer?.name || before.customerName || updated.customerId;
    const changes = activityLog.diffFields(before, updated, activityLog.PAYMENT_FIELDS);
    const changedLabels = changes.map((c) => c.label).join(', ');
    activityLog.recordActivity({
      user: req.user,
      action: 'UPDATE',
      entityType: 'payment',
      entityId: updated.paymentId,
      customerId: updated.customerId,
      customerName,
      summary: changedLabels
        ? `Updated payment ${updated.paymentId} for "${customerName}": ${changedLabels}`
        : `Updated payment ${updated.paymentId} for "${customerName}"`,
      changes,
      amount: updated.amount,
      mode: updated.mode,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};
app.put('/api/payments/:paymentId', handleUpdatePayment);
app.patch('/api/payments/:paymentId', handleUpdatePayment);

// 4. Delete a payment by its unique payment ID
app.delete('/api/payments/:paymentId', async (req, res, next) => {
  try {
    const allPayments = await sheetsService.listAllPayments();
    const before = allPayments.find((p) => p.paymentId === req.params.paymentId);
    if (!before) return res.status(404).json({ error: 'Payment not found' });
    if (!canAccessCustomer(req.user, getCustomerAttribution()(before.customerId))) {
      return res.status(403).json({ error: 'Access denied: this payment belongs to another counter' });
    }

    const deleted = await sheetsService.deletePayment(req.params.paymentId);
    if (!deleted) return res.status(404).json({ error: 'Payment not found' });

    const customerName = before.customerName || before.customerId;
    activityLog.recordActivity({
      user: req.user,
      action: 'DELETE',
      entityType: 'payment',
      entityId: req.params.paymentId,
      customerId: before.customerId,
      customerName,
      summary: `Deleted payment ${req.params.paymentId} (₹${before.amount}, ${before.mode || 'Cash'}) for "${customerName}"`,
      amount: before.amount,
      mode: before.mode,
    });

    res.json({ message: 'Payment deleted successfully', paymentId: req.params.paymentId });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ADMIN DASHBOARD & STAFF ACTIVITY ENDPOINTS
// ==========================================

async function syncHistoricalCounter1Logs() {
  const accounts = auth.getPublicAccounts();
  const counter1 = accounts.find((a) => a.role === 'staff');
  if (!counter1) return 0;
  const [customers, payments] = await Promise.all([
    sheetsService.listCustomers(),
    sheetsService.listAllPayments(),
  ]);
  return activityLog.backfillFromSheets({
    customers,
    payments,
    actor: counter1,
  });
}

app.get('/api/admin/dashboard', auth.requireAdmin, async (req, res, next) => {
  try {
    await syncHistoricalCounter1Logs();
    const accounts = auth.getPublicAccounts();
    const { from, to, actor, entityType, action, search, limit } = req.query;
    const dashboard = activityLog.getDashboard({
      accounts,
      from: from ? String(from) : '',
      to: to ? String(to) : '',
      actor: actor ? String(actor) : '',
      entityType: entityType ? String(entityType) : '',
      action: action ? String(action) : '',
      search: search ? String(search) : '',
      limit: limit ? Number(limit) : 200,
    });

    const allCustomers = await sheetsService.listCustomers();
    const { map: attrMap, fallbackStaff1 } = activityLog.getCustomerAttributionMap(accounts);

    const customersWithCounter = allCustomers.map((c) => {
      const attr = attrMap.get(c.id) || {
        counterId: fallbackStaff1?.id || null,
        counterName: fallbackStaff1?.counter || fallbackStaff1?.name || 'Counter 1',
        staffName: fallbackStaff1?.name || 'Counter 1',
        staffUsername: fallbackStaff1?.username || '',
      };
      return { ...c, ...attr };
    });

    // Count customers per counter
    const countsByUsername = new Map();
    for (const c of customersWithCounter) {
      const key = c.staffUsername || 'unknown';
      countsByUsername.set(key, (countsByUsername.get(key) || 0) + 1);
    }
    dashboard.counters = dashboard.counters.map((ctr) => ({
      ...ctr,
      customerCount: countsByUsername.get(ctr.username) || 0,
    }));
    dashboard.customers = customersWithCounter;

    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/accounts', auth.requireAdmin, (req, res) => {
  res.json(auth.getPublicAccounts());
});

app.put('/api/admin/accounts/:id', auth.requireAdmin, (req, res, next) => {
  try {
    const { name, counter, username, password } = req.body || {};
    const updated = auth.updateStaffAccount(req.params.id, {
      name,
      counter,
      username,
      password,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.message);
  const status = err.statusCode || (err.code === 404 ? 404 : 500);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

if (require.main === module) {
  sheetsService
    .refreshCache()
    .then(async (cache) => {
      console.log(
        `[SheetsService] Cache initialized (${cache.syncSource}) with ${cache.customers.length} customers and ${cache.payments.length} payments.`
      );
      const added = await syncHistoricalCounter1Logs();
      if (added > 0) {
        console.log(`[ActivityLog] Backfilled ${added} historical records for Counter 1.`);
      }
    })
    .catch((err) => {
      console.warn('[SheetsService] Startup sync warning:', err.message);
    })
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`AL AMIN MOTOR TRAINING Backend running on http://localhost:${PORT}`);
      });
    });
}

module.exports = app;
