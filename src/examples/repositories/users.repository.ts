import { MoreThan } from 'typeorm';

import { Injectable } from '@nestjs/common';
import { UserEntity } from '../entities/user.entity';
import { RepositoryFor } from '../../';

@Injectable()
export class UsersRepository extends RepositoryFor(UserEntity) {
  get seniors() {
    return this.createScopedBy({ age: MoreThan(60) });
  }
}
