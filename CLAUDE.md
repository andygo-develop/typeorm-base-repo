# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # compile src/ → dist/ (tsc)
npm run clean          # rm -rf dist
npm run lint           # eslint with zero warnings allowed
npm run lint:fix       # eslint --fix
npm test               # jest (all specs under tests/)
npm run test:watch     # jest --watch
npm run test:cov       # jest --coverage
```

Run a single test file:
```bash
npx jest tests/base.repository.spec.ts
```

Run a single test by name:
```bash
npx jest -t "soft delete scopes"
```

Release workflow:
```bash
npm run bump:patch      # bump version (no tag/commit)
npm run bump:minor
npm run bump:major
npm run publish         # publish to npm (runs clean + build via prepublishOnly)
```

Or use `npm version patch/minor/major` directly — `preversion` runs lint + test + build, `postversion` pushes tags and publishes.

## Architecture

This is a published npm package (`@andygo.dev/typeorm-base-repo`). The public API is entirely in `src/index.ts`.

### Core class: `BaseRepository<Entity>`

`src/repositories/base.repository.ts` — extends TypeORM's `Repository<Entity>`. The central design is **scope chaining**: each `createScoped()` / `createScopedBy()` call returns a new `BaseRepository` instance (via `Object.create(this)`) with an independent `SelectQueryBuilder` stored in a `WeakMap<repo, qb>` (`scopesMap`). The original repo is never mutated.

Built-in scoped getters: `withArchived`, `archivedOnly`, `withoutVirtual`.

Key methods:
- `find` / `findOne` / `findBy` / `count` / `exists` / `findAndCount` — all respect the accumulated scope
- `findOneOrFail` / `findOneByOrFail` — throw `NotFoundException` (with optional `notFoundErrorMessage`) or TypeORM's `EntityNotFoundError`
- `findGenerator` / `findBatchGenerator` — async generators for batched iteration; default ascending by `id`
- `deleteBy` — issues `DELETE WHERE id IN (subquery)` to avoid loading rows first
- `wrapWithSubquery: true` on `find` — rewrites `WHERE id IN (SELECT id ... LIMIT N)` to fix TypeORM's join + pagination bug
- `setManyToManyItems` / `attachManyToManyItems` / `deattachManyToManyItems` — M2M join-table helpers
- `attachOneToMany` / `deattachOneToMany` — O2M FK helpers
- `mergeDeep` / `mergeJsonb` — structural merges that keep TypeORM's change tracking intact
- `loadRelations` — custom relation loader used by `findCached` to support per-relation `responseCache`

Response caching (`responseCache: { id, ttl, relations }`) is opt-in on any find/count call. Cache is keyed by explicit `id` or falls back to the full SQL string. `findAndCount` auto-suffixes the id with `#find` / `#count`.

`getUniqQueryAndParameters` rewrites parameter names to globally unique ones (using `uniqParamCounter` in `src/functions.ts`) so sub-queries can be composed without parameter collisions.

### `RepositoryFor` mixin factory

At the bottom of `base.repository.ts`, `RepositoryFor(entityClass, alias?, scopeOptions?)` returns an `@Injectable()` class whose constructor takes `@InjectRepository(entityClass)`. Subclass it to add domain scopes and methods. Can also be `new`-d directly outside of NestJS DI.

### Entity base: `BaseMethodsEntity`

`src/entities/base-methods.entity.ts` — implements `IDbEntity` (brand interface requiring `id: number` and `__interfaceName: 'IDbEntity'`). Provides:
- `clone(deep?, selector?, map?)` — deep clone removing `id` for persisting new rows; handles cycles and FK column cleanup via `unsetForeignKeyColumn`
- `duplicate(map?)` — in-memory copy preserving `id` for dirty diffing; handles cycles
- `merge(data)` — shallow `Object.assign`
- `static extraSelect` — any entity class (not just `BaseMethodsEntity` subclasses) can declare `static extraSelect = { columnName: true }` to inject additional column expressions into every `find`. The `properties` getter reads `(<any>metadata.target).extraSelect` at runtime. The canonical use is pairing a TypeORM `@VirtualColumn` with this static so the computed column is auto-selected.

### `BaseSubscriber` (stub)

`src/entities/base.subscriber.ts` — an `@EventSubscriber()` + `@Injectable()` scaffold. The `afterLoad` hook body is currently empty. Include it as a NestJS provider if you need lifecycle hooks on entities; extend the `afterLoad` body to add behavior.

### `InSubQuery` operator

`src/operators/in-sub-query.ts` — takes a `BaseRepository` and returns a TypeORM `FindOperator` that produces `col IN (SELECT id FROM ...)`. Used internally by `deleteBy` and `find`'s `wrapWithSubquery` path.

### Tests

`tests/` uses `sql.js` (in-memory SQLite via TypeORM's `sqljs` driver) — no external database required. Each spec calls `createTestDataSource()` which resets the schema before every test. `seed()` in `tests/helpers.ts` creates a standard fixture of users, posts, and tags.

Test entity definitions are in `tests/entities.ts` (not shipped in `dist`). Example entities for documentation live in `src/examples/` and are excluded from test runs but included in the build.

### TypeScript config

`tsconfig.json` compiles only `src/` → `dist/`. `tsconfig.test.json` extends it to include `tests/`. `strict` and `strictNullChecks` are both **off**; `experimentalDecorators` and `emitDecoratorMetadata` are **on** (required for TypeORM decorators).
