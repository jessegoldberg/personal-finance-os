import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints (stubs)
app.get('/api/accounts', (req, res) => {
  res.json({ accounts: [] });
});

app.get('/api/transactions', (req, res) => {
  res.json({ transactions: [] });
});

app.get('/api/debts', (req, res) => {
  res.json({ debts: [] });
});

app.post('/api/debts', (req, res) => {
  res.status(201).json({ id: 'debt_1', message: 'Debt created (stub)' });
});

app.post('/api/plaid/link-token', (req, res) => {
  res.json({ linkToken: 'link-sandbox-stub', expiration: new Date(Date.now() + 3600000).toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

export default app;
