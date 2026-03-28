# Project: Home4You (Mobile API)

## General Instructions

- **Documentation:** Always write JSDoc comments for controllers and middleware to explain the logic flow.
- **Mobile First** : The API is mobile-first.

## Coding Style

- **Indentation:** Use 2-space indentation.
- **Syntax:** Use semicolons.
- **Patterns:** Prefer functional composition and middleware chains over bloated classes.
- **Naming:** Use `camelCase` for functions and variables; `PascalCase` for Types and Interfaces.

## Tech Stack

- **Runtime:** Node.js (TypeScript)
- **Framework:** Express.js
- **Database:** MongoDB (Mongoose)
- **Caching:** Redis (For session storage and rate-limiting)
- **Validation:** Zod (For schema-based request validation)

## Constraints

- **Performance:** No heavy `.populate()` calls in MongoDB; use lean queries (`.lean()`) to keep the RAM footprint low and response times snappy.
- **Scalability:** The API must be stateless. Use Redis for all session data so we can horizontal scale.
- **Security:** Use `helmet` and `cors` with a strict whitelist. Salt and hash all sensitive data with Argon2.
- **Data Integrity:** Do not use `float` for currency; use `ints` (cents/smallest unit) to avoid precision errors.
