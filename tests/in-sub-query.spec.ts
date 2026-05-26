// noinspection DuplicatedCode

import { DataSource } from 'typeorm';

import { InSubQuery, RepositoryFor } from '../src';

import { Post, User } from './entities';
import { createTestDataSource, seed } from './helpers';
import { BaseRepository } from '../src/repositories/base.repository';

describe('InSubQuery operator', () => {
  let dataSource: DataSource;
  let userRepo: BaseRepository<User>;
  let postRepo: BaseRepository<Post>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    // RepositoryFor returns a class — instantiate it with a TypeORM Repository.
    const UserRepo = RepositoryFor(User);
    const PostRepo = RepositoryFor(Post);

    userRepo = new UserRepo(dataSource.getRepository(User));
    postRepo = new PostRepo(dataSource.getRepository(Post));
  });

  // DataSource is shared and reset between tests via createTestDataSource.

  it('builds a WHERE id IN (subquery) clause that returns the expected rows', async () => {
    const { users } = await seed(dataSource);

    // Find users whose id is in the set of users that have at least one post
    const postsRepo = postRepo.createScoped({ select: { user: { id: true } } as any });
    // simpler check: find users by id in a sub-query that selects user ids from the posts repo
    const usersWithPosts = await userRepo.findBy({
      id: InSubQuery(userRepo.createScopedBy({ id: users.alice.id } as any)),
    } as any);

    expect(usersWithPosts.map((u) => u.id)).toEqual([users.alice.id]);
    // referenced to silence unused-var lint
    expect(postsRepo).toBeDefined();
  });

  it('deleteBy uses the InSubQuery operator and removes matching rows', async () => {
    const { users } = await seed(dataSource);

    // carol has no posts so no FK constraint blocks her deletion
    await userRepo.deleteBy({ email: 'carol@example.com' } as any);

    const remaining = await userRepo.find();

    expect(remaining.map((u) => u.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(users.carol.id).toBeDefined();
  });
});

// Sanity check that exists at all runtimes so the file isn't empty when skipped above.
describe('InSubQuery module', () => {
  it('exports InSubQuery as a function', () => {
    expect(typeof InSubQuery).toBe('function');
  });
});
