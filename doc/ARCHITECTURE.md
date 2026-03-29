# Architecture Documentation

Welcome to the Home4You API architecture documentation. This directory contains detailed diagrams and descriptions of the system's data models and business logic flows.

## Core Principles

As outlined in [GEMINI.md](../GEMINI.md), this project follows several core architectural principles:

- **Mobile First:** Optimized for low-bandwidth and high-latency mobile environments.
- **Stateless API:** Leveraging Redis for session management to allow horizontal scaling.
- **Security:** Argon2 hashing, JWT for access tokens, and database-backed refresh tokens for secure session rotation.
- **Performance:** Lean MongoDB queries and functional composition.

## Documentation Index

### 1. Data Models (ERD)

The Entity Relationship Diagram (ERD) provides a high-level view of the database schema and the relationships between different entities.

- [Database ERD](./ERD/DATABASE_ERD.md)

### 2. Business Logic Flows (Sequence Diagrams)

Sequence diagrams help visualize the interaction between different components (Controllers, Services, Models, and External Systems like Redis/Mailers).

- **Authentication Flows:**
  - [User Registration](./SD/AUTH_REGISTRATION.md)
  - [User Login](./SD/AUTH_LOGIN.md)
  - [Token Refresh](./SD/AUTH_REFRESH.md)
- **User Management:**
  - [User Profile Management](./SD/USER_PROFILE.md)
  - [Password Recovery](./SD/PASSWORD_FORGET.md)

---

_Last updated: March 29, 2026_
