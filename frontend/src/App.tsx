import { useState, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'

function App() {
  const [health, setHealth] = useState<string>('Loading...')
  const [accounts, setAccounts] = useState<any[]>([])
  const [debts, setDebts] = useState<any[]>([])
  const [income, setIncome] = useState<any>({ salary: 0, grants: 0, other: 0 })
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // New debt form state
  const [newDebt, setNewDebt] = useState({
    name: '',
    balance: '',
    interestRate: '',
    minPayment: '',
    dueDate: ''
  })

  // Fetch link token
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

  // Load accounts, debts, income on mount
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(() => setHealth('✅ Backend is running'))
      .catch(() => setHealth('❌ Backend unavailable'))

    fetch('/api/accounts')
      .then(r => r.json())
      .then(data => setAccounts(data.accounts || []))
      .catch(err => console.error('Error loading accounts:', err))

    fetch('/api/debts')
      .then(r => r.json())
      .then(data => setDebts(data.debts || []))
      .catch(err => console.error('Error loading debts:', err))

    fetch('/api/income')
      .then(r => r.json())
      .then(data => setIncome(data || {}))
      .catch(err => console.error('Error loading income:', err))
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

  // Add debt
  const handleAddDebt = async () => {
    if (!newDebt.name || !newDebt.balance || !newDebt.interestRate) {
      alert('Fill in name, balance, and interest rate')
      return
    }
    try {
      const res = await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newDebt.name,
          balance: parseFloat(newDebt.balance),
          interestRate: parseFloat(newDebt.interestRate),
          minPayment: parseFloat(newDebt.minPayment) || 0,
          dueDate: newDebt.dueDate
        })
      })
      if (res.ok) {
        const data = await res.json()
        setDebts([...debts, data])
        setNewDebt({ name: '', balance: '', interestRate: '', minPayment: '', dueDate: '' })
      }
    } catch (err) {
      console.error('Error adding debt:', err)
    }
  }

  // Save income
  const handleSaveIncome = async () => {
    try {
      await fetch('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(income)
      })
      alert('Income saved')
    } catch (err) {
      console.error('Error saving income:', err)
    }
  }

  const totalAccountBalance = accounts.reduce((sum, acc) => sum + (acc.current_balance || 0), 0)
  const totalDebt = debts.reduce((sum, debt) => sum + (debt.balance || 0), 0)
  const monthlyIncome = (income.salary || 0) + (income.grants || 0) + (income.other || 0)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '900px' }}>
      <h1>💰 Personal Finance OS</h1>
      <p>Backend Status: {health}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '30px' }}>
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#666' }}>Total Assets</p>
          <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>${totalAccountBalance.toFixed(2)}</p>
        </div>
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#666' }}>Total Debt</p>
          <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#d32f2f' }}>${totalDebt.toFixed(2)}</p>
        </div>
        <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#666' }}>Monthly Income</p>
          <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#388e3c' }}>${monthlyIncome.toFixed(2)}</p>
        </div>
      </div>

      <h2>Accounts (Plaid)</h2>
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
                <strong>{acc.name}</strong> <span style={{ fontSize: '12px', color: '#666' }}>({acc.type})</span> - ${(acc.current_balance || 0).toFixed(2)}
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

      <h2 style={{ marginTop: '30px' }}>Debts</h2>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '10px' }}>
          <input
            placeholder="Name (e.g., Chase Card)"
            value={newDebt.name}
            onChange={(e) => setNewDebt({ ...newDebt, name: e.target.value })}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
          />
          <input
            type="number"
            placeholder="Balance"
            value={newDebt.balance}
            onChange={(e) => setNewDebt({ ...newDebt, balance: e.target.value })}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
          />
          <input
            type="number"
            placeholder="Interest Rate (%)"
            step="0.01"
            value={newDebt.interestRate}
            onChange={(e) => setNewDebt({ ...newDebt, interestRate: e.target.value })}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
          />
          <input
            type="number"
            placeholder="Min Payment"
            value={newDebt.minPayment}
            onChange={(e) => setNewDebt({ ...newDebt, minPayment: e.target.value })}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
          />
          <input
            type="text"
            placeholder="Due Date (e.g., 15)"
            value={newDebt.dueDate}
            onChange={(e) => setNewDebt({ ...newDebt, dueDate: e.target.value })}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
          />
        </div>
        <button
          onClick={handleAddDebt}
          style={{
            padding: '10px 20px',
            backgroundColor: '#388e3c',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Add Debt
        </button>
      </div>

      {debts.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {debts.map((debt: any) => (
            <li key={debt.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
              <strong>{debt.name}</strong> - Balance: ${debt.balance.toFixed(2)} | Rate: {debt.interestRate}% | Min: ${debt.minPayment || 0}
              {debt.dueDate && <span style={{ fontSize: '12px', color: '#666' }}> | Due: {debt.dueDate}</span>}
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: '30px' }}>Monthly Income</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '10px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', color: '#666' }}>Salary</label>
          <input
            type="number"
            value={income.salary || 0}
            onChange={(e) => setIncome({ ...income, salary: parseFloat(e.target.value) || 0 })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', color: '#666' }}>Grants/Other</label>
          <input
            type="number"
            value={income.grants || 0}
            onChange={(e) => setIncome({ ...income, grants: parseFloat(e.target.value) || 0 })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', color: '#666' }}>Other Income</label>
          <input
            type="number"
            value={income.other || 0}
            onChange={(e) => setIncome({ ...income, other: parseFloat(e.target.value) || 0 })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
          />
        </div>
      </div>
      <button
        onClick={handleSaveIncome}
        style={{
          padding: '10px 20px',
          backgroundColor: '#0066cc',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        Save Income
      </button>
    </div>
  )
}

export default App
