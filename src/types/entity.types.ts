import { ObjectId } from 'typeorm/driver/mongodb/typings';

export type TEntityProperty<Property> = Property extends Promise<infer I>
  ? TEntityProperty<NonNullable<I>> | boolean
  : Property extends Array<infer I> ?
    TEntityProperty<NonNullable<I>> | boolean
    : Property extends string
      ? boolean
      : Property extends number
        ? boolean
        : Property extends boolean
          ? boolean
          : Property extends Function
            ? boolean
            : Property extends Buffer
              ? boolean
              : Property extends Date
                ? boolean
                : Property extends ObjectId
                  ? boolean
                  : Property extends object
                    ? TEntityProperties<Property> | boolean
                    : boolean;

export type DeepKeys<T> = T extends object
  ? {
    [K in keyof T]: K extends string
      ? T[K] extends object
        ? `${K}.${DeepKeys<T[K]>}` | K
        : K
      : never;
  }[keyof T]
  : never;

export type TEntityProperties<Entity> = {
  [P in keyof Entity]?: TEntityProperty<NonNullable<Entity[P]>>;
};
export type TEntityKeys<Entity=any> = DeepKeys<TEntityProperty<Entity>>;
