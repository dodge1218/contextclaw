import React from 'react';
import { createWebSocket } from './websocket';

const Dashboard = () => {
  const [tokenUsage, setTokenUsage] = React.useState(0);

  React.useEffect(() => {
    const ws = createWebSocket();
    ws.onmessage = (event) => {
      setTokenUsage(JSON.parse(event.data).tokenUsage);
    };
  }, []);

  return (
    <div>
      <h1>Token Usage: {tokenUsage}</h1>
    </div>
  );
};

export { Dashboard };