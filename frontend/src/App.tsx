import { useState, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'

function App() {
  const [health, setHealth] = useState<string>('Loading...')
  const [accounts, setAccounts] = useState<any[]>([])
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch link token from backend
  useEffect(() => {
    const fetchLinkToken = async () => {
      try {
        const res = await fetch('/api/plaid/link-token', { method: 'POST' })
        const data = await res.json()
        setLinkToken(data.linkToken)
      } catch (err) {
        console.error('Error fetching link token:', err)
      }
    }

    fetchLinkToken()
  }, [])

  // Check backend health and load accounts
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(() => setHealth('✅ Backend is running'))
      .catch(() => setHealth('❌ Backend unavailable'))

    fetch('/api/accounts')
      .then(r => r.json())
      .then(data => setAccounts(data.accounts || []))
      .catch(err => console.error('Error loading accounts:', err))
  }, [])

  // Plaid Link handler
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken: string) => {
      setLoading(true)
      try {
        const res = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken })
        })
        if (res.ok) {
          // Reload accounts after successful link
          const accountRes = await fetch('/api/accounts')
          const data = await accountRes.json()
          setAccounts(data.accounts || [])
        }
      } catch (err) {
        console.error('Error exchanging token:', err)
      } finally {
        setLoading(false)
      }
    },
    onExit: () => console.log('Plaid Link closed')
  })

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csv = event.target?.result as string;
      try {
        const res = await fetch('/api/import-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv, source: file.name })
        });
        const data = await res.json();
        if (data.success) {
          alert(`Imported ${data.accountsAdded} accounts!`);
          // Reload accounts
          const accountRes = await fetch('/api/accounts');
          const accData = await accountRes.json();
          setAccounts(accData.accounts || []);
        } else {
          alert(`Error: ${data.errors.join(', ')}`);
        }
      } catch (err) {
        console.error('CSV upload error:', err);
        alert('Failed to upload CSV');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>💰 Personal Finance OS</h1>
      <p>Backend Status: {health}</p>

      <h2>Accounts</h2>
      {accounts.length === 0 ? (
        <div>
          <p>No accounts linked yet.</p>
          <button
            onClick={() => open()}
            disabled={!ready || loading}
            style={{
              padding: '10px 20px',
              backgroundColor: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: ready && !loading ? 'pointer' : 'not-allowed',
              opacity: ready && !loading ? 1 : 0.5
            }}
          >
            {loading ? 'Connecting...' : 'Connect Bank Account'}
          </button>
        </div>
      ) : (
        <div>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {accounts.map((acc: any) => (
              <li key={acc.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                <strong>{acc.name}</strong> - ${(acc.current_balance || 0).toFixed(2)}
              </li>
            ))}
          </ul>
          <button
            onClick={() => open()}
            disabled={!ready || loading}
            style={{
              marginTop: '15px',
              padding: '10px 20px',
              backgroundColor: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: ready && !loading ? 'pointer' : 'not-allowed'
            }}
          >
            {loading ? 'Connecting...' : 'Add Another Account'}
          </button>
        </div>
      )}

      <h2 style={{ marginTop: '30px' }}>Import Accounts from CSV</h2>
      <p style={{ fontSize: '14px', color: '#666' }}>
        Upload CSVs from Edward Jones, Fidelity, or other brokers (quarterly).
        Format: account_id, name, type, subtype, current_balance, available_balance
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={handleCSVUpload}
        style={{ padding: '10px' }}
      />

      <p style={{ marginTop: '30px', fontSize: '12px', color: '#666' }}>
        Plaid (daily auto-sync) + CSV import (quarterly manual)
      </p>
    </div>
  )
}

export default App
