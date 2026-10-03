import express = require('express');
import path = require('path');
import dotenv = require('dotenv');
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { db_functions, Account } from './db';
import { importAccountsFromCSV } from './csv-import';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Plaid client
const plaidConfig = new Configuration({
  basePath: process.env.PLAID_ENV === 'production'
    ? PlaidEnvironments.Production
    : PlaidEnvironments.Sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(plaidConfig);

// Middleware
app.use(express.json());

// Serve static frontend files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints
app.get('/api/accounts', (req: express.Request, res: express.Response) => {
  const accounts = db_functions.getAllAccounts();
  res.json({ accounts });
});

app.get('/api/transactions', (req: express.Request, res: express.Response) => {
  res.json({ transactions: [] });
});

app.get('/api/debts', (req: express.Request, res: express.Response) => {
  try {
    const debts = db_functions.getAllDebts();
    res.json(debts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch debts' });
  }
});

app.post('/api/debts', (req: express.Request, res: express.Response) => {
  const { name, balance, interestRate, minPayment, dueDate } = req.body;
  if (!name || balance === undefined || interestRate === undefined) {
    return res.status(400).json({ error: 'name, balance, and interestRate required' });
  }
  try {
    const debt = {
      id: 'debt_' + Date.now(),
      name,
      balance: parseFloat(balance),
      interest_rate: parseFloat(interestRate),
      min_payment: parseFloat(minPayment) || 0,
      due_date: dueDate || null
    };
    db_functions.saveDebt(debt);
    res.status(201).json(debt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create debt' });
  }
});

app.get('/api/income', (req: express.Request, res: express.Response) => {
  try {
    const income = db_functions.getIncome();
    res.json(income);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch income' });
  }
});

app.post('/api/income', (req: express.Request, res: express.Response) => {
  const { salary, grants, other } = req.body;
  try {
    db_functions.saveIncome({
      salary: parseFloat(salary) || 0,
      grants: parseFloat(grants) || 0,
      other: parseFloat(other) || 0
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save income' });
  }
});

app.post('/api/plaid/link-token', async (req: express.Request, res: express.Response) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'user-' + Date.now() },
      client_name: 'Personal Finance OS',
      language: 'en',
      products: [Products.Transactions, Products.Investments, Products.Liabilities],
      country_codes: [CountryCode.Us],
      redirect_uri: process.env.PLAID_REDIRECT_URI || 'http://localhost:3000',
    });
    res.json({
      linkToken: response.data.link_token,
      expiration: response.data.expiration
    });
  } catch (error: any) {
    console.error('Link token error:', error.message);
    console.error('Full error:', JSON.stringify(error.response?.data || error, null, 2));
    res.status(500).json({
      error: error.message || 'Failed to create link token',
      details: error.response?.data?.error_message || error.response?.data
    });
  }
});

app.post('/api/plaid/exchange-token', async (req: express.Request, res: express.Response) => {
  const { publicToken } = req.body;
  if (!publicToken) {
    return res.status(400).json({ error: 'publicToken required' });
  }
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    console.log(`✅ Token exchanged successfully. ItemID: ${itemId}`);

    // Fetch accounts from Plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accounts: Account[] = accountsResponse.data.accounts.map((acc: any) => ({
      id: acc.account_id,
      item_id: itemId,
      account_id: acc.account_id,
      name: acc.name,
      type: acc.type,
      subtype: acc.subtype,
      current_balance: acc.balances.current || 0,
      available_balance: acc.balances.available || 0,
    }));

    // Fetch liabilities (credit cards, loans) from Plaid
    let liabilities: any[] = [];
    try {
      const liabilitiesResponse = await plaidClient.liabilitiesGet({
        access_token: accessToken,
      });
      const liab = liabilitiesResponse.data.liabilities as any;
      if (liab) {
        if (liab.credit_cards) liabilities = liabilities.concat(liab.credit_cards);
        if (liab.student_loans) liabilities = liabilities.concat(liab.student_loans);
        if (liab.mortgages) liabilities = liabilities.concat(liab.mortgages);
      }
      console.log(`📊 Fetched ${liabilities.length} liabilities`);
    } catch (liabErr: any) {
      console.log('⚠️ Liabilities fetch skipped (not supported by this institution):', liabErr.message);
    }

    // Save linked item and accounts to database
    db_functions.saveLinkedItem({
      id: 'item_' + itemId,
      item_id: itemId,
      access_token: accessToken,
      institution_name: null,
    });
    db_functions.saveAccounts(accounts);

    console.log(`💾 Stored ${accounts.length} accounts in database`);

    res.json({
      success: true,
      message: 'Account linked successfully',
      itemId,
      accounts,
      liabilities
    });
  } catch (error: any) {
    console.error('Token exchange error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to exchange token' });
  }
});

app.post('/api/import-csv', (req: express.Request, res: express.Response) => {
  const { csv, source } = req.body;
  if (!csv) {
    return res.status(400).json({ error: 'CSV content required' });
  }
  try {
    const result = importAccountsFromCSV(csv);
    if (result.success) {
      console.log(`📥 Imported ${result.accountsAdded} accounts from ${source || 'CSV'}`);
    }
    res.json(result);
  } catch (error: any) {
    console.error('CSV import error:', error.message);
    res.status(500).json({ success: false, accountsAdded: 0, errors: [error.message] });
  }
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
