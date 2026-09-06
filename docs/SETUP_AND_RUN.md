# Smart Market Watchlist — Setup & Run Guide

Welcome to the **Smart Market Watchlist** setup and run guide. This document provides complete, step-by-step instructions for getting the application running locally from scratch, verifying the database, executing the test suite, and walking through a full end-to-end product demonstration.

---

## 1. Prerequisites

Before setting up the project, ensure you have the following software installed on your machine:

- **Node.js**: `v20.x` or higher ([Download Node.js](https://nodejs.org/))
- **npm**: `v10.x` or higher (bundled with Node.js)
- **PostgreSQL**: `v14.x` or higher running locally on port `5432` ([Download PostgreSQL](https://www.postgresql.org/download/))
- **Git**: Installed and available in your terminal path

> [!NOTE]
> **No External Infrastructure Required**: Docker, Redis, Kafka, Redpanda, and background worker daemons are **NOT** required. The system runs directly on your local machine using Node.js and PostgreSQL.

---

## 2. Clone Repository

Clone the project repository to your local workspace and navigate into the project directory:

```bash
git clone https://github.com/yashu-wini/smart-watchlist-groww.git
cd smart-watchlist-groww
```

---

## 3. Install Dependencies

The project is structured as an npm monorepo workspaces project. Run `npm install` from the **root** directory to install all dependencies for both backend and frontend:

```bash
npm install
```

This installs:
- Root workspace tooling
- Backend dependencies (`express`, `pg`, `bcryptjs`, `jsonwebtoken`, `vitest`, `tsx`, `typescript`)
- Frontend dependencies (`react`, `react-dom`, `vite`, `@vitejs/plugin-react`)

---

## 4. PostgreSQL Database Setup

### Step 1: Ensure PostgreSQL Service is Running
Make sure your local PostgreSQL service is started:
- **Windows**: Check `Services` app and verify `postgresql-x64-<version>` is running.
- **macOS (Homebrew)**: `brew services start postgresql@16`
- **Linux**: `sudo systemctl start postgresql`

### Step 2: Create Databases
Open your terminal (or PostgreSQL `psql` shell) and create the primary database and the automated test database:

```sql
CREATE DATABASE market_watchlist;
CREATE DATABASE market_watchlist_test;
```

*(You can execute this in `psql` using: `psql -U postgres -c "CREATE DATABASE market_watchlist;"`)*

---

## 5. Environment Configuration

### Step 1: Copy Environment Example
Create your local `.env` configuration file by copying `.env.example` in the root directory:

```bash
# Windows Command Prompt / PowerShell
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

### Step 2: Configure Environment Variables
Open `.env` in your code editor and verify the database connection settings:

```env
# Application Environment
NODE_ENV=development
BACKEND_PORT=3000

# PostgreSQL Primary Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=market_watchlist
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# PostgreSQL Test Database (used for automated test suite)
POSTGRES_TEST_DB=market_watchlist_test

# Authentication Secret (development default)
JWT_SECRET=dev-jwt-secret-key-32chars-minimum-for-hackathon
```

> [!IMPORTANT]
> **Security Rule**: Never commit `.env` files containing private credentials into version control. The repository's `.gitignore` automatically ignores `.env` and local environment files.

---

## 6. Database Initialization

Run the automated database schema initialization:

```bash
npm run db:init
```

### What `npm run db:init` Does:
1. Executes `backend/src/infrastructure/schema.sql` to create all required tables (`users`, `watchlists`, `stocks`, `watchlist_stocks`, `market_snapshots`, `watchlist_check_state`).
2. Creates performance indexes and relational constraints (`ON DELETE CASCADE`).
3. Seeds the canonical stock catalog (`TCS`, `INFY`, `RELIANCE`, `HDFCBANK`, `ICICIBANK`, `SBIN`, `TATAMOTORS`, `WIPRO`).
4. Seeds a default development user account:
   - **Email**: `dev@example.com`
   - **Password**: `password123`

> [!NOTE]
> `npm run db:init` is **idempotent and non-destructive**. It uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING / DO UPDATE`. Running it will not drop or wipe existing user data.

---

## 7. Verify Database State

To inspect the database tables, stock catalog, watchlists, and market snapshot watermarks from your terminal, run:

```bash
npm run db:status
```
*(or `npm run db:inspect`)*

Expected output:
```
================================================================
📊 LIVE DATABASE INSPECTION (market_watchlist)
================================================================
--- [0. USERS] ---
--- [1. STOCKS CATALOG] (Total: 8) ---
--- [2. WATCHLISTS] ---
--- [3. WATCHLIST MEMBERSHIPS] ---
--- [4. "SINCE YOU LAST CHECKED" WATERMARKS] ---
--- [5. RECENT MARKET SNAPSHOTS] ---
================================================================
```

### Optional: Read-Only SQL Inspection
You can also inspect tables directly using `psql`:
```sql
psql -U postgres -d market_watchlist -c "SELECT id, symbol, company_name, exchange FROM stocks;"
psql -U postgres -d market_watchlist -c "SELECT id, name, user_id FROM watchlists;"
```

---

## 8. Start Backend Service

Start the backend API in watch mode:

```bash
npm run dev:backend
```

Expected terminal output:
```
[Server] Smart Market Watchlist Backend running in "development" mode on port 3000
[Server] Health endpoint: http://localhost:3000/health
```

### Verify Backend Health
Open a browser or run curl to test the liveness endpoint:
```bash
curl http://localhost:3000/health
```
Expected response (`HTTP 200`):
```json
{
  "status": "ok",
  "service": "backend",
  "dependencies": {
    "postgres": "ok"
  }
}
```

---

## 9. Start Frontend Application

In a **separate terminal window**, start the Vite frontend development server:

```bash
npm run dev:frontend
```

Expected terminal output:
```
  VITE v5.2.11  ready in 180 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open your browser and navigate to:
👉 **`http://localhost:5173`**

*(Alternatively, you can run both servers concurrently using `npm run dev` from the project root).*

---

## 10. First Login & Account Creation

When you open `http://localhost:5173`, the authentication screen is displayed:

### Option A: Instant Demo Login
Click the **🚀 Demo Login (Instant Access)** button.  
This automatically signs in as the seeded developer user (`dev@example.com` / `password123`).

### Option B: Create a New Account
1. Click the **Create Account** tab.
2. Enter your email (e.g. `user@example.com`) and a password (minimum 8 characters).
3. Confirm the password and click **Create Account**.
4. You are automatically authenticated and redirected to your private dashboard.

### Sign Out
Click the **Sign out** button in the top right corner of the header to end your session.

---

## 11. Creating & Managing a Watchlist

1. **Create Watchlist**:
   - In the header, click the watchlist dropdown selector $\rightarrow$ click **+ New Watchlist**.
   - Enter a name (e.g. `"Banking & Tech"`) and click **Create Watchlist**.
2. **Add Stocks**:
   - In the **Manage Stocks** modal that opens, search for symbols (e.g. `HDFCBANK`, `ICICIBANK`, `TCS`, `RELIANCE`).
   - Click **+ Add** next to each stock.
   - Click **Done**.
3. **View Instruments**:
   - Monitored stocks are now listed in your dashboard.

---

## 12. Understanding the First Check

When you view a newly created watchlist, notice the header message:

> **"You're seeing your current market snapshot."**  
> *"Check now to set your baseline. When you return later, Market Watch will highlight what changed."*

### Why this happens:
- The very first check **establishes your personal baseline**.
- It records the current highest observation timestamp in `watchlist_check_state`.
- It does **not** falsely report historical data as new alerts.
- Click **"Check for Changes"** $\rightarrow$ the system records your baseline and displays *"Baseline established. Future price and volume changes will be compared against this checkpoint."*

---

## 13. Demonstrating Market Events (CLI)

To simulate live market developments without waiting for real market hours, use the standalone developer CLI utility:

```bash
npm run market:random -- <symbol> <event-type>
```

### Supported Event Types

| Event Type | Command Example | Intended Demonstration | Expected Priority Tier |
| :--- | :--- | :--- | :--- |
| `price-up` | `npm run market:random -- HDFCBANK price-up` | Bullish breakout ($+3.5\%$ to $+6.0\%$) | 🔴 **Needs Attention** |
| `price-down` | `npm run market:random -- HDFCBANK price-down` | Sharp selloff ($-3.5\%$ to $-6.0\%$) | 🔴 **Needs Attention** |
| `volume-spike` | `npm run market:random -- ICICIBANK volume-spike` | Institutional surge ($2.1\times$ to $3.5\times$) | 🟡 **Worth Watching** |
| `price-and-volume` | `npm run market:random -- TCS price-and-volume` | High-conviction momentum ($+5\%$ price, $2.5\times$ vol) | 🔴 **Needs Attention** |
| `stable` | `npm run market:random -- RELIANCE stable` | Normal fluctuation ($\pm 0.3\%$) | 🟢 **Stable** |

> [!IMPORTANT]
> `npm run market:random` writes an observation directly to PostgreSQL. It **does not** automatically refresh the browser. The user must click **"Check for Changes"** to trigger the comparison against their checkpoint watermark.

---

## 14. Full 5-Minute Product Demonstration Walkthrough

Follow this scripted walkthrough to demonstrate all core capabilities of Market Watch:

### Step 1: Sign in & Set Baseline
1. Open `http://localhost:5173` and click **Demo Login**.
2. Select or create a watchlist containing `HDFCBANK`, `ICICIBANK`, and `TCS`.
3. Click **"Check for Changes"** to establish your baseline.

### Step 2: Trigger a Volume Spike (Worth Watching)
1. Open your terminal and run:
   ```bash
   npm run market:random -- ICICIBANK volume-spike
   ```
2. Return to the browser and click **"Check for Changes"**.
3. **Observation**:
   - `Worth Watching` metric increases to `1`.
   - `ICICIBANK` appears under **🟡 Worth Watching**.
   - Explanation badge states: *"Unusual increase in trading volume"*.

### Step 3: Trigger a Price Surge (Needs Attention)
1. In your terminal, run:
   ```bash
   npm run market:random -- HDFCBANK price-up
   ```
2. In the browser, click **"Check for Changes"**.
3. **Observation**:
   - `Needs Attention` metric increases to `1`.
   - `HDFCBANK` appears under **🔴 Needs Attention** with a green `+X.XX%` badge.
   - Explanation badge states: *"Significant price movement"*.

### Step 4: Trigger High-Conviction Momentum (Price + Volume)
1. In your terminal, run:
   ```bash
   npm run market:random -- TCS price-and-volume
   ```
2. Click **"Check for Changes"**.
3. **Observation**:
   - `TCS` appears under **🔴 Needs Attention**.
   - Explanation badge states: *"Significant price movement combined with a volume spike"*.

### Step 5: All Caught Up Verification
1. Click **"Check for Changes"** again without generating any new events.
2. **Observation**:
   - `Needs Attention = 0`, `Worth Watching = 0`.
   - Banner displays: *"You're all caught up."*
   - All instruments are listed under **Stable**.

---

## 15. Positive & Negative Price Movements

Both upward surges and downward drops qualify as meaningful changes because the detection engine evaluates the **absolute magnitude** of price movement:

$$|\Delta P\%| \ge 3.0\%$$

- **`price-up`** (`+4.8%`): Displays in green with an upward arrow ($\uparrow$).
- **`price-down`** (`-5.3%`): Displays in red with a downward arrow ($\downarrow$).
- Both trigger the `NEEDS_ATTENTION` priority tier.

---

## 16. Multi-Stock Batch Demonstration

You can inject multiple market events across different instruments before checking:

```bash
npm run market:random -- ICICIBANK volume-spike
npm run market:random -- RELIANCE price-up
npm run market:random -- TCS price-and-volume
```

Then click **"Check for Changes"** once in the browser. Market Watch will simultaneously categorize:
- `RELIANCE` and `TCS` under **🔴 Needs Attention**.
- `ICICIBANK` under **🟡 Worth Watching**.
- All other unchanged instruments under **🟢 Stable**.

---

## 17. Multi-User Isolation Verification

To verify that watchlists and checkpoints are strictly isolated between users:

1. **User A**: Sign in as `dev@example.com`, create a watchlist `"Alpha Fund"`, and add `TCS`.
2. **User B**: Sign out, click **Create Account**, register `investor@example.com`, and log in.
3. Observe that `investor@example.com` sees **0 watchlists** and cannot view `"Alpha Fund"`.
4. Create a new watchlist `"Beta Fund"` under User B.
5. Sign out and log back in as `dev@example.com`.
6. Verify `"Alpha Fund"` and its checkpoints remain intact and private.

---

## 18. Data Persistence Verification

To verify full PostgreSQL relational persistence:
1. Add stocks to a watchlist and click **Check for Changes**.
2. Refresh your browser window (`F5` or `Cmd+R`).
3. Sign out and sign back in.
4. Verify all watchlists, member stocks, live prices, and checkpoints are restored from PostgreSQL without data loss.

---

## 19. API Quick Reference

| Method | Endpoint | Auth | Purpose |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | Liveness and PostgreSQL connectivity check |
| `POST` | `/api/auth/register` | No | Create new user account |
| `POST` | `/api/auth/login` | No | Login and obtain Bearer JWT |
| `GET` | `/api/auth/me` | Yes | Get authenticated user identity |
| `GET` | `/api/watchlists` | Yes | List authenticated user's watchlists |
| `POST` | `/api/watchlists` | Yes | Create new watchlist |
| `GET` | `/api/watchlists/:id` | Yes | Get watchlist details & stocks |
| `DELETE` | `/api/watchlists/:id` | Yes | Delete watchlist & associated check state |
| `POST` | `/api/watchlists/:id/stocks` | Yes | Add stock to watchlist |
| `DELETE` | `/api/watchlists/:id/stocks/:stockId` | Yes | Remove stock from watchlist |
| `POST` | `/api/watchlists/:id/check` | Yes | Check for changes since last checkpoint |
| `GET` | `/api/watchlists/:id/intelligence` | Yes | Read-only market quotes and summary |
| `GET` | `/api/stocks` | No | Search stock catalog (`?q=...`) |
| `GET` | `/api/stocks/:stockId/market` | No | Latest observation for stock |
| `GET` | `/api/stocks/:stockId/change` | No | Compare 2 latest stock snapshots |
| `POST` | `/api/market/simulate` | Dev | Simulated snapshot (disabled in production) |

---

## 20. Running Tests, Typecheck & Builds

### 1. Execute Automated Tests (160 Tests)
```bash
npm run test
```
Runs 14 Vitest test suites covering change detection math, attention classification, JWT auth, user isolation, checkpoint transactions, and CLI chaos generation.

### 2. Run TypeScript Typecheck
```bash
npm run typecheck
```
Validates strict TypeScript types across backend and frontend workspaces (`tsc --noEmit`).

### 3. Production Build
```bash
npm run build
```
Compiles backend TypeScript to `backend/dist` and builds the optimized frontend Vite bundle into `frontend/dist`.

### 4. Run Production Backend Bundle
```bash
npm run start --workspace=backend
```

---

## 21. Troubleshooting Guide

### Issue: `psql: command not found` or `psql is not recognized`
- **Cause**: PostgreSQL `bin` directory is not in your system `PATH`.
- **Solution**: Open the PostgreSQL GUI tool (**pgAdmin**) or use the **SQL Shell (psql)** installed with PostgreSQL, or add `C:\Program Files\PostgreSQL\<version>\bin` to your system Environment Variables.

### Issue: `ECONNREFUSED 127.0.0.1:5432`
- **Cause**: PostgreSQL service is not running or listening on port 5432.
- **Solution**: Start the PostgreSQL service via Windows Services or `brew services start postgresql`, and verify `POSTGRES_PORT=5432` in `.env`.

### Issue: `401 Unauthorized` / Redirect to Auth Screen
- **Cause**: The session JWT token is missing, expired, or invalid.
- **Solution**: Log in again using the Demo Login button or your registered credentials.

### Issue: `Port 3000 or 5173 already in use`
- **Cause**: Another process is occupying the backend or frontend port.
- **Solution**: 
  - On Windows: `netstat -ano | findstr :3000` $\rightarrow$ `taskkill /PID <PID> /F`
  - On macOS/Linux: `lsof -i :3000` $\rightarrow$ `kill -9 <PID>`

### Issue: Monitored Stock Shows "Market data unavailable"
- **Cause**: No market snapshot exists in the database for that stock yet.
- **Solution**: Run a quick market snapshot injection:
  ```bash
  npm run market:random -- <symbol> stable
  ```
  Then click **"Check for Changes"** in the browser.

---

## 22. Clean Shutdown

To stop the running application gracefully:
1. In the backend terminal window, press `Ctrl + C`.  
   *(The backend server will close HTTP connections and safely end the PostgreSQL pool).*
2. In the frontend terminal window, press `Ctrl + C`.

---

## 23. Resetting / Re-initializing the Database

- **Normal Re-run**: Running `npm run db:init` at any time is safe and non-destructive.
- **Complete Fresh Reset** (Optional): If you wish to completely wipe and recreate the database from scratch:
  ```sql
  DROP DATABASE market_watchlist;
  CREATE DATABASE market_watchlist;
  ```
  Then run:
  ```bash
  npm run db:init
  ```

---

## 24. Development vs Demo vs Production Scope

- **Local Development**: Node.js Express backend + Vite frontend + PostgreSQL database + deterministic snapshot simulator.
- **Demo Mode**: Standalone CLI chaos generator (`npm run market:random`) allowing live demonstration of priority classification tiers.
- **Production Scope**: Production deployment configuration (cloud infrastructure, hosting providers, reverse proxies) is outside the scope of this local setup guide.

---

## 25. Quick Start Summary

```bash
# 1. Clone repository
git clone https://github.com/yashu-wini/smart-watchlist-groww.git
cd smart-watchlist-groww

# 2. Install dependencies
npm install

# 3. Create .env configuration
copy .env.example .env

# 4. Initialize database schema & seed catalog
npm run db:init

# 5. Start application servers
npm run dev

# 6. Open browser
# URL: http://localhost:5173 (Click "🚀 Demo Login")

# 7. Inject demo market events (in another terminal)
npm run market:random -- HDFCBANK price-up
```
