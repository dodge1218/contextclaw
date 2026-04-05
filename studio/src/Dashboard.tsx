import React, { useEffect, useState } from 'react';

export function Dashboard() {
  const [telemetry, setTelemetry] = useState(null);
  const [status, setStatus] = useState('Disconnected');

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:41234');

    ws.onopen = () => setStatus('Connected');
    ws.onclose = () => setStatus('Disconnected');
    ws.onerror = () => setStatus('Error');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ASSEMBLE') {
          setTelemetry(data);
        }
      } catch (e) {
        console.error('Failed to parse telemetry', e);
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', margin: 0, padding: 0 }}>
      {/* Sidebar: Subagent Fleet */}
      <div style={{ width: '260px', background: '#202123', color: '#fff', display: 'flex', flexDirection: 'column', padding: '1rem' }}>
        <h2 style={{ fontSize: '1rem', color: '#ececf1', marginBottom: '1.5rem' }}>Fleet Manager</h2>
        
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#8e8ea0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Active</div>
          <div style={{ padding: '0.5rem', background: '#343541', borderRadius: '4px', cursor: 'pointer', marginBottom: '0.5rem' }}>
            🟢 Main Agent (Claude)
          </div>
          <div style={{ padding: '0.5rem', background: '#343541', borderRadius: '4px', cursor: 'pointer' }}>
            🟢 Research Subagent (Groq)
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.8rem', color: '#8e8ea0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Cold Storage (Paused)</div>
          <div style={{ padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', color: '#c5c5d2', marginBottom: '0.5rem' }}>
            ⏸️ Reflist Builder
          </div>
          <div style={{ padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', color: '#c5c5d2' }}>
            ⏸️ MktPeek Analyzer
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '1rem 0 0', borderTop: '1px solid #4d4d4f' }}>
          <button style={{ width: '100%', padding: '0.5rem', background: '#transparent', border: '1px solid #565869', color: '#ececf1', borderRadius: '4px', cursor: 'pointer' }}>
            ⏸️ Pause All Nodes
          </button>
        </div>
      </div>

      {/* Main Content: Telemetry Dashboard */}
      <div style={{ flex: 1, padding: '2rem', background: '#ffffff', overflowY: 'auto' }}>
        <h1>ContextClaw Studio <span style={{ fontSize: '0.8rem', color: status === 'Connected' ? 'green' : 'red' }}>● {status}</span></h1>
        <p style={{ color: '#666' }}>Monitoring: <strong>Main Agent</strong></p>
        
        {!telemetry ? (
          <p>Waiting for context assembly events from OpenClaw...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '2rem' }}>
            <div style={{ border: '1px solid #e5e5e5', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>Current Budget</h3>
              <p style={{ fontSize: '2rem', margin: '0', fontWeight: 'bold' }}>{telemetry.budget.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#666' }}>tokens</span></p>
            </div>
            <div style={{ border: '1px solid #e5e5e5', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>Active Context</h3>
              <p style={{ fontSize: '2rem', margin: '0', fontWeight: 'bold', color: telemetry.keptTokens > telemetry.budget ? '#e53e3e' : '#2b6cb0' }}>
                {telemetry.keptTokens.toLocaleString()} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#666' }}>tokens</span>
              </p>
            </div>
            <div style={{ border: '1px solid #e5e5e5', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>Total Original Tokens</h3>
              <p style={{ fontSize: '2rem', margin: '0', fontWeight: 'bold' }}>{telemetry.totalTokens.toLocaleString()}</p>
            </div>
            <div style={{ border: '1px solid #e5e5e5', padding: '1.5rem', borderRadius: '8px', background: '#fff5f5', borderColor: '#feb2b2' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#c53030' }}>Evicted Messages</h3>
              <p style={{ fontSize: '2rem', margin: '0', fontWeight: 'bold', color: '#c53030' }}>{telemetry.evictedCount}</p>
            </div>
          </div>
        )}

        {telemetry && (
          <div style={{ marginTop: '2rem', padding: '1rem', background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
            <p style={{ margin: 0, fontFamily: 'monospace', color: '#4a5568' }}>
              Last Event: Session {telemetry.sessionId.slice(0, 8)}... | Saved {(telemetry.totalTokens - telemetry.keptTokens).toLocaleString()} tokens from API request
            </p>
          </div>
        )}
      </div>
    </div>
  );
}