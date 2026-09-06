# Architecture

This document describes the high-level system architecture of the Smart Market Watchlist application.

```
React Frontend (Vite + TypeScript)
      ↓ HTTP
Express Backend (Node.js + TypeScript)
  ├── /health
  ├── /api/watchlists
  ├── /api/watchlists/:id/check
  ├── /api/stocks/:stockId/market
  └── /api/stocks/:stockId/change
      ↓
Pure Change Detection Engine (change-detector.ts)
      ↓
Deterministic Market Simulator / Data Service
      ↓ pg
PostgreSQL (Local Database: market_watchlist)
  ├── users
  ├── watchlists
  ├── stocks
  ├── watchlist_stocks
  ├── market_snapshots
  └── watchlist_check_state
```

---

## Components

### 1. React Frontend
The user interface is built as a single-page application using React and Vite with strict TypeScript. In future phases, it will provide users with an interactive market dashboard to view monitored stocks, watchlists, and attention-worthy market movements.

### 2. Express Backend
The backend service is powered by Node.js and Express with strict TypeScript. It serves as the API layer, managing application routes, handling client requests, verifying database health via `GET /health`, and interacting with the local PostgreSQL database using parameterized SQL queries.

### 3. Checkpoint & Change Detection Engine
Tracks application and market watermarks per watchlist (`watchlist_check_state`). When a user checks a watchlist (`POST /api/watchlists/:id/check`), it determines the baseline snapshot vs current snapshot for each stock in the watchlist, computes changes using `detectMarketChange`, filters out unmeaningful variations, and updates the checkpoint atomically in a database transaction.

### 4. Deterministic Market Simulator
An isolated module generating deterministic time-series market snapshots across controlled scenarios (`STABLE`, `PRICE_MOVE`, `VOLUME_SPIKE`) without external dependencies.

### 5. PostgreSQL
PostgreSQL is the primary relational database running locally. It stores:
- `users`: User identity entities.
- `watchlists`: User-created watchlists.
- `stocks`: Financial instrument identity records (symbol, company name, exchange).
- `watchlist_stocks`: Many-to-many relationship mapping stocks into watchlists.
- `market_snapshots`: Time-series observations storing OHLC prices, volume, and simulated market timestamps.
- `watchlist_check_state`: Persisted check state per watchlist storing `last_checked_at` and `last_checked_market_time`.
