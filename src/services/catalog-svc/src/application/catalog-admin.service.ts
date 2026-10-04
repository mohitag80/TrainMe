import { Inject, Injectable } from '@nestjs/common';
import type { JsonCache, Redis } from '@trainme/cache';
import { newId, type Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type TemplatePublishedPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import { CACHE, DATABASE, OUTBOX, REDIS } from '@trainme/service-kit';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';
import { CACHE_KEYS } from './catalog-query.service.js';
import { rebuildSearchDocuments } from './search-documents.js';

type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

@Injectable()
export class CatalogAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<CatalogDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
  ) {}

  /** Every version of every template (curator view), newest first per code. */
  async listTemplateVersions(status?: TemplateStatus) {
    let q = this.db
      .selectFrom('profileTemplate as t')
      .innerJoin('category as c', 'c.id', 't.categoryId')
      .select(['t.code', 't.version', 't.name', 't.status', 't.source', 't.publishedAt', 'c.code as categoryCode']);
    if (status) q = q.where('t.status', '=', status);
    return q.orderBy('t.code').orderBy('t.version', 'desc').execute();
  }

  /**
   * Changes a template version's status. Publishing retires the previously published version
   * (one published version per code), announces it and invalidates caches and search rows.
   */
  async setTemplateStatus(actorId: string, code: string, version: number, status: 'PUBLISHED' | 'RETIRED') {
    const result = await this.db.transaction().execute(async (trx) => {
      const tpl = await trx
        .selectFrom('profileTemplate')
        .select(['id', 'name', 'status'])
        .where('code', '=', code)
        .where('version', '=', version)
        .forUpdate()
        .executeTakeFirst();
      if (!tpl) throw ProblemError.notFound(`Template ${code} v${version}`);
      if (tpl.status === status) return { code, version, status, changed: false };
      if (status === 'PUBLISHED') {
        await trx
          .updateTable('profileTemplate')
          .set({ status: 'RETIRED' })
          .where('code', '=', code)
          .where('status', '=', 'PUBLISHED')
          .execute();
      }
      await trx
        .updateTable('profileTemplate')
        .set({ status, ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) })
        .where('id', '=', tpl.id)
        .execute();
      await trx
        .insertInto('catalogAudit')
        .values({
          id: newId(),
          actorId,
          action: status === 'PUBLISHED' ? 'PUBLISH' : 'RETIRE',
          entityType: 'TEMPLATE',
          entityCode: code,
          details: JSON.stringify({ version, from: tpl.status, to: status }),
        })
        .execute();
      await rebuildSearchDocuments(trx);
      await this.outbox.enqueue<TemplatePublishedPayload>(trx, TOPICS.catalog, {
        type: status === 'PUBLISHED' ? EVENT_TYPES.templatePublished : EVENT_TYPES.templateRetired,
        userId: 'system',
        key: code,
        subject: `template/${code}`,
        data: { templateCode: code, version, name: tpl.name },
      });
      return { code, version, status, changed: true };
    });
    if (result.changed) await this.invalidate(code);
    return result;
  }

  /** New catalog version → every derived cache key (tree, search, suggest) changes. */
  async invalidate(templateCode?: string): Promise<void> {
    if (templateCode) await this.cache.del(CACHE_KEYS.templateLatest(templateCode));
    try {
      await this.redis.incr(CACHE_KEYS.version);
    } catch {
      // Cache is optional; stale entries expire by TTL.
    }
  }

  /** After a seed import: "latest" template/activity keys are not versioned, so drop them all, then bump the version. */
  async invalidateAll(): Promise<void> {
    try {
      for (const pattern of ['cat:tpl:*:latest', 'cat:act:*:latest']) {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
          if (keys.length) await this.redis.del(...keys);
          cursor = next;
        } while (cursor !== '0');
      }
    } catch {
      // Cache is optional; stale entries expire by TTL.
    }
    await this.invalidate();
  }
}
