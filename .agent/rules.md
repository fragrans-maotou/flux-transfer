# Agent Rules and Guidelines

## General Coding Standards
- **Language**: TypeScript (Strict Mode).
- **Style**: Use `async/await` over raw Promises where possible.
- **Formatting**: prettier (see `.prettierrc`).

## Architecture Principles
- **Framework Agnostic**: Core logic MUST NOT depend on React, Vue, or any UI framework.
- **Dependency-Free**: Minimize external runtime dependencies. Use native browser APIs (`IndexedDB`, `Worker`, `fetch`).
- **Performance**:
    - Heavy computations (hashing) must be offloaded to Web Workers.
    - Avoid blocking the main thread.

## Git & Version Control
- Commit messages should be descriptive.
- Create feature branches for major changes.

## Documentation
- Public methods must have JSDoc comments.
- Update `README.md` when API changes.

## Testing
- Maintain 100% type safety.
- Write unit tests for all core logic using Vitest.
