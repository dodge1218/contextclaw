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
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>ContextClaw Studio <span style={{ fontSize: '0.8rem', color: status === 'Connected' ? 'green' : 'red' }}>● {status}</span></h1>
      
      {!telemetry ? (
        <p>Waiting for context assembly events from OpenClaw...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '2rem' }}>
          <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
            <h3>Current Budget</h3>
            <p style={{ fontSize: '2rem', margin: '0' }}>{telemetry.budget.toLocaleString()} <span style={{ fontSize: '1rem' }}>tokens</span></p>
          </div>
          <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
            <h3>Active Context</h3>
            <p style={{ fontSize: '2rem', margin: '0', color: telemetry.keptTokens > telemetry.budget ? 'red' : 'inherit' }}>
              {telemetry.keptTokens.toLocaleString()} <span style={{ fontSize: '1rem' }}>tokens</span>
            </p>
          </div>
          <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px' }}>
            <h3>Total Original Tokens</h3>
            <p style={{ fontSize: '2rem', margin: '0' }}>{telemetry.totalTokens.toLocaleString()}</p>
          </div>
          <div style={{ border: '1px solid #ccc', padding: '1.5rem', borderRadius: '8px', background: '#fff0f0' }}>
            <h3>Evicted Messages</h3>
            <p style={{ fontSize: '2rem', margin: '0', color: '#d32f2f' }}>{telemetry.evictedCount}</p>
          </div>
        </div>
      )}

      {telemetry && (
        <div style={{ marginTop: '2rem', padding: '1rem', background: '#eee', borderRadius: '4px' }}>
          <p style={{ margin: 0, fontFamily: 'monospace' }}>
            Last Event: Session {telemetry.sessionId.slice(0, 8)}... | Saved {telemetry.totalTokens - telemetry.keptTokens} tokens
          </p>
        </div>
      )}
    </div>
  );
}