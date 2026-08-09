import { useState, useEffect } from 'react'

function App() {
  const [health, setHealth] = useState<string>('Loading...')
  const [accounts, setAccounts] = useState<any[]>([])

  useEffect(() => {
    // Check backend health
    fetch('/api/health')
      .then(r => r.json())
      .then(data => setHealth('✅ Backend is running'))
      .catch(() => setHealth('❌ Backend unavailable'))

    // Load accounts
    fetch('/api/accounts')
      .then(r => r.json())
      .then(data => setAccounts(data.accounts || []))
      .catch(err => console.error('Error loading accounts:', err))
  }, [])

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>💰 Personal Finance OS</h1>
      <p>Backend Status: {health}</p>

      <h2>Accounts</h2>
      {accounts.length === 0 ? (
        <p>No accounts linked yet. (Phase 1 implementation in progress)</p>
      ) : (
        <ul>
          {accounts.map((acc: any) => (
            <li key={acc.id}>{acc.name} - ${acc.balance}</li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: '30px', fontSize: '12px', color: '#666' }}>
        Phase 1 stub - Real implementation coming soon
      </p>
    </div>
  )
}

export default App
