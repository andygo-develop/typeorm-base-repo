import util from 'node:util';

import {
  DeepPartial, EntityNotFoundError, FindOptionsWhere, IsNull, Not, Repository, SelectQueryBuilder,
} from 'typeorm';
import { EntityTarget } from 'typeorm/common/EntityTarget';
import { ObjectLiteral } from 'typeorm/common/ObjectLiteral';
import { FindOptionsRelationsProperty } from 'typeorm/find-options/FindOptionsRelations';
import { FindOptionsSelect } from 'typeorm/find-options/FindOptionsSelect';
import { EntityMetadata } from 'typeorm/metadata/EntityMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { JoinAttribute } from 'typeorm/query-builder/JoinAttribute';
import { RelationIdLoader } from 'typeorm/query-builder/RelationIdLoader';
import { QueryRunner } from 'typeorm/query-runner/QueryRunner';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';


import { NotFoundException } from '@nestjs/common';

import { InSubQuery } from '../operators/in-sub-query';

import { IDbEntity } from '../interfaces/db-entity.interface';

import { TEntityKeys } from '../types/entity.types';
import {
  TCreateScopedOptions, TFindOptions, TOrFailOptions,
} from '../types/repositories.types';

import {
  mergeDeep, mergeDeepObjectsOnly, uniqParamCounter,
} from '../functions';

export { mergeDeepObjectsOnly };

export const scopesMap = new WeakMap<any, SelectQueryBuilder<any>>();

export class BaseRepository<Entity extends IDbEntity> extends Repository<Entity> {
  protected scopeOptions: TFindOptions<Entity> = {};

  protected alias: string;

  protected createScopedOptions: TCreateScopedOptions<Entity>[] = [];

  constructor(repository: Repository<Entity>, alias?: string, scopeOptions: TFindOptions<Entity> = {}) {
    super(repository.target, repository.manager, repository.queryRunner);
    this.scopeOptions = { select: this.properties, ...scopeOptions };

    this.alias = alias ?? this.metadata.name;
  }

  createQueryBuilder(alias?: string, queryRunner?: QueryRunner) {
    return super.createQueryBuilder(alias ?? this.alias, queryRunner);
  }

  getScopeOptions() {
    return this.scopeOptions;
  }

  hasJoins(): boolean {
    return this.scope.expressionMap.joinAttributes.length > 0;
  }

  async reload<T extends Entity | Entity[]>(entities: T, options: TFindOptions<Entity> = {}) {
    for (const entity of <Entity[]>[entities].flat()) {
      const where = <FindOptionsWhere<Entity>>{ id: entity.id };

      Object.assign(entity, await this.findOneOrFail({ ...options, where }));
    }

    return entities;
  }

  get queryResultCache() {
    return this.manager.connection.queryResultCache;
  }

  get properties(): FindOptionsSelect<Entity> {
    return {
      ...(<FindOptionsSelect<Entity>>Object.fromEntries(this.metadata.columns.map(({ propertyName }) => [propertyName, true]))),
      ...(<any> this.metadata.target).extraSelect,
    };
  }

  public getRepository<EntityClass extends IDbEntity>(
    entityClass: EntityTarget<EntityClass>,
    alias?: string,
    scopeOptions: TFindOptions<EntityClass> = {},
  ) {
    return new BaseRepository<EntityClass>(this.manager.getRepository(entityClass), alias, scopeOptions);
  }

  public mergeDeep(mergeIntoEntity: Entity, ...entityLikes: DeepPartial<Entity>[]): Entity {
    const merged = mergeDeepObjectsOnly(mergeIntoEntity, ...entityLikes);

    return this.merge(mergeIntoEntity, merged);
  }

  public mergeJsonb<T>(mergeIntoEntity: T, ...entityLikes: DeepPartial<T>[]): T {
    for (const entity of entityLikes) {
      Object.assign(
        mergeIntoEntity,
        <T>Object.fromEntries(
          Object.entries(entity)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, v]),
        ),
      );
    }

    return mergeIntoEntity;
  }

  get scope(): SelectQueryBuilder<Entity> {
    return scopesMap.get(this) ?? this.createQueryBuilder();
  }

  getUniqQueryAndParameters(
    uniqParamPrefix = 'orm_param_uniq_',
    paramsRegExp = /:(\.\.\.)?([a-z_][a-z_0-9]+)/gi,
  ): [query: string, parameters: ObjectLiteral] {
    const { scope } = this;
    const query = scope.getQuery();
    const params = scope.getParameters();
    const [escapedQuery] = scope.connection.driver.escapeQueryWithParameters(query, params, {});
    const diff = (<any>util).diff(query, escapedQuery);
    let pos = 0;
    const paramsPos: number[] = [];

    for (const [mode, char] of diff) {
      if (mode === 1 && char === ':') {
        paramsPos.push(pos);
      }
      if (mode === 0 || mode === 1) {
        pos += char.length;
      }
    }
    const newParams = {};

    const newQuery = query.replace(paramsRegExp, (substring, spread: string, paramOldName: string, paramPos: number) => {
      if (paramsPos.includes(paramPos)) {
        const values = spread === '...' ? params[paramOldName] : [params[paramOldName]];
        const result: string[] = [];

        for (const value of values) {
          const paramNewName = `${uniqParamPrefix}${uniqParamCounter.current}`;

          uniqParamCounter.current += 1;
          newParams[paramNewName] = value;
          result.push(`:${paramNewName}`);
        }

        return result.join(', ');
      }

      return substring;
    });

    return [newQuery, newParams];
  }

  stream(options?: TFindOptions<Entity>) {
    return this.prepareFindScope(options).stream();
  }

  streamBy(where?: TFindOptions<Entity>['where']) {
    return this.stream({ where });
  }

  async find(options?: TFindOptions<Entity>) {
    const queryOptions: TFindOptions<Entity> = { relationLoadStrategy: 'query', wrapWithSubquery: false, ...options };
    const { wrapWithSubquery, relationLoadStrategy } = queryOptions;
    const [primaryColumn] = this.scope.expressionMap.mainAlias?.metadata?.primaryColumns ?? [];

    if (wrapWithSubquery && primaryColumn?.propertyName === 'id' && this.hasJoins() && relationLoadStrategy === 'query') {
      const { allOrderBys } = this.scope.expressionMap;
      const hasOrderBy = Object.keys(allOrderBys).length > 0;

      const repo = this.getRepository(this.target, this.alias, this.getScopeOptions()).withArchived.createScopedBy({
        id: <any>InSubQuery(this, {}, hasOrderBy),
      });

      if (hasOrderBy) {
        for (const [key, sortDirection] of Object.entries(allOrderBys)) {
          if (typeof sortDirection === 'string') {
            repo.scope.addOrderBy(key, sortDirection);
          } else {
            repo.scope.addOrderBy(key, sortDirection.order, sortDirection.nulls);
          }
        }
      }

      return repo.findCached(queryOptions);
    }

    return this.createScoped(queryOptions).findCached(options);
  }

  findBy(where?: TFindOptions<Entity>['where']) {
    return this.find({ where });
  }

  async findOne(options?: TFindOptions<Entity>) {
    const entities = await this.find({ ...options, take: 1 });

    return entities.length > 0 ? entities[0] : null;
  }

  findOneBy(where?: TFindOptions<Entity>['where']) {
    return this.findOne({ where });
  }

  count(options?: TFindOptions<Entity>) {
    const qb = this.prepareFindScope(options);

    if (options?.responseCache?.ttl !== undefined) {
      const { id, ttl } = options.responseCache;

      if (id !== undefined) {
        qb.cache(id, ttl);
      } else {
        qb.cache(ttl);
      }
    }

    return qb.getCount();
  }

  countBy(where?: TFindOptions<Entity>['where']) {
    return this.count({ where });
  }

  exists(options?: TFindOptions<Entity>) {
    const qb = this.prepareFindScope(options);

    if (options?.responseCache?.ttl !== undefined) {
      const { id, ttl } = options.responseCache;

      if (id !== undefined) {
        qb.cache(id, ttl);
      } else {
        qb.cache(ttl);
      }
    }

    return qb.getExists();
  }

  async existsBy(where: TFindOptions<Entity>['where']) {
    return this.exists({ where });
  }

  findAndCount(options?: TFindOptions<Entity>) {
    const findOptions = { ...options };
    const countOptions = { ...options };

    if (options.responseCache) {
      findOptions.responseCache = { ...options.responseCache };
      countOptions.responseCache = { ...options.responseCache };
      if (options.responseCache.id) {
        findOptions.responseCache.id = `${options.responseCache.id}#find`;
        countOptions.responseCache.id = `${options.responseCache.id}#count`;
      }
    }

    return Promise.all([this.find(findOptions), this.count(countOptions)]);
  }

  findAndCountBy(where?: TFindOptions<Entity>['where']) {
    return Promise.all([this.findBy(where), this.countBy(where)]);
  }

  async findOneOrFail(options?: TFindOptions<Entity> & TOrFailOptions) {
    const entity = await this.findOne(options);

    if (entity === null) {
      if (options?.notFoundErrorMessage) {
        throw new NotFoundException(options.notFoundErrorMessage);
      } else {
        const { expressionMap } = this.scope;

        throw new EntityNotFoundError(expressionMap.mainAlias.target, expressionMap.parameters);
      }
    }

    return entity;
  }

  async findOneByOrFail(where?: TFindOptions<Entity>['where'], options?: TOrFailOptions) {
    return this.findOneOrFail({ where, ...options });
  }

  async* findGenerator(options: TFindOptions<Entity> = {}, perRequest = 100) {
    const { skip = 0, take = Number.MAX_SAFE_INTEGER } = options;
    let currentSkip = skip;
    const currentOptions = { ...options };
    let i = 0;

    while (true) {
      currentOptions.skip = currentSkip;
      currentOptions.take = perRequest;
      const entities = await this.find(<any>{ order: { id: 'ASC' }, ...currentOptions });

      for (const entity of entities) {
        yield entity;
        i += 1;
      }
      if (i === take || entities.length < perRequest) {
        break;
      }
      currentSkip += perRequest;
    }
  }

  async* findBatchGenerator(options: TFindOptions<Entity> = {}, perRequest = 100) {
    const { skip = 0, take = Number.MAX_SAFE_INTEGER } = options;
    let currentSkip = skip;
    const currentOptions = { ...options };
    let i = 0;

    while (true) {
      currentOptions.skip = currentSkip;
      currentOptions.take = perRequest;
      const entities = await this.find(<any>{ order: { id: 'ASC' }, ...currentOptions });

      yield entities;
      i += entities.length;
      if (i === take || entities.length < perRequest) {
        break;
      }
      currentSkip += perRequest;
    }
  }

  async deleteBy(criteria: FindOptionsWhere<Entity> = {}) {
    const repo = this.createScopedBy(criteria);

    return repo.scope
      .delete()
      .where({ id: InSubQuery(repo) })
      .execute();
  }

  createScoped(
    scopeOptions: TCreateScopedOptions<Entity> = {},
    newScope: SelectQueryBuilder<Entity> = (scopesMap.get(this) ?? this.createQueryBuilder()).clone(),
  ): this {
    const newObject = <this> Object.create(this);

    newObject.createScopedOptions = [...this.createScopedOptions, scopeOptions];

    const { select, extendSelect, skipVirtualColumns, wrapWithSubquery, ...restScopeOptions } = scopeOptions;

    if (select !== undefined) {
      newObject.scopeOptions.select = select
    }
    if (extendSelect !== undefined) {
      newObject.scopeOptions.extendSelect = extendSelect
    }
    if (skipVirtualColumns !== undefined) {
      newObject.scopeOptions.skipVirtualColumns = skipVirtualColumns
    }
    if (wrapWithSubquery !== undefined) {
      newObject.scopeOptions.wrapWithSubquery = wrapWithSubquery
    }
    scopesMap.set(newObject, newScope);

    return newObject.setFindOptions(restScopeOptions);
  }

  createScopedBy(
    where: TFindOptions<Entity>['where'] = {},
    newScope: SelectQueryBuilder<Entity> = (scopesMap.get(this) ?? this.createQueryBuilder()).clone(),
  ): this {
    return this.createScoped({ where }, newScope);
  }

  select(select: TFindOptions<Entity>['select']): this {
    this.scope.select(this.propertiesToSelect(select));

    return this;
  }

  propertiesToSelect(select: TFindOptions<Entity>['select'], tableAlias?: string): string[] {
    const {
      alias: thisAlias,
      metadata: { relations },
    } = this;
    const alias = tableAlias === undefined ? thisAlias : tableAlias;
    const properties: string[] = [];
    const relationsMetadataByName = new Map<string, RelationMetadata>(relations.map((relation) => [relation.propertyName, relation]));

    for (const [propertyOrRelationName, relationSelect] of Object.entries(select)) {
      if (relationsMetadataByName.has(propertyOrRelationName)) {
        const relationMetadata = relationsMetadataByName.get(propertyOrRelationName);
        const relationRepo = this.getRepository(relationMetadata.inverseRelation.target);
        const relationAlias = `${alias}__${alias}_${relationMetadata.propertyPath}`;

        properties.push(...relationRepo.propertiesToSelect(relationSelect, relationAlias));
      } else {
        properties.push(`"${alias}"."${propertyOrRelationName}"`);
      }
    }

    return properties;
  }

  setFindOptions(findOptions: TFindOptions<Entity>): this {
    const scope = this.scope;

    scope.setFindOptions({
      relationLoadStrategy: 'query',
      loadEagerRelations: false,
      ...findOptions,
    });
    this.normalizeJoins(scope);

    return this;
  }

  distinct(distinct?: boolean): this {
    const scoped = this.createScoped();

    scoped.scope.distinct(distinct);

    return scoped;
  }

  distinctOn(...distinctOn: string[]): this {
    const scoped = this.createScoped();

    scoped.scope.distinctOn(distinctOn);

    return scoped;
  }

  get entityClass() {
    return this.metadata.target;
  }

  get withoutVirtual(): this {
    return this.createScoped({ skipVirtualColumns: true });
  }

  get withArchived(): this {
    return this.createScoped({ withDeleted: true });
  }

  get archivedOnly(): this {
    return this.createScoped({ withDeleted: true, where: { deletedAt: <any>Not(IsNull()) } });
  }

  loadRelationCountAndMap(
    mapToProperty: TEntityKeys<Entity>,
    relationName: TEntityKeys<Entity>,
    aliasName?: string,
    queryBuilderFactory?: (qb: SelectQueryBuilder<Entity>) => SelectQueryBuilder<Entity>,
  ) {
    const repo = this.createScoped({});
    const { alias } = repo.scope;

    repo.scope.loadRelationCountAndMap(`${alias}.${mapToProperty}`, `${alias}.${relationName}`, aliasName, queryBuilderFactory);

    return repo;
  }

  async setManyToManyItems(document: Entity, items: IDbEntity[], relation: TEntityKeys<Entity>): Promise<void> {
    const { joinTableName, joinColumns } = this.metadata.relations.find(({ propertyName }) => propertyName === relation);
    const query = this.createQueryBuilder().delete().from(joinTableName);

    for (const {
      propertyName: target,
      referencedColumn: { propertyName: source },
    } of joinColumns) {
      query.andWhere(({ alias }) => `"${alias}"."${target}" = :${target}`, { [target]: document[source] });
    }

    await query.execute();
    await this.attachManyToManyItems(document, items, relation);
  }

  async attachManyToManyItems(document: Entity, items: IDbEntity[], relation: TEntityKeys<Entity>): Promise<void> {
    const { joinTableName, joinColumns, inverseJoinColumns } = this.metadata.relations.find(({ propertyName }) => propertyName === relation);

    const entities: any[] = [];

    for (const tag of items) {
      const entity: any = {};

      for (const {
        propertyName: target,
        referencedColumn: { propertyName: source },
      } of joinColumns) {
        entity[target] = document[source];
      }
      for (const {
        propertyName: target,
        referencedColumn: { propertyName: source },
      } of inverseJoinColumns) {
        entity[target] = tag[source];
      }
      entities.push(entity);
    }

    await this.createQueryBuilder().insert().into(joinTableName).values(entities)
      .orIgnore()
      .execute();
  }

  async deattachManyToManyItems(document: Entity, items: IDbEntity[], relation: TEntityKeys<Entity>): Promise<void> {
    await this.scope.relation(relation).of(document).remove(items);
  }

  async attachOneToMany(document: Entity, items: IDbEntity[], relation: TEntityKeys<Entity>): Promise<void> {
    return this.scope.relation(relation).of(document).add(items);
  }

  async deattachOneToMany(document: Entity, items: IDbEntity[], relation: TEntityKeys<Entity>): Promise<void> {
    return this.scope.relation(relation).of(document).remove(items);
  }

  protected (params: any) {
    return Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
  }

  protected prepareFindScope(options: TFindOptions<Entity> = {}) {
    const { select, ...restScopeOptions } = options;
    const scopeOptions = mergeDeep(this.scopeOptions, restScopeOptions);

    if (select !== undefined) {
      scopeOptions.select = select;
    }
    scopeOptions.select = mergeDeep(
      this.getScopeOptionsSelect(scopeOptions.select, scopeOptions.relations, scopeOptions.skipVirtualColumns),
      scopeOptions.extendSelect ?? {},
    );

    const scope = this.scope.clone().setFindOptions(scopeOptions);

    this.normalizeJoins(scope);

    return scope;
  }

  protected normalizeJoins(scope: SelectQueryBuilder<Entity>) {
    const attrs: any[] = scope.expressionMap.joinAttributes;
    const names = new Map<string, JoinAttribute>();

    for (let i = 0; i < attrs.length; i += 1) {
      const attr = attrs[i];

      if (names.has(attr.alias.name)) {
        const { selects } = (<any>names.get(attr.alias.name)).queryExpressionMap;

        for (const select of attr.queryExpressionMap.selects) {
          if (!selects.includes(select)) {
            selects.push(select);
          }
        }
        attrs.splice(i, 1);
        i -= 1;
      } else {
        names.set(attr.alias.name, attr);
      }
    }

    return scope;
  }

  protected getScopeOptionsSelect(
    select: FindOptionsSelect<Entity>,
    relations: FindOptionsRelationsProperty<any>,
    skipVirtualColumns: boolean = false,
    metadata: EntityMetadata = this.metadata,
    nestedMap = new Map<any, boolean>(),
  ): FindOptionsSelect<Entity> {
    const resultSelect: FindOptionsSelect<Entity> = select ?? {
      ...(<FindOptionsSelect<Entity>>Object.fromEntries(metadata.columns.map(({ propertyName }) => [propertyName, true]))),
      ...(<any>metadata.target).extraSelect,
    };
    const relationsMap = new Map<string, RelationMetadata>(metadata.relations.map((relation) => [relation.propertyName, relation]));

    for (const property of relationsMap.keys()) {
      if (relations && !(typeof relations === 'boolean') && property in relations) {
        const { target } = metadata;

        if (!nestedMap.has(target)) {
          nestedMap.set(target, true);
          resultSelect[property] = this.getScopeOptionsSelect(
            resultSelect[property],
            relations[property],
            skipVirtualColumns,
            relationsMap.get(property).inverseEntityMetadata,
            nestedMap,
          );
          nestedMap.delete(target);
        }
      }
    }

    if (skipVirtualColumns) {
      const virtualColumns = metadata.columns.filter(({ isVirtualProperty }) => isVirtualProperty).map(({ propertyName }) => propertyName);

      return <FindOptionsSelect<Entity>>Object.fromEntries(Object.entries(resultSelect).filter(([property]) => !virtualColumns.includes(property)));
    }

    return resultSelect;
  }

  protected async cache<T>(id: string, ttl: number, handler: () => Promise<T>): Promise<T> {
    if (ttl === undefined) {
      return handler();
    }

    const savedCache = await this.queryResultCache.getFromCache({ identifier: id, duration: ttl });

    if (savedCache === undefined) {
      const result = await handler();

      await this.queryResultCache.storeInCache(
        {
          identifier: id,
          duration: ttl,
          time: Date.now(),
          result: JSON.stringify(result),
        },
        undefined,
        undefined,
      );

      return result;
    }

    return JSON.parse(savedCache.result);
  }

  protected scopeQuery(scope: SelectQueryBuilder<Entity>): string {
    const [query, parameters] = scope.getQueryAndParameters();

    return `${query} -- SKIP: ${scope.expressionMap.skip}, TAKE: ${scope.expressionMap.take} PARAMETERS: ${JSON.stringify(parameters)}`;
  }

  protected async loadRelations(entities: Entity[], cacheIdPrefix: string, options?: TFindOptions<Entity>) {
    const relationsMetadata = this.metadata.relations;
    const {
      select, responseCache, relations, withDeleted,
    } = options;

    if (entities.length === 0 || !relations || Object.keys(relations).length === 0) {
      return;
    }
    const metadataByPropertyName = new Map<string, RelationMetadata>(relationsMetadata.map((relation) => [relation.propertyName, relation]));

    await Promise.all(
      Object.entries(relations).map(async ([propertyName, relation]) => {
        if (relation === false) {
          return;
        }
        const relationMetadata = metadataByPropertyName.get(propertyName);
        const relationOptions: TFindOptions<IDbEntity> = {
          select: select?.[propertyName],
          responseCache: responseCache?.relations?.[propertyName],
          withDeleted,
          relations: relations[propertyName],
        };

        const repo = this.getRepository(relationMetadata.type).setFindOptions({ ...relationOptions, relations: undefined });
        const scope = repo.prepareFindScope();
        const relationIdLoader = new RelationIdLoader(this.manager.connection, this.manager.queryRunner);
        const cacheId = relationOptions.responseCache?.id ?? `${cacheIdPrefix}#${propertyName}`;

        const result = await this.cache(
          cacheId,
          relationOptions?.responseCache?.ttl,
          async () => {
            const res = await relationIdLoader.loadManyToManyRelationIdsAndGroup(relationMetadata, entities, undefined, scope);

            return <[entityId: number, related: any][]>res.map(({ entity, related }) => [this.getId(entity), related]);
          },
        );

        const relatedEntities: IDbEntity[] = [];
        const entitiesById = new Map<number, Entity>(entities.map((entity) => [this.getId(entity), entity]));

        for (const [entityId, related] of result) {
          const entity = entitiesById.get(entityId);

          if (related) {
            entity[propertyName] = repo.create(related);
            relatedEntities.push(...[entity[propertyName]].flat());
          }
        }

        if (relatedEntities.length > 0) {
          await repo.loadRelations(relatedEntities, `${cacheId}(${relatedEntities.map((entity) => repo.getId(entity))})`, relationOptions);
        }
      }),
    );
  }

  protected async findCached(options?: TFindOptions<Entity>): Promise<Entity[]> {
    const { relationLoadStrategy = 'query', responseCache } = options ?? {};

    if (responseCache === undefined) {
      return this.prepareFindScope(options).getMany();
    }
    const findOptions = { ...options };

    if (relationLoadStrategy === 'query') {
      findOptions.relations = undefined;
    }
    const qb = this.prepareFindScope(findOptions);
    const { id = this.scopeQuery(qb), ttl } = responseCache;
    const entities = this.create(await this.cache(id, ttl, () => qb.getMany()));

    if (relationLoadStrategy === 'join') {
      return entities;
    }

    if (options.relations) {
      const cacheIdPrefix = `${id}(${entities.map(({ id: primaryId }) => primaryId)})`;

      await this.loadRelations(entities, cacheIdPrefix, options);
    }

    return entities;
  }

  protected params2suffix(params: any) {
    return Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
  }
}

/**
 * Constructor type for a class returned by {@link RepositoryFor}.
 * `new BaseRepositoryCtor(repo)` yields a fully-featured `BaseRepository<E>` instance.
 */
export type BaseRepositoryCtor<E extends IDbEntity> = new (repo: Repository<E>) => BaseRepository<E>;

export function RepositoryFor<E extends IDbEntity>(
  entityClass: EntityTarget<E>,
  alias?: string,
  scopeOptions: TFindOptions<E> = {},
): BaseRepositoryCtor<E> {
  @Injectable()
  class RepositoryForKlass extends BaseRepository<E> {
    constructor(
      @InjectRepository(entityClass as any) repo: Repository<E>,
    ) {
      super(repo, alias, scopeOptions);
    }
  }

  return RepositoryForKlass;
}
