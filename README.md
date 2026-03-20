# Stacks Analytics Tracker

Standalone project for on-chain product analytics on Stacks.

## Layout

- `clarity/`: Clarinet contract project
- `frontend/`: Next.js frontend for wallet-based interactions

## Contract

- `clarity/contracts/analytics-tracker.clar`
- Methods: `track-page-view`, `track-action`, `track-conversion`, `track-custom-event`

## Run

```bash
cd clarity
clarinet check
npm test
```

```bash
cd frontend
npm run dev
```
