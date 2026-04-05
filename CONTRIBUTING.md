# Contributing to ContextClaw

## Setup

```bash
git clone https://github.com/dodge1218/contextclaw.git
cd contextclaw
npm install
npx tsc --noEmit  # verify it compiles
```

## Development

```bash
npm run dev  # watch mode
npm test     # run tests
```

## Pull Requests

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make changes — ensure `npx tsc --noEmit` passes with zero errors
4. Write tests for new features
5. Open a PR with a clear description of what changed and why

## Code Style

- TypeScript strict mode
- JSDoc on all public methods
- No `any` types
- Prefer explicit error handling over try/catch-all

## Reporting Issues

If you've hit context bloat, retry spirals, or token waste in your OpenClaw setup, open an issue with:
- Your `openclaw.json` config (redact API keys)
- Approximate session token counts
- What behavior you expected vs what happened
