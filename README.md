# @andygo.dev/typeorm-base-repo

An enhanced TypeORM `Repository` base class with scoping, response caching,
batched iteration, sub-query operator, and many-to-many helpers.

Originally extracted from a NestJS + TypeORM production codebase.

## Install

```bash
npm install @andygo.dev/typeorm-base-repo
```

Peer dependencies:

- `typeorm` `^0.3.0`
- `@nestjs/common` `^10 || ^11` (used for `NotFoundException`)

`@nestjs/typeorm` is bundled as a runtime dependency and used by the
`RepositoryFor` mixin — no extra install needed.

Requires Node `>= 22.15` (uses `node:util.diff`).

## Quick start

Your entities must satisfy the `IDbEntity` brand. The simplest way is to extend
`BaseMethodsEntity`, which provides the brand, an `id` / `deletedAt` pair, an
`extraSelect` static, plus `clone()`, `duplicate()` and `merge()` helpers — see
the runnable example at [`src/examples/entities/user.entity.ts`](src/examples/entities/user.entity.ts):

```ts
import { Column, CreateDateColumn, Entity } from 'typeorm';
import { BaseMethodsEntity } from '@andygo.dev/typeorm-base-repo';

@Entity()
export class UserEntity extends BaseMethodsEntity {
  @Column()
  email: string;

  @Column({ default: 0 })
  age: number;

  @CreateDateColumn()
  createdAt: Date;
}
```

Or implement `IDbEntity` directly if you'd rather not pull in the base class:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IDbEntity } from '@andygo.dev/typeorm-base-repo';

@Entity()
export class User implements IDbEntity {
  __interfaceName: 'IDbEntity';

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  email: string;
}
```

### Create a Nest repository (recommended)

For a NestJS app, use the `RepositoryFor` mixin. One line gives you a fully
DI-wired repository class — see [`src/examples/repositories/users.repository.ts`](src/examples/repositories/users.repository.ts):

```ts
// users.repository.ts
import { Injectable } from '@nestjs/common';
import { RepositoryFor } from '@andygo.dev/typeorm-base-repo';

import { UserEntity } from '../entities/user.entity';

@Injectable()
export class UsersRepository extends RepositoryFor(UserEntity) {
  get seniors() {
    return this.createScopedBy({ age: MoreThan(60) });
  }
}
```

Register it in your module the usual way:

```ts
// users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from './entities/user.entity';
import { UsersRepository } from './repositories/users.repository';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
```

Then inject and use it — it has the full set of `RepositoryFor` features:

```ts
// users.service.ts
import { Injectable } from '@nestjs/common';

import { UsersRepository } from './repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  listActive() {
    const { seniors } = this.users;

    return seniors
      .find({ take: 50, order: { createdAt: 'DESC' } });
  }

  async getOrFail(id: number) {
    return this.users.findOneByOrFail({ id }, { notFoundErrorMessage: 'USER_NOT_FOUND' });
  }
}
```

Add domain-specific scopes or methods directly inside the subclass body:

```ts
@Injectable()
export class UsersRepository extends RepositoryFor(UserEntity) {
  get verified(): this {
    return this.createScoped({ where: { emailVerifiedAt: Not(IsNull()) } });
  }

  findByEmail(email: string) {
    return this.findOneBy({ email });
  }
}
```

### Or construct manually (no Nest DI required)

`RepositoryFor(Entity, alias?, scopeOptions?)` returns a class whose
constructor takes a plain TypeORM `Repository`, so you can `new` it directly
when you're outside a Nest DI container:

```ts
import { DataSource } from 'typeorm';
import { RepositoryFor } from '@andygo.dev/typeorm-base-repo';

const dataSource = new DataSource({ /* ... */ });
await dataSource.initialize();

// Second arg is the SQL alias ('u' here); third is seed scope options.
const UserRepoCtor = RepositoryFor(UserEntity, 'u');
const userRepo = new UserRepoCtor(dataSource.getRepository(UserEntity));

// Find with scoped options
const users = await userRepo.find({ where: { email: 'x@y.z' } });

// Batch pagination
for await (const batch of userRepo.findBatchGenerator({}, 500)) {
  // ...
}

// Soft-deleted entities
const allIncludingArchived = await userRepo.withArchived.find();
const archivedOnly = await userRepo.archivedOnly.find();
```

## Features

- **Scope chaining** — `withArchived`, `archivedOnly`, `withoutVirtual`, plus
  arbitrary `createScoped()` / `createScopedBy()`.
- **Response caching** — opt-in TTL-based cache keyed off the SQL when no `id`
  given. Per-relation caching is configured independently.
- **Streaming & batching** — `stream`, `findGenerator`, `findBatchGenerator`.
- **Sub-query operator** — `InSubQuery(repo)` produces a `WHERE id IN (...)`
  operator suitable for combining with `find`.
- **M2M helpers** — `setManyToManyItems`, `attachManyToManyItems`,
  `deattachManyToManyItems`, plus one-to-many counterparts.
- **`findOneOrFail`** — throws `NotFoundException` with optional custom message,
  otherwise TypeORM's `EntityNotFoundError`.

## Runnable examples in `src/examples/`

The repository ships a minimal Nest-flavoured demo under
[`src/examples/`](src/examples/):

| File | Demonstrates |
|---|---|
| [`entities/user.entity.ts`](src/examples/entities/user.entity.ts) | Entity extending `BaseMethodsEntity` |
| [`repositories/users.repository.ts`](src/examples/repositories/users.repository.ts) | One-line repository class using the `RepositoryFor` mixin |

The patterns from those files are also covered in the worked examples below
(notably **#1** for the entity and **#6** for the repository).

## Complex examples

### 1. Building a reusable scope chain

`createScoped` / `createScopedBy` return a new repo instance with the scope
applied. Chains compose — each call layers on top of the previous one — and the
original repo is left untouched.

```ts
const activeRecentlyEngaged = userRepo
  .createScopedBy({ status: 'active' })
  .createScoped({
    where: { lastLoginAt: MoreThan(thirtyDaysAgo) },
    order: { lastLoginAt: 'DESC' },
  });

// Reusable: the same chain can be queried multiple ways without rebuilding.
const list  = await activeRecentlyEngaged.find({ take: 50 });
const count = await activeRecentlyEngaged.count();
const exists = await activeRecentlyEngaged.exists({ where: { email: 'x@y.z' } });

// withArchived/archivedOnly compose too
const archivedActive = await userRepo.archivedOnly
  .createScopedBy({ status: 'active' })
  .find();
```

### 2. Response cache with per-relation TTLs

The query result cache supports a stable `id` plus a TTL per query. Relations
can be cached on their own schedule via `responseCache.relations`, which is
useful when a parent record changes far less often than its children.

```ts
// Cache the parent for 60s and the relations on their own schedules.
const profile = await userRepo.findOneOrFail({
  where: { id: 42 },
  relations: { posts: true, tags: true },
  responseCache: {
    id: `user:${42}:profile`,
    ttl: 60_000,
    relations: {
      posts: { id: `user:${42}:posts`, ttl: 30_000 },
      tags:  { ttl: 5 * 60_000 },
    },
  },
});

// findAndCount auto-suffixes the cache id so the count and the page
// share the prefix but get distinct cache entries.
const [page, total] = await userRepo.findAndCount({
  take: 20,
  skip: 0,
  responseCache: { id: 'users:page-1', ttl: 10_000 },
});
// cache entries are stored under: 'users:page-1#find' and 'users:page-1#count'
```

### 3. Filtering with a correlated sub-query (`InSubQuery`)

`InSubQuery` builds a `WHERE <col> IN (<sub-select>)` operator from any scoped
repo. It rewrites parameter names so it can be nested inside another query
without collisions.

```ts
import { InSubQuery } from '@andygo.dev/typeorm-base-repo';

// Find users who have at least one post with > 1000 views
const popularAuthorIds = postRepo
  .createScopedBy({ views: MoreThan(1000) })
  .select({ user: { id: true } });   // sub-query selects post.userId

const popularAuthors = await userRepo.findBy({
  id: InSubQuery(popularAuthorIds, { select: { user: { id: true } } as any }),
});

// deleteBy uses the same trick under the hood:
//   DELETE FROM "user" WHERE id IN (SELECT id FROM "user" WHERE ...)
await userRepo.deleteBy({ status: 'pending', createdAt: LessThan(cutoff) });
```

### 4. Batched iteration over large result sets

`findBatchGenerator` paginates a query into fixed-size arrays so you can stream
through a large result without holding the whole set in memory. It accepts any
`TFindOptions` (`where`, `relations`, `order`, …) and preserves them across
pages. `findGenerator` is the per-entity variant — same options, but yields one
row at a time rather than batches.

```ts
async function rebuildSearchIndex() {
  let processed = 0;

  for await (const batch of userRepo.findBatchGenerator(
    { where: { status: 'active' }, relations: { tags: true } },
    1_000,
  )) {
    await searchClient.bulkUpsert(batch.map(toIndexDocument));
    processed += batch.length;
    logger.info(`indexed ${processed} users`);
  }
}
```

### 5. Joined queries with safe pagination (`wrapWithSubquery`)

The classic TypeORM problem: `find` with joins + `take`/`skip` paginates by
*joined rows*, not parent rows. Setting `wrapWithSubquery: true` rewrites the
query as `WHERE id IN (SELECT id FROM ... LIMIT N OFFSET M)` so pagination
operates on the parent entity.

```ts
const page = await userRepo.find({
  relations: { posts: true, tags: true },
  order: { createdAt: 'DESC' },
  take: 20,
  skip: 40,
  wrapWithSubquery: true,   // <- parent-level pagination
});
```

### 6. Domain-specific repository with `RepositoryFor`

`RepositoryFor(entityClass, alias?, scopeOptions?)` is a class-mixin factory
that wires up `@InjectRepository(entityClass)` for you and returns a base
class. The optional second and third arguments bake a SQL alias and seed
scope options into every instance, so the subclass itself stays
constructor-free. Subclass the result and add project-specific scopes inside
the body — see [`src/examples/repositories/users.repository.ts`](src/examples/repositories/users.repository.ts):

```ts
import { Injectable } from '@nestjs/common';
import { RepositoryFor } from '@andygo.dev/typeorm-base-repo';

import { UserEntity } from '../entities/user.entity';

//                                              alias ─┐
@Injectable()
export class UsersRepository extends RepositoryFor(UserEntity, 'u') {
  // Reusable domain scope
  get verified(): this {
    return this.createScoped({ where: { emailVerifiedAt: Not(IsNull()) } });
  }

  // Returns a new repo; safe to chain with find/count/etc.
  withRecentActivity(since: Date): this {
    return this.createScopedBy({ lastLoginAt: MoreThan(since) });
  }

  async findOrFailByEmail(email: string): Promise<UserEntity> {
    return this.findOneByOrFail(
      { email },
      { notFoundErrorMessage: `USER_${email}_NOT_FOUND` },
    );
  }
}
```

`UsersRepository` is now a fully-featured repository for `UserEntity` — scope
chains, caching, `findOneOrFail`, M2M helpers, all of it.

Wire it into a module the usual Nest way:

```ts
// users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from './entities/user.entity';
import { UsersRepository } from './repositories/users.repository';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UsersRepository, UserService],
  exports: [UsersRepository],
})
export class UsersModule {}
```

Then inject and use it — chain the domain scopes you defined above:

```ts
const activeVerified = await this.users.verified
  .withRecentActivity(thirtyDaysAgo)
  .find({ take: 100 });
```

If you'd rather wire things up manually (no Nest DI), `new` the factory's
return value directly with a plain TypeORM `Repository`:

```ts
const UserRepoCtor = RepositoryFor(UserEntity, 'u');
const userRepo = new UserRepoCtor(dataSource.getRepository(UserEntity));
```

### 7. Many-to-many synchronisation patterns

`setManyToManyItems` replaces the entire set in a single transaction, which is
the common shape for PATCH-style endpoints (`{ tagIds: [1,4,7] }`). For
incremental adds, `attachManyToManyItems` is idempotent via `OR IGNORE` so it's
safe to call with overlap.

```ts
// Replace all tags atomically
await userRepo.setManyToManyItems(user, newTags, 'tags');

// Add a single tag without checking; duplicates are silently skipped
await userRepo.attachManyToManyItems(user, [premiumTag], 'tags');

// Remove a subset
await userRepo.deattachManyToManyItems(user, [trialTag], 'tags');

// O2M counterparts manipulate the FK on the child rows instead
await postRepo.attachOneToMany(user, [orphanPost], 'posts');
await postRepo.deattachOneToMany(user, [orphanPost], 'posts');
```

### 8. `mergeDeep` for JSONB-style updates

`mergeDeep` performs a structural deep merge that respects TypeORM's tracking,
so subsequent `save()` only writes columns that actually changed. Combine with
`mergeJsonb` when the column itself is a JSONB blob and you want to merge a
patch into it.

```ts
const user = await userRepo.findOneByOrFail({ id: 42 });

userRepo.mergeDeep(user, {
  email: 'new@example.com',
  preferences: { theme: 'dark' }, // existing keys preserved, theme overwritten
});

userRepo.mergeJsonb(user.preferences, {
  notifications: { email: true, push: false },
});

await userRepo.save(user);
```

### 9. Streaming with batched side effects

`findBatchGenerator` yields arrays; pair it with `Promise.all` (or a bounded
queue) when each row needs an async side effect, so you're not making one
round-trip per row.

```ts
for await (const batch of userRepo.findBatchGenerator({ where: { needsSync: true } }, 200)) {
  await Promise.all(batch.map(syncToHubspot));
  await userRepo.save(batch.map((u) => ({ ...u, needsSync: false })));
}
```

## API surface

Top-level exports:

- `RepositoryFor(entityClass, alias?, scopeOptions?)` — main entry point.
  A class-mixin factory that returns a fully-featured repository class with
  Nest's `@InjectRepository` pre-wired. Subclass the result to add domain
  methods, or `new` it directly with a TypeORM `Repository` when outside Nest.
- `BaseMethodsEntity` — opinionated base entity that satisfies `IDbEntity` and
  adds `clone()`, `duplicate()`, `merge()`, and FK-handling helpers.
- `IDbEntity` — branding interface for entities (if you'd rather not extend
  `BaseMethodsEntity`).
- `InSubQuery` — operator factory.
- `mergeDeepObjectsOnly` — deep merge utility used by `mergeDeep`.
- Types: `TFindOptions`, `TCreateScopedOptions`, `TOrFailOptions`,
  `TRepository`, `TResponseCache`, `TResponseCacheOptions`,
  `TResponseCacheRelations`, `TResponseCacheRelationsProperty`,
  `TEntityKeys`, `TEntityProperties`, `TEntityProperty`, `DeepKeys`.

## License

MIT
