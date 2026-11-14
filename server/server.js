require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sheetsService = require('./sheetsService');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Public: liveness + login
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
// CUSTOMERS REST ENDPOINTS
// ==========================================

// 1. List customers
app.get('/api/customers', async (req, res, next) => {
  try {
    const customers = await sheetsService.listCustomers();
    const { search, documentStatus, paymentStatus } = req.query;

    let filtered = customers;
    if (search) {
      const q = String(search).toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.course.toLowerCase().includes(q)
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
      course,
      enrollmentDate,
      totalFee,
      notes,
      documentStatus,
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// 4. Update customer by unique ID
const handleUpdateCustomer = async (req, res, next) => {
  try {
    const updated = await sheetsService.updateCustomer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Customer not found' });
    }
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
    const deleted = await sheetsService.deleteCustomer(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Customer not found' });
    }
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
      const payments = await sheetsService.listPaymentsByCustomer(String(customerId));
      return res.json(payments);
    }
    const payments = await sheetsService.listAllPayments();
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

    const payment = await sheetsService.createPayment({
      customerId,
      date,
      amount: numericAmount,
      mode,
      note,
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
    const { date, amount, mode, note } = req.body || {};
    const updated = await sheetsService.updatePayment(req.params.paymentId, {
      date,
      amount,
      mode,
      note,
    });
    if (!updated) return res.status(404).json({ error: 'Payment not found' });
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
    const deleted = await sheetsService.deletePayment(req.params.paymentId);
    if (!deleted) return res.status(404).json({ error: 'Payment not found' });
    res.json({ message: 'Payment deleted successfully', paymentId: req.params.paymentId });
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
    .then((cache) => {
      console.log(
        `[SheetsService] Cache initialized (${cache.syncSource}) with ${cache.customers.length} customers and ${cache.payments.length} payments.`
      );
    })
    .catch((err) => {
      console.warn('[SheetsService] Startup sync warning:', err.message);
    })
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`Al Ameen Motor Backend running on http://localhost:${PORT}`);
      });
    });
}

module.exports = app;
