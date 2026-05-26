import { DeepPartial, getMetadataArgsStorage } from 'typeorm';
import { FindOptionsSelect } from 'typeorm/find-options/FindOptionsSelect';
import { IDbEntity } from '../interfaces/db-entity.interface';

type Constructor<T> = { new (): T };

export class BaseMethodsEntity implements IDbEntity {
  __interfaceName: 'IDbEntity';

  static extraSelect: FindOptionsSelect<BaseMethodsEntity> = {};

  static create<T>(EntityKlass: Constructor<T>, data: DeepPartial<NoInfer<T>>): T {
    return <T>Object.assign(new EntityKlass(), data);
  }

  public id: number;

  public deletedAt?: Date;

  clone(
    deep = false,
    selector = (_entity: BaseMethodsEntity) => true,
    originalToClone = new Map<BaseMethodsEntity, BaseMethodsEntity>(),
  ): this {
    // Cycle / dedup short-circuit: if this entity is already being (or has been)
    // cloned in the current traversal, return the existing clone so back-references
    // converge on the same instance rather than producing parallel clones or loops.
    if (originalToClone.has(this)) {
      return <this> originalToClone.get(this);
    }

    delete this.id;
    const entity = (<any> this.constructor).create(this);

    // Register the clone BEFORE recursing so any nested traversal that re-encounters
    // `this` (e.g. a child's back-reference to its parent) can be redirected to
    // the clone instead of pointing back to the original entity.
    originalToClone.set(this, entity);

    if (deep) {
      for (const property of Object.getOwnPropertyNames(entity)) {
        const value = entity[property];

        if (value instanceof Array) {
          const newItems = [];

          for (const item of value) {
            if (item instanceof BaseMethodsEntity) {
              if (originalToClone.has(item)) {
                // Back-reference (or repeat reference) — point at the existing clone.
                newItems.push(originalToClone.get(item));
              } else if (selector(item)) {
                newItems.push(item.clone(true, selector, originalToClone));
              } else {
                newItems.push(item);
              }
            } else {
              newItems.push(item);
            }
          }
          entity[property] = newItems;
        } else if (value instanceof BaseMethodsEntity) {
          if (originalToClone.has(value)) {
            // Reverse relation to an already-cloned ancestor (or sibling shared
            // across the graph) — redirect to its clone instead of leaving the
            // original reference behind.
            entity[property] = originalToClone.get(value);
          } else if (selector(value)) {
            // Recursively clone the related entity (or get back the existing
            // clone if it's already mid-traversal).
            entity[property] = value.clone(true, selector, originalToClone);
          } else {
            // Selector rejected — relation stays pointing at the original.
            // No FK unset needed; the FK is still valid for that original.
            continue;
          }
          // In both replacement branches the relation reference now points at a
          // different entity than the loaded one, so the companion FK column
          // (e.g. `userId` paired with `user`) holds a stale id. Clear it so
          // TypeORM resolves the FK from the relation reference on cascade-save
          // instead of writing the stale original id from the loaded entity.
          this.unsetForeignKeyColumn(entity, property);
        }
      }
    }

    return entity;
  }

  /**
   * Unsets the FK column(s) that pair with the given relation property, when
   * any are present on the entity. Used by `clone()` after redirecting a
   * relation reference to a clone — without this, the FK column would still
   * hold the original related entity's id and TypeORM would persist the wrong
   * link (the FK column value typically wins over the relation reference on
   * cascade save).
   *
   * Two metadata sources are consulted, because `getMetadataArgsStorage()`
   * only records what decorators actually fired:
   *   - `storage.joinColumns` — populated only when `@JoinColumn(...)` is
   *     present. Gives us authoritative DB column names, including custom
   *     names (`@JoinColumn({ name: '...' })`) and composite FKs
   *     (`@JoinColumn([{...}, {...}])`).
   *   - `storage.relations`   — populated for every relation decorator. Lets
   *     us detect a bare `@ManyToOne` (no `@JoinColumn`) where TypeORM
   *     derives the FK at runtime; we fall back to the `<relationProperty>Id`
   *     convention there, mirroring TypeORM's own default.
   *
   * Skips entirely (no false-positive unset) when:
   *   - The relation isn't on the owning side (`@OneToMany`, `@ManyToMany`,
   *     or the inverse half of `@OneToOne`) — no FK lives on this entity.
   *   - There's no relation by that property name at all on the entity or
   *     any of its base classes.
   *
   * Walks the prototype chain so relations defined on inherited base classes
   * are found — decorator metadata records `target` as the declaring class,
   * not the concrete subclass that `entity.constructor` points at.
   */
  private unsetForeignKeyColumn(entity: any, relationProperty: string): void {
    const storage = getMetadataArgsStorage();
    const fkPropertyNames = new Set<string>();

    // `for-let` here (rather than `while` with an outer `let`) so each iteration
    // creates its own per-iteration binding for `cls`. The arrow callbacks
    // below close over that binding, satisfying ESLint's `no-loop-func` and
    // matching the eager, synchronous semantics of `.filter` / `.some`.
    for (let cls: any = entity.constructor; cls && cls !== Function.prototype; cls = Object.getPrototypeOf(cls)) {
      const explicitJoinColumns = storage.joinColumns.filter(
        (jc) => jc.target === cls && jc.propertyName === relationProperty,
      );

      if (explicitJoinColumns.length > 0) {
        // Explicit @JoinColumn(s) — trust the metadata. Handles custom-named
        // and composite FKs.
        for (const jc of explicitJoinColumns) {
          fkPropertyNames.add(jc.name ?? `${relationProperty}Id`);
        }
      } else {
        // No explicit @JoinColumn: only @ManyToOne has an implicit FK on this
        // side. (@OneToOne without @JoinColumn is the inverse side and carries
        // no FK; @OneToMany / @ManyToMany never carry an FK on this side.)
        const isImplicitManyToOne = storage.relations.some(
          (r) => r.target === cls
            && r.propertyName === relationProperty
            && r.relationType === 'many-to-one',
        );

        if (isImplicitManyToOne) {
          fkPropertyNames.add(`${relationProperty}Id`);
        }
      }
    }

    for (const fkProperty of fkPropertyNames) {
      if (Object.prototype.hasOwnProperty.call(entity, fkProperty)) {
        entity[fkProperty] = undefined;
      }
    }
  }

  duplicate(originalToDuplicate = new Map<BaseMethodsEntity, BaseMethodsEntity>()): this {
    // Cycle / dedup short-circuit (mirrors `clone()`): if this entity is already
    // being duplicated in the current traversal, return the existing duplicate so
    // back-references converge on the same instance rather than producing parallel
    // duplicates or looping.
    if (originalToDuplicate.has(this)) {
      return <this> originalToDuplicate.get(this);
    }

    // Unlike `clone()`, `duplicate()` preserves the `id` — it's used for in-memory
    // copies (dirty-state diffing, mutation sandboxes) rather than for persisting
    // new rows. For the same reason we DON'T call `unsetForeignKeyColumn` below:
    // the duplicate has the same id as the original, so the FK columns on related
    // entities are still consistent and clearing them would desynchronize the
    // in-memory graph.
    const entity = (<any> this.constructor).create({ ...this });

    // Register BEFORE recursing so any nested traversal that re-encounters `this`
    // (e.g. a child's back-reference to its parent) is redirected to the duplicate
    // instead of pointing back to the original, keeping the duplicated subgraph
    // structurally self-contained.
    originalToDuplicate.set(this, entity);

    for (const property of Object.getOwnPropertyNames(entity)) {
      const value = entity[property];

      if (value instanceof Array) {
        const newItems = [];

        for (const item of value) {
          if (item instanceof BaseMethodsEntity) {
            if (originalToDuplicate.has(item)) {
              // Back-reference (or repeat reference) — point at the existing duplicate.
              newItems.push(originalToDuplicate.get(item));
            } else {
              newItems.push(item.duplicate(originalToDuplicate));
            }
          } else {
            newItems.push(item);
          }
        }
        entity[property] = newItems;
      } else if (value instanceof BaseMethodsEntity) {
        if (originalToDuplicate.has(value)) {
          // Reverse relation to an already-duplicated ancestor (or sibling shared
          // across the graph) — redirect to its duplicate instead of leaving the
          // original reference behind.
          entity[property] = originalToDuplicate.get(value);
        } else {
          entity[property] = value.duplicate(originalToDuplicate);
        }
      }
    }

    return entity;
  }

  merge<T>(this: T, data: DeepPartial<NoInfer<T>>): T {
    return <T>Object.assign(this, data);
  }
}
