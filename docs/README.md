# OrbitHub documentation

| Area | Document |
| --- | --- |
| Product scope | [product/scope.md](product/scope.md) |
| Pending from the owner | [pending-from-owner.md](pending-from-owner.md) |
| Architecture | [architecture/overview.md](architecture/overview.md) |
| API conventions | [architecture/api-conventions.md](architecture/api-conventions.md) |
| Auth | [architecture/auth.md](architecture/auth.md) |
| Offline & sync | [architecture/offline-sync.md](architecture/offline-sync.md) |
| Data model | [architecture/data-model.md](architecture/data-model.md) |
| Design system | [architecture/design-system.md](architecture/design-system.md) |
| Notes editor | [architecture/notes-editor.md](architecture/notes-editor.md) |
| ADRs | [architecture/adr/](architecture/adr/) |
| Roadmap | [roadmap.md](roadmap.md) |
| Legacy migration (future) | [migration/legacy-migration.md](migration/legacy-migration.md) |
| Security & secrets | [security/secrets.md](security/secrets.md) |

## How to read this

- **Decisions** live in `architecture/adr/`. Each ADR records the context, the choice and the
  consequences. Superseding an ADR means adding a new file, not editing history.
- **Designs** (auth, sync, data model) describe how the system behaves today. When code and a
  design document disagree, the code is wrong until proven otherwise.
- **Scope** is the product contract: what is in the MVP, what is later, what is out.

## Current status

Phase 0/1 of the [roadmap](roadmap.md) is implemented: monorepo, design system, app shell,
local outbox, API skeleton and CI. Everything else is specified but not built yet.
