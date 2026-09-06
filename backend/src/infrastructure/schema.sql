-- Smart Market Watchlist PostgreSQL Schema

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Watchlists Table
CREATE TABLE IF NOT EXISTS watchlists (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on watchlists(user_id) for efficient lookup by user
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);

-- 3. Stocks Table (Identity of financial instrument)
CREATE TABLE IF NOT EXISTS stocks (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    company_name VARCHAR(200) NOT NULL,
    exchange VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_symbol_exchange UNIQUE (symbol, exchange)
);

-- 4. Watchlist Stocks Table (Many-to-Many join table)
CREATE TABLE IF NOT EXISTS watchlist_stocks (
    watchlist_id BIGINT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (watchlist_id, stock_id)
);

-- Index on watchlist_stocks(stock_id) for reverse lookups
CREATE INDEX IF NOT EXISTS idx_watchlist_stocks_stock_id ON watchlist_stocks(stock_id);

-- 5. Market Snapshots Table (Time-series market observations)
CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,

    price NUMERIC(12, 2) NOT NULL,
    open_price NUMERIC(12, 2) NOT NULL,
    high_price NUMERIC(12, 2) NOT NULL,
    low_price NUMERIC(12, 2) NOT NULL,
    previous_close NUMERIC(12, 2) NOT NULL,

    volume BIGINT NOT NULL,

    market_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT check_positive_prices CHECK (
        price > 0 AND
        open_price > 0 AND
        high_price > 0 AND
        low_price > 0 AND
        previous_close > 0
    ),
    CONSTRAINT check_positive_volume CHECK (volume >= 0),
    CONSTRAINT check_high_low CHECK (high_price >= low_price)
);

-- Composite index for fast retrieval of latest market snapshot by stock_id
CREATE INDEX IF NOT EXISTS idx_market_snapshots_stock_time
ON market_snapshots(stock_id, market_time DESC);

-- 6. Watchlist Check State Table ("Since You Last Checked" tracking)
CREATE TABLE IF NOT EXISTS watchlist_check_state (
    watchlist_id BIGINT PRIMARY KEY REFERENCES watchlists(id) ON DELETE CASCADE,
    last_checked_at TIMESTAMPTZ NOT NULL,
    last_checked_market_time TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


