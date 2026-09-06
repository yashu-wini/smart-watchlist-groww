# Shared Contracts and Data Flow

This document outlines the conventions and guidelines for shared contracts across the Smart Market Watchlist services.

---

## Purpose

Cross-component communication in the Smart Market Watchlist involves:
1. **Synchronous HTTP APIs**: REST endpoints between React frontend and Express backend.
2. **PostgreSQL Relational Storage**: Normalized schemas for user authentication, watchlists, market snapshots, and checkpoint watermarks.

## Conventions for Shared Contracts

- All shared types, interfaces, and schemas will be located under `shared/contracts/`.
- Types should be defined using TypeScript and validated at boundaries.
- Avoid circular dependencies between packages by importing contracts strictly into consumer packages (`backend/`, `frontend/`).
