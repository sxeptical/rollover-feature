import { useRef, useState } from 'react'
import './App.css'

function App() {
  const [clientName, setClientName] = useState(import.meta.env.VITE_DEFAULT_CLIENT_NAME || 'ABC')
  const [financialYear, setFinancialYear] = useState(import.meta.env.VITE_DEFAULT_FINANCIAL_YEAR || 'FY 2025-2026')
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const pollerRef = useRef(null)

  const stopPolling = () => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }
  }

  const pollStatus = (id) => {
    stopPolling()
    pollerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${id}`)
        const data = await res.json()
        if (!data.success) {
          setError(data.message || 'Failed to fetch status')
          stopPolling()
          return
        }
        setStatus(data)
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling()
        }
      } catch (err) {
        setError(err.message)
        stopPolling()
      }
    }, 2000)
  }

  const handleRollover = async () => {
    setLoading(true)
    setError(null)
    setJobId(null)
    setStatus(null)
    stopPolling()

    try {
      const res = await fetch('/api/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, newFinancialYear: financialYear }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.errors ? data.errors.join(', ') : data.message || 'Request failed')
        return
      }

      setJobId(data.jobId)
      pollStatus(data.jobId)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="tester-screen">
      <section className="tester-card">
        <h1>Rollover Test Console</h1>
        <p className="subtext">Run the backend rollover against your Dropbox sample data.</p>

        <div className="rollover-form">
          <label>
            Client Name
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. ABC"
            />
          </label>
          <label>
            Financial Year
            <input
              type="text"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              placeholder="e.g. FY 2025-2026"
            />
          </label>
        </div>

        <button
          type="button"
          className="rollover-btn"
          onClick={handleRollover}
          disabled={loading || !clientName.trim() || !financialYear.trim()}
        >
          {loading ? 'Starting...' : 'Run Rollover'}
        </button>

        {error ? <p className="rollover-error">{error}</p> : null}

        {jobId ? (
          <div className="rollover-status">
            <p><strong>Job ID:</strong> {jobId}</p>
            <p><strong>Status:</strong> {status?.status || 'queued'}</p>
            {status?.error ? <p className="rollover-error">{status.error}</p> : null}
            {status?.logs?.length ? <pre className="rollover-logs">{status.logs.join('\n')}</pre> : null}
            {status?.result ? <pre className="rollover-logs">{JSON.stringify(status.result, null, 2)}</pre> : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
