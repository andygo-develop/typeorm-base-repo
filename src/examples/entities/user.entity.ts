import { Column, CreateDateColumn, Entity } from 'typeorm';
import { BaseMethodsEntity } from '../../';

@Entity()
export class UserEntity extends BaseMethodsEntity {
  @Column()
  email: string;

  @Column({ default: 0 })
  age: number;

  @CreateDateColumn()
  createdAt: Date;
}
