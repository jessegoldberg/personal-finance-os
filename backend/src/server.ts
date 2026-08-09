import express = require('express');
import path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static frontend files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints (stubs)
app.get('/api/accounts', (req: express.Request, res: express.Response) => {
  res.json({ accounts: [] });
});

app.get('/api/transactions', (req: express.Request, res: express.Response) => {
  res.json({ transactions: [] });
});

app.get('/api/debts', (req: express.Request, res: express.Response) => {
  res.json({ debts: [] });
});

app.post('/api/debts', (req: express.Request, res: express.Response) => {
  res.status(201).json({ id: 'debt_1', message: 'Debt created (stub)' });
});

app.post('/api/plaid/link-token', (req: express.Request, res: express.Response) => {
  // TODO: Call Plaid.create_link_token() with proper config
  res.json({
    linkToken: 'link-sandbox-' + Math.random().toString(36).substr(2, 9),
    expiration: new Date(Date.now() + 3600000).toISOString()
  });
});

app.post('/api/plaid/exchange-token', (req: express.Request, res: express.Response) => {
  const { publicToken } = req.body;
  if (!publicToken) {
    return res.status(400).json({ error: 'publicToken required' });
  }
  // TODO: Call Plaid.exchange_public_token() to get access_token
  // TODO: Store access_token in database for this user
  res.json({
    success: true,
    message: 'Account linked successfully (stub)',
    accountId: 'acc_' + Math.random().toString(36).substr(2, 9)
  });
});

// Serve index.html for any route not matching an API endpoint (SPA fallback)
app.get('*', (req: express.Request, res: express.Response) => {
  res.sendFile(path.join(publicPath, 'index.html'), {
    headers: { 'Cache-Control': 'no-cache' }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
