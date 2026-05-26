import { PrimaryGeneratedColumn } from 'typeorm';

import { BaseMethodsEntity } from './base-methods.entity';

export class BaseEntity extends BaseMethodsEntity {
  @PrimaryGeneratedColumn()
  declare id: number;
}
