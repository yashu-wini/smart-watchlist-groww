# Smart Market Watchlist

A production-ready financial market monitoring application designed to cut through market noise by answering one question: **"What changed since you last checked?"**

Instead of overwhelming investors with endless ticks and complex charts, Market Watch remembers your personal checkpoint, evaluates market movements across your watchlists, and prioritizes actionable developments.

---

## Core Product Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. REMEMBER  │ ──> │  2. COMPARE  │ ──> │3. UNDERSTAND │ ──> │4. PRIORITIZE │
│ Personal     │     │ Baseline vs  │     │ Classify     │     │ Group by     │
│ Checkpoint   │     │ Current Ticks│     │ Move Severity│     │ Action Level │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

1. **Remember**: Market Watch persists an exact checkpoint timestamp and market watermark for each of your watchlists in PostgreSQL.
2. **Compare**: When you check for changes, the system compares the latest observation against your established baseline for each instrument.
3. **Understand**: Mathematical algorithms evaluate percentage price movements and volume multipliers against rigorous thresholds.
4. **Prioritize**: The attention engine classifies events into three clear, prioritized tiers with transparent human-readable explanations.

---

## Key Features

### 1. "Since You Last Checked" Checkpoint Intelligence
- **Baseline Establishment**: The very first time you check a watchlist, the system establishes your baseline without flagging historical data as new events.
- **Subsequent Checks**: Only market movements occurring *after* your last checkpoint are evaluated.
- **Dynamic Membership Handling**: When a new stock is added to an existing watchlist, its baseline is pinned to the first observation at or after its addition time, avoiding false alerts.
- **Atomic Transactions**: Checkpoint advancement occurs inside database transactions with row-level locks (`FOR UPDATE`), ensuring concurrency safety and zero lost updates.

### 2. Attention Classification Engine
The attention engine categorizes every monitored instrument into three distinct tiers:

- 🔴 **`NEEDS_ATTENTION`**: Urgent, high-conviction market developments:
  - Significant price movement ($\ge \pm 3.0\%$).
  - High-conviction momentum: Significant price movement combined with a volume spike.
- 🟡 **`WORTH_WATCHING`**: Notable market anomalies worth tracking:
  - Volume spike ($\ge 2.0\times$ baseline volume) with low price variation.
- 🟢 **`NO_MEANINGFUL_CHANGE`** / **Stable**:
  - Normal market noise within acceptable ranges ($< \pm 3.0\%$ price delta and $< 2.0\times$ volume).
  - Displays *"You're all caught up"* when no new meaningful developments have occurred.

### 3. User Authentication & Multi-Watchlist Management
- **JWT Session Security**: Secure registration and login backed by `bcryptjs` password hashing (10 salt rounds) and Bearer JWT tokens.
- **Multi-Watchlist Support**: Create, rename, delete, and switch between multiple custom watchlists.
- **Stock Management**: Search the global stock catalog (e.g., TCS, INFY, RELIANCE, HDFCBANK, ICICIBANK, SBIN, TATAMOTORS, WIPRO) and add/remove stocks with instant UI updates.
- **User Isolation**: Full multi-tenant data isolation guaranteed at the database query layer.

### 4. Dual-Source Frontend Architecture
- **Market State**: `GET /api/watchlists/:id/intelligence` keeps live prices and trading volumes fresh.
- **Check Result State**: `POST /api/watchlists/:id/check` acts as the persistent source of truth for alert classifications and deltas.
- Background intelligence refreshes will never overwrite or erase your active "Since you last checked" alerts until you explicitly check again.

### 5. Standalone Market Event Generator (CLI)
A standalone CLI utility (`backend/src/tools/market-chaos.ts`) allows developers and evaluators to inject synthetic market observations directly into the database without touching application business logic.

Supported scenarios:
- `price-up`: Bullish price surge ($+3.5\%$ to $+6.0\%$) $\rightarrow$ triggers `NEEDS_ATTENTION`.
- `price-down`: Sharp selloff ($-3.5\%$ to $-6.0\%$) $\rightarrow$ triggers `NEEDS_ATTENTION`.
- `volume-spike`: Institutional volume surge ($2.1\times$ to $3.5\times$) $\rightarrow$ triggers `WORTH_WATCHING`.
- `price-and-volume`: High-conviction momentum ($+3.5\%$ to $+6.0\%$ price and $2.0\times+$ volume) $\rightarrow$ triggers `NEEDS_ATTENTION`.
- `stable`: Minor market fluctuation ($\pm 0.1\%$ to $\pm 0.5\%$) $\rightarrow$ `NO_MEANINGFUL_CHANGE`.

---

## API Endpoints Overview

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | System health and PostgreSQL dependency status |
| `POST` | `/api/auth/register` | No | Register a new user account (`email`, `password`) |
| `POST` | `/api/auth/login` | No | Authenticate user and receive JWT token |
| `GET` | `/api/auth/me` | Yes | Get authenticated user identity |
| `GET` | `/api/watchlists` | Yes | List all watchlists owned by the user |
| `POST` | `/api/watchlists` | Yes | Create a new watchlist (`name`) |
| `GET` | `/api/watchlists/:id` | Yes | Retrieve watchlist metadata and member stocks |
| `DELETE` | `/api/watchlists/:id` | Yes | Delete a watchlist (cascades memberships and check state) |
| `POST` | `/api/watchlists/:id/stocks` | Yes | Add a stock to a watchlist (`stockId`) |
| `DELETE` | `/api/watchlists/:id/stocks/:stockId` | Yes | Remove a stock from a watchlist |
| `POST` | `/api/watchlists/:id/check` | Yes | **Core**: Check for meaningful changes since last checkpoint |
| `GET` | `/api/watchlists/:id/intelligence` | Yes | Live market prices, summary metrics, and latest snapshot state |
| `GET` | `/api/stocks` | No | Global stock catalog lookup with search (`?q=...`) |
| `GET` | `/api/stocks/:stockId/market` | No | Latest market observation for a specific stock |
| `GET` | `/api/stocks/:stockId/change` | No | Pairwise change detection across 2 latest snapshots |
| `POST` | `/api/market/simulate` | Dev | Deterministic scenario generator (disabled in production) |

---

## Prerequisites

- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher
- **PostgreSQL**: `v14.x` or higher running locally on port `5432`

---

## Getting Started

### 1. Install Dependencies
Install all workspace dependencies from the root directory:
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` in the project root:
```bash
copy .env.example .env
```

Review the `.env` settings:
```env
NODE_ENV=development
BACKEND_PORT=3000

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=market_watchlist
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_TEST_DB=market_watchlist_test

JWT_SECRET=dev-jwt-secret-key-32chars-minimum-for-hackathon
```

### 3. Initialize the Database
Run the non-destructive, idempotent database migration:
```bash
npm run db:init
```
*(Creates tables, indexes, constraints, seed catalog, and default development account `dev@example.com` / `password123`)*

---

## Running the Application

### Start Development Servers
Run both backend and frontend concurrently:
```bash
npm run dev
```
Or start individually:
```bash
# Terminal 1 (Backend on http://localhost:3000)
npm run dev:backend

# Terminal 2 (Frontend on http://localhost:5173)
npm run dev:frontend
```

### Open the Application
Navigate to `http://localhost:5173` in your browser.
- Use **🚀 Demo Login (Instant Access)** or sign in with `dev@example.com` / `password123`.

---

## Verification & Testing

### 1. Run Automated Test Suite
Executes 160 tests across 14 test suites covering authentication, user isolation, change detection, checkpoint transactions, intelligence aggregation, and CLI chaos generation:
```bash
npm run test
```

### 2. Run TypeScript Typechecks
Validates strict TypeScript types across both frontend and backend:
```bash
npm run typecheck
```

### 3. Build for Production
Compiles the backend TypeScript into `backend/dist` and builds the optimized frontend bundle into `frontend/dist`:
```bash
npm run build
```

### 4. Run Production Backend
Starts the compiled Node backend from `backend/dist/server.js`:
```bash
npm run start --workspace=backend
```

---

## Generating Market Events (CLI)

Simulate live market events using the standalone chaos generator:

```bash
# Price surge (+4.8%) on HDFCBANK -> Triggers NEEDS_ATTENTION
npm run market:random -- HDFCBANK price-up

# Price drop (-5.2%) on HDFCBANK -> Triggers NEEDS_ATTENTION
npm run market:random -- HDFCBANK price-down

# Volume surge (3.0x) on ICICIBANK -> Triggers WORTH_WATCHING
npm run market:random -- ICICIBANK volume-spike

# Combined price + volume surge on TCS -> Triggers NEEDS_ATTENTION
npm run market:random -- TCS price-and-volume

# Minor fluctuations on RELIANCE -> NO_MEANINGFUL_CHANGE
npm run market:random -- RELIANCE stable
```

After generating an event, return to the browser and click **"Check for Changes"** to observe how Market Watch detects, classifies, and prioritizes the event.

---

## Production Deployment Notes

1. **Environment Variables**:
   - Set `NODE_ENV=production`.
   - Explicitly supply a cryptographically secure `JWT_SECRET` (minimum 32 characters). In production mode, the backend will refuse to start if `JWT_SECRET` is missing.
   - Configure production PostgreSQL credentials (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`).
2. **Frontend Hosting & Base URL**:
   - If deploying the frontend and backend to separate domains, set `VITE_API_BASE_URL=https://your-backend-api.com` before building the frontend bundle (`npm run build`).
3. **Database Migrations**:
   - Run `npm run db:init` during deployment to ensure all required tables and indexes exist. It is safe, non-destructive, and idempotent.
4. **Health Monitoring**:
   - Configure container/load balancer health checks against `GET /health` (returns HTTP `200` with PostgreSQL status or `503` if degraded).
