import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Post, Tag, User } from './entities';

let sharedDataSource: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (sharedDataSource && sharedDataSource.isInitialized) {
    return sharedDataSource;
  }

  sharedDataSource = new DataSource({
    type: 'sqljs',
    autoSave: false,
    synchronize: true,
    dropSchema: true,
    entities: [User, Post, Tag],
    cache: {
      type: 'database',
      tableName: 'query_result_cache',
    },
    logging: false,
  });

  await sharedDataSource.initialize();

  return sharedDataSource;
}

export async function resetSchema(dataSource: DataSource) {
  await dataSource.synchronize(true);
}

// Back-compat for existing spec files
export async function createTestDataSource(): Promise<DataSource> {
  const ds = await getTestDataSource();
  await resetSchema(ds);

  return ds;
}

export async function seed(dataSource: DataSource) {
  const userRepo = dataSource.getRepository(User);
  const postRepo = dataSource.getRepository(Post);
  const tagRepo = dataSource.getRepository(Tag);

  const [redTag, blueTag, greenTag] = await tagRepo.save([
    { label: 'red' },
    { label: 'blue' },
    { label: 'green' },
  ] as any);

  const alice = await userRepo.save({ email: 'alice@example.com', age: 30, tags: [redTag, blueTag] } as any);
  const bob = await userRepo.save({ email: 'bob@example.com', age: 25, tags: [blueTag] } as any);
  const carol = await userRepo.save({ email: 'carol@example.com', age: 40, tags: [] } as any);

  await postRepo.save([
    { title: 'Alice post 1', views: 5, user: alice },
    { title: 'Alice post 2', views: 12, user: alice },
    { title: 'Bob post', views: 3, user: bob },
  ] as any);

  return {
    users: { alice, bob, carol },
    tags: { red: redTag, blue: blueTag, green: greenTag },
  };
}
