# Architectural Decisions

This document records the foundational architectural decisions made for the Smart Market Watchlist project.

---

### Decision 1: Use a Monorepo
**Context & Decision:** Organize frontend, backend, and shared contracts within a single repository using npm workspaces.  
**Reason:** Coordinated versioning, unified tooling, and simplified local development workflows.

---

### Decision 2: Use TypeScript
**Context & Decision:** Standardize on strict TypeScript across all codebases.  
**Reason:** Provides end-to-end type safety and compile-time verification across database queries and application interfaces.

---

### Decision 3: Direct Local Execution (No Docker)
**Context & Decision:** Run services (PostgreSQL, Node backend, Vite frontend) directly on the host machine without Docker.  
**Reason:** Simplifies local development without container virtualization overhead or container daemon dependencies.

---

### Decision 4: Use PostgreSQL for Persistent Application State
**Context & Decision:** Select PostgreSQL as the primary relational database with direct `pg` connection pooling.  
**Reason:** Provides ACID compliance, foreign key integrity with cascading deletions, and unique constraint enforcement.

---

### Decision 5: Exclude External Market APIs and Real-Time Feeds in Phase 2
**Context & Decision:** Exclude external market feeds and real-time streaming until the data model and core APIs are finalized.  
**Reason:** Keeps the database foundation isolated, robust, and independently testable.

---

### Decision 6: On-Demand Checkpoint Watermarks (No Background Polling / WebSockets)
**Context & Decision:** Implement "Since You Last Checked" semantics using explicit database transactions (`watchlist_check_state`) triggered on-demand by the user rather than background polling workers or WebSockets.  
**Reason:** Eliminates battery drain, connection dropouts, and complex distributed state while aligning with the investor workflow of deliberate check-in moments.

---

### Decision 7: Dual-Source Frontend State Separation
**Context & Decision:** Decouple `currentMarketData` (`GET /intelligence`) and `latestCheckResult` (`POST /check`) in frontend state.  
**Reason:** Prevents subsequent market quote refreshes from clearing or overwriting newly detected attention alerts before the user performs another check.
