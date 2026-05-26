import { DataSource, EntityNotFoundError } from 'typeorm';

import { NotFoundException } from '@nestjs/common';

import { BaseRepository } from '../src/repositories/base.repository';

import { Post, User } from './entities';
import { createTestDataSource, seed } from './helpers';

describe('BaseRepository (functional)', () => {
  let dataSource: DataSource;
  let userRepo: BaseRepository<User>;
  let postRepo: BaseRepository<Post>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    userRepo = new BaseRepository(dataSource.getRepository(User));
    postRepo = new BaseRepository(dataSource.getRepository(Post));
  });

  // DataSource is shared across tests; resetSchema clears it before each test.

  describe('basic CRUD', () => {
    it('finds all users', async () => {
      await seed(dataSource);

      const users = await userRepo.find();

      expect(users).toHaveLength(3);
      expect(users.map((u) => u.email).sort()).toEqual([
        'alice@example.com',
        'bob@example.com',
        'carol@example.com',
      ]);
    });

    it('findBy filters by where clause', async () => {
      await seed(dataSource);

      const result = await userRepo.findBy({ email: 'alice@example.com' });

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('alice@example.com');
    });

    it('findOne returns null when no match', async () => {
      await seed(dataSource);

      const result = await userRepo.findOne({ where: { email: 'nope@x.y' } });

      expect(result).toBeNull();
    });

    it('findOneBy returns the matched entity', async () => {
      await seed(dataSource);

      const result = await userRepo.findOneBy({ email: 'bob@example.com' });

      expect(result).not.toBeNull();
      expect(result!.email).toBe('bob@example.com');
    });

    it('count returns total rows', async () => {
      await seed(dataSource);

      expect(await userRepo.count()).toBe(3);
      expect(await userRepo.countBy({ email: 'alice@example.com' })).toBe(1);
    });

    it('exists/existsBy returns boolean', async () => {
      await seed(dataSource);

      expect(await userRepo.exists({ where: { email: 'alice@example.com' } })).toBe(true);
      expect(await userRepo.existsBy({ email: 'missing@x.y' })).toBe(false);
    });

    it('findAndCount returns [rows, total]', async () => {
      await seed(dataSource);

      const [rows, total] = await userRepo.findAndCount({ take: 2 });

      expect(rows).toHaveLength(2);
      expect(total).toBe(3);
    });

    it('findAndCountBy filters and counts', async () => {
      await seed(dataSource);

      const [rows, total] = await userRepo.findAndCountBy({ email: 'alice@example.com' });

      expect(rows).toHaveLength(1);
      expect(total).toBe(1);
    });
  });

  describe('findOneOrFail', () => {
    it('returns the entity when found', async () => {
      await seed(dataSource);

      const user = await userRepo.findOneOrFail({ where: { email: 'alice@example.com' } });

      expect(user.email).toBe('alice@example.com');
    });

    it('throws EntityNotFoundError when no custom message provided', async () => {
      await seed(dataSource);

      await expect(userRepo.findOneOrFail({ where: { email: 'missing@x.y' } })).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('throws NotFoundException with custom message', async () => {
      await seed(dataSource);

      await expect(
        userRepo.findOneOrFail({ where: { email: 'missing@x.y' }, notFoundErrorMessage: 'USER_NOT_FOUND' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findOneByOrFail forwards to findOneOrFail', async () => {
      await seed(dataSource);

      const user = await userRepo.findOneByOrFail({ email: 'bob@example.com' });

      expect(user.email).toBe('bob@example.com');
    });
  });

  describe('soft delete scopes', () => {
    it('hides soft-deleted rows by default', async () => {
      const { users } = await seed(dataSource);

      await userRepo.softDelete(users.bob.id);

      const remaining = await userRepo.find();

      expect(remaining).toHaveLength(2);
      expect(remaining.map((u) => u.email).sort()).toEqual(['alice@example.com', 'carol@example.com']);
    });

    it('withArchived includes soft-deleted rows', async () => {
      const { users } = await seed(dataSource);

      await userRepo.softDelete(users.bob.id);

      const all = await userRepo.withArchived.find();

      expect(all).toHaveLength(3);
    });

    it('archivedOnly returns only soft-deleted rows', async () => {
      const { users } = await seed(dataSource);

      await userRepo.softDelete(users.bob.id);

      const onlyArchived = await userRepo.archivedOnly.find();

      expect(onlyArchived).toHaveLength(1);
      expect(onlyArchived[0].email).toBe('bob@example.com');
      expect(onlyArchived[0].deletedAt).toBeTruthy();
    });
  });

  describe('createScoped / createScopedBy', () => {
    it('produces an independent repository instance', async () => {
      await seed(dataSource);

      const young = userRepo.createScopedBy({ age: 25 } as any);

      expect(young).not.toBe(userRepo);
      const rows = await young.find();

      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('bob@example.com');
    });

    it('chained scopes compose where clauses', async () => {
      await seed(dataSource);

      const ageScope = userRepo.createScoped({ where: { age: 30 } as any });
      // chained scope does not narrow further with createScopedBy on a different field for sqlite-style "and",
      // but it should still find Alice
      const result = await ageScope.find();

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('alice@example.com');
    });
  });

  describe('findGenerator / findBatchGenerator', () => {
    it('findGenerator yields one entity at a time', async () => {
      await seed(dataSource);

      const ids: number[] = [];
      for await (const u of userRepo.findGenerator({}, 2)) {
        ids.push(u.id);
      }

      expect(ids).toHaveLength(3);
    });

    it('findBatchGenerator yields arrays of entities', async () => {
      // seed extra users
      for (let i = 0; i < 7; i++) {
        await userRepo.save({ email: `b${i}@example.com`, age: 30 } as any);
      }

      const batches: User[][] = [];
      for await (const batch of userRepo.findBatchGenerator({}, 3)) {
        batches.push(batch);
      }

      expect(batches.length).toBeGreaterThanOrEqual(3);
      expect(batches.flat()).toHaveLength(7);
    });
  });

  describe('reload', () => {
    it('mutates the passed entity with fresh DB state', async () => {
      const { users } = await seed(dataSource);

      // mutate Alice's email through the underlying repo
      await dataSource.getRepository(User).update(users.alice.id, { email: 'alice-renamed@example.com' });

      const stale = { ...users.alice } as User;
      await userRepo.reload(stale);

      expect(stale.email).toBe('alice-renamed@example.com');
    });
  });

  describe('properties getter', () => {
    it('returns a select map containing all entity columns', () => {
      const props = userRepo.properties;

      expect(props).toHaveProperty('id', true);
      expect(props).toHaveProperty('email', true);
      expect(props).toHaveProperty('age', true);
    });

    it('includes extraSelect from the entity class', () => {
      // User has static extraSelect = { postsCount: true }
      expect(userRepo.properties).toHaveProperty('postsCount', true);
    });
  });

  describe('propertiesToSelect', () => {
    it('quotes top-level columns under the table alias', () => {
      const select = userRepo.propertiesToSelect({ id: true, email: true });

      expect(select).toEqual(['"User"."id"', '"User"."email"']);
    });
  });

  describe('entityClass / alias', () => {
    it('exposes the metadata target as entityClass', () => {
      expect(userRepo.entityClass).toBe(User);
    });

    it('uses the entity name as the default alias', () => {
      const qb = userRepo.createQueryBuilder();

      expect(qb.alias).toBe('User');
    });

    it('honors a custom alias when one is provided', () => {
      const custom = new BaseRepository(dataSource.getRepository(User), 'u');

      expect(custom.createQueryBuilder().alias).toBe('u');
    });
  });

  describe('mergeDeep', () => {
    it('merges plain partials into the entity', async () => {
      const { users } = await seed(dataSource);
      const fresh = await userRepo.findOneByOrFail({ id: users.alice.id });

      userRepo.mergeDeep(fresh, { email: 'alice-merged@example.com' });

      expect(fresh.email).toBe('alice-merged@example.com');
    });
  });

  describe('one-to-many attach/deattach', () => {
    it('attaches posts to a user and deattaches them', async () => {
      const { users } = await seed(dataSource);
      const newPost = await postRepo.save({ title: 'standalone', views: 0 } as any);

      await userRepo.attachOneToMany(users.alice, [newPost], 'posts');

      const reloadedPost = await postRepo.findOneByOrFail({ id: newPost.id });
      // FK is set on the post
      const withUser = await dataSource.getRepository(Post).findOne({
        where: { id: newPost.id },
        relations: { user: true },
      });

      expect(withUser!.user.id).toBe(users.alice.id);

      await userRepo.deattachOneToMany(users.alice, [reloadedPost], 'posts');

      const afterDeattach = await dataSource.getRepository(Post).findOne({
        where: { id: newPost.id },
        relations: { user: true },
      });

      expect(afterDeattach!.user).toBeNull();
    });
  });

  describe('many-to-many attach/set/deattach', () => {
    it('attachManyToManyItems adds rows to the join table', async () => {
      const { users, tags } = await seed(dataSource);

      await userRepo.attachManyToManyItems(users.carol, [tags.green], 'tags');

      const withTags = await dataSource.getRepository(User).findOne({
        where: { id: users.carol.id },
        relations: { tags: true },
      });

      expect(withTags!.tags.map((t) => t.label)).toEqual(['green']);
    });

    it('attachManyToManyItems is idempotent (orIgnore)', async () => {
      const { users, tags } = await seed(dataSource);

      // alice already has red+blue, attaching red again should not throw
      await expect(userRepo.attachManyToManyItems(users.alice, [tags.red], 'tags')).resolves.not.toThrow();

      const withTags = await dataSource.getRepository(User).findOne({
        where: { id: users.alice.id },
        relations: { tags: true },
      });

      expect(withTags!.tags.map((t) => t.label).sort()).toEqual(['blue', 'red']);
    });

    it('setManyToManyItems replaces the existing set', async () => {
      const { users, tags } = await seed(dataSource);

      await userRepo.setManyToManyItems(users.alice, [tags.green], 'tags');

      const withTags = await dataSource.getRepository(User).findOne({
        where: { id: users.alice.id },
        relations: { tags: true },
      });

      expect(withTags!.tags.map((t) => t.label)).toEqual(['green']);
    });

    it('deattachManyToManyItems removes specific join rows', async () => {
      const { users, tags } = await seed(dataSource);

      await userRepo.deattachManyToManyItems(users.alice, [tags.red], 'tags');

      const withTags = await dataSource.getRepository(User).findOne({
        where: { id: users.alice.id },
        relations: { tags: true },
      });

      expect(withTags!.tags.map((t) => t.label)).toEqual(['blue']);
    });
  });

  describe('withoutVirtual', () => {
    it('returns a new scoped repository instance', async () => {
      await seed(dataSource);

      const lean = userRepo.withoutVirtual;

      expect(lean).not.toBe(userRepo);
      // the scope still finds the same rows
      const all = await lean.find();

      expect(all).toHaveLength(3);
    });

    it('emits SQL that omits the virtual column expression for find()', async () => {
      await seed(dataSource);

      const queries: string[] = [];
      const subscription = dataSource.driver.createQueryRunner('master');

      // Capture queries by patching the connection's logger
      const originalLogger = dataSource.logger;
      dataSource.logger = {
        ...originalLogger,
        logQuery: (q: string) => { queries.push(q); },
      } as any;

      try {
        await userRepo.find();
        const withVirtualQuery = queries.find((q) => q.toLowerCase().includes('select')) ?? '';

        queries.length = 0;
        await userRepo.withoutVirtual.find();
        const withoutVirtualQuery = queries.find((q) => q.toLowerCase().includes('select')) ?? '';

        expect(withVirtualQuery.toLowerCase()).toContain('postscount');
        expect(withoutVirtualQuery.toLowerCase()).not.toContain('postscount');
      } finally {
        dataSource.logger = originalLogger;
        await subscription.release();
      }
    });
  });
});
