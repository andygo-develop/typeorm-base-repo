import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  VirtualColumn,
} from 'typeorm';

import { IDbEntity } from '../src/interfaces/db-entity.interface';

@Entity()
export class User implements IDbEntity {
  __interfaceName: 'IDbEntity';

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  email: string;

  @Column({ default: 0 })
  age: number;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @OneToMany('Post', 'user')
  posts: Post[];

  @ManyToMany('Tag', 'users', { cascade: false })
  @JoinTable({ name: 'user_tags' })
  tags: Tag[];

  @VirtualColumn({ query: (alias) => `SELECT COUNT(*) FROM post WHERE post."userId" = ${alias}.id` })
  postsCount: number;

  static extraSelect = { postsCount: true } as const;
}

@Entity()
export class Post implements IDbEntity {
  __interfaceName: 'IDbEntity';

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ default: 0 })
  views: number;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @ManyToOne('User', 'posts')
  user: User;
}

@Entity()
export class Tag implements IDbEntity {
  __interfaceName: 'IDbEntity';

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  label: string;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @ManyToMany('User', 'tags')
  users: User[];
}
