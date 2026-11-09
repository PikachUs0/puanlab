# Store Organization Guidelines

Conventions for Zustand stores in PuanLab. Every future store (topics, exams, ...) follows this shape.

## Structure

- One store per domain, one file per store: `src/store/<domain>Store.ts` (e.g. `profileStore.ts`).
- `src/store/index.ts` is the barrel — it re-exports each store hook and its public types.

## Shape of a store file

Each store file defines and exports:

- `<Domain>State` — the state fields.
- `<Domain>Actions` — the action functions.
- `<Domain>Store` — `State & Actions`.
- `initial<Domain>State` — a module-level constant holding the default values (kept internal unless needed elsewhere).
- `use<Domain>Store` — the store hook, created with `create<Store>()(...)`.
- `<domain>Selectors` — typed selector functions over the store state.

## Rules

- Always type the store with the curried form `create<Store>()(...)` so middleware (`persist`, `devtools`, ...) can be added later without touching call sites.
- Keep actions as plain, synchronous state updates. No fetching, no persistence, and no business logic inside the store.
- Do not import SQLite or repositories into stores. Persistence is wired separately at a later step (middleware or an explicit sync layer).
- Read state through selectors: `useProfileStore(profileSelectors.gradeLevel)`. Avoid selecting the whole store unless you truly need all of it — it causes needless re-renders.
- Stores are hooks: call them only inside React components or other hooks.
- Reuse the canonical domain types from `@/types` (e.g. `GradeLevel`, `ScoreType`) instead of re-declaring unions in the store.
- Keep naming consistent across domains: `useXxxStore`, `XxxState`, `XxxActions`, `XxxStore`, `xxxSelectors`.
