import { db_functions, Account } from './db';

export interface CSVImportResult {
  success: boolean;
  accountsAdded: number;
  errors: string[];
}

export const parseAccountCSV = (csvContent: string): Account[] => {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have header + data rows');

  const header = lines[0].toLowerCase();
  const accounts: Account[] = [];

  // Support flexible CSV formats from different brokers
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));

    if (row.length < 3) continue;

    const account: Account = {
      id: `csv_${Date.now()}_${i}`,
      item_id: 'manual-import',
      account_id: row[0] || `account_${i}`,
      name: row[1] || 'Imported Account',
      type: row[2] || 'investment',
      subtype: row[3] || null,
      current_balance: parseFloat(row[4]) || 0,
      available_balance: parseFloat(row[5]) || 0,
    };

    accounts.push(account);
  }

  return accounts;
};

export const importAccountsFromCSV = (csvContent: string): CSVImportResult => {
  try {
    const accounts = parseAccountCSV(csvContent);
    db_functions.saveAccounts(accounts);

    return {
      success: true,
      accountsAdded: accounts.length,
      errors: [],
    };
  } catch (error: any) {
    return {
      success: false,
      accountsAdded: 0,
      errors: [error.message],
    };
  }
};
