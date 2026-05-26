import { FindOperator } from 'typeorm/find-options/FindOperator';

import { BaseRepository } from '../repositories/base.repository';

import { IDbEntity } from '../interfaces/db-entity.interface';

import { TFindOptions } from '../types/repositories.types';

export function InSubQuery<T extends IDbEntity>(
  repo: BaseRepository<T>,
  findOptions: TFindOptions<T> = {},
  skipDistinct = false,
): FindOperator<any> {
  const newRepo = repo.createScoped(findOptions);
  const { scope } = newRepo;
  const select = findOptions?.select ?? <TFindOptions<T>['select']>{ id: true };

  scope.select(newRepo.propertiesToSelect(select));
  if (!skipDistinct) {
    scope.distinct();
  }
  const [query, parameters] = newRepo.getUniqQueryAndParameters();

  return new FindOperator(
    'raw',
    [],
    true,
    true,
    (aliasPath) => `${aliasPath} IN (${query})`,
    parameters,
  );
}
