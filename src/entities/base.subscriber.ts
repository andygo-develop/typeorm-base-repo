import {
  DataSource,
  EntitySubscriberInterface, EventSubscriber,
} from 'typeorm';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { BaseEntity } from './base.entity';
import { BaseMethodsEntity } from './base-methods.entity';

@EventSubscriber()
@Injectable()
export class BaseSubscriber implements EntitySubscriberInterface<BaseEntity> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.dataSource.subscribers.push(this);
  }

  afterLoad(entity: BaseEntity): Promise<any> | void {
    if (entity instanceof BaseMethodsEntity) {
    }
  }
}
