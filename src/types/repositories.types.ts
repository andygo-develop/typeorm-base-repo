import { FindManyOptions } from 'typeorm/find-options/FindManyOptions';
import { FindOptionsSelect } from 'typeorm/find-options/FindOptionsSelect';

import { BaseRepository } from '../repositories/base.repository';

import { IDbEntity } from '../interfaces/db-entity.interface';

export type TRepository<T extends IDbEntity = IDbEntity> = BaseRepository<T>;

export type TResponseCacheOptions = {
  id?: string;
  ttl?: number;
};

export type TResponseCacheRelationsProperty<Property> =
  Property extends Array<infer I> ? TResponseCacheRelationsProperty<I> : Property extends IDbEntity ? TResponseCache<Property> : never;

type KeysOfValue<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];
type TRelationProperties<Entity extends IDbEntity> = KeysOfValue<Entity, IDbEntity | IDbEntity[]>;

export type TResponseCacheRelations<Entity extends IDbEntity> = {
  [P in TRelationProperties<Entity>]?: TResponseCacheRelationsProperty<Entity[P]>;
};
export type TOrFailOptions = {
  notFoundErrorMessage?: string;
};

export type TResponseCache<Entity extends IDbEntity> = TResponseCacheOptions & {
  relations?: TResponseCacheRelations<Entity>;
};

export type TFindOptions<Entity extends IDbEntity> = FindManyOptions<Entity> & {
  select?: FindOptionsSelect<Entity>;
  extendSelect?: FindOptionsSelect<Entity>;
  skipVirtualColumns?: boolean;
  responseCache?: TResponseCache<Entity>;
  wrapWithSubquery?: boolean;
};
export type TCreateScopedOptions<Entity extends IDbEntity> = TFindOptions<Entity>;
