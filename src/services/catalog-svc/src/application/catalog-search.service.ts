import type { Logger } from '@trainme/observability';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { JsonCache } from '@trainme/cache';
import { isQueryTimeout, setLocalStatementTimeout, sql, type Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { CACHE, DATABASE, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { CatalogConfig } from '../config/catalog.config.js';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';
import { CatalogQueryService } from './catalog-query.service.js';

export interface SearchQuery {
  q: string;
  types?: ('CATEGORY' | 'TEMPLATE' | 'ACTIVITY')[];
  sports?: string[];
  roles?: string[];
  muscles?: string[];
  equipment?: string[];
  categories?: string[];
  kinds?: string[];
  locale: string;
  limit: number;
}

export interface SearchHit {
  itemType: string;
  itemCode: string;
  name: string;
  kind: string | null;
  sports: string[];
  roles: string[];
  muscles: string[];
  equipment: string[];
  level: string | null;
  score: number;
}

const arr = (v?: string[]) => (v && v.length ? v : null);

@Injectable()
export class CatalogSearchService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<CatalogDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(SERVICE_CONFIG) private readonly config: CatalogConfig,
    private readonly catalog: CatalogQueryService,
  ) {}

  /**
   * S1 (08 §5): full-text OR per-word strict trigram similarity (typos such as "dumbell chest"), with facets.
   * Bounded by SEARCH_TIMEOUT_MS so the gateway ceiling (2 s test / 5 s prod) is never reached.
   */
  async search(query: SearchQuery): Promise<SearchHit[]> {
    const version = await this.catalog.catalogVersion();
    const key = `cat:search:${version}:${query.locale}:${createHash('sha1').update(JSON.stringify(query)).digest('hex')}`;
    const started = Date.now();
    const hits = await this.cache.getOrLoad(key, 600, () => this.runSearch(query));
    this.log.debug({ q: query.q, types: query.types, hits: hits.length, ms: Date.now() - started }, 'catalog search');
    return hits;
  }

  /** S2: autocomplete on any part of the name (trigram GIN serves LIKE '%abc%'); word starts rank first. */
  async suggest(prefix: string, locale: string, limit: number) {
    const version = await this.catalog.catalogVersion();
    const p = prefix.trim().toLowerCase();
    return this.cache.getOrLoad(`cat:suggest:${version}:${locale}:${p}:${limit}`, 1800, async () => {
      const { rows } = await sql<{ itemType: string; itemCode: string; name: string }>`
        SELECT item_type, item_code, name
        FROM catalog_search_doc
        WHERE status = 'PUBLISHED' AND locale = ${locale}
          AND f_unaccent(lower(name)) LIKE '%' || f_unaccent(${p}) || '%'
        ORDER BY strpos(f_unaccent(lower(name)), f_unaccent(${p})), popularity DESC, length(name), name
        LIMIT ${limit}`.execute(this.db);
      return rows;
    });
  }

  private async runSearch(s: SearchQuery): Promise<SearchHit[]> {
    // Up to 5 words of ≥ 2 characters; each must fuzzily match a word of search_text (index: GIN trigram).
    const words = [
      ...new Set(
        s.q
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 2),
      ),
    ].slice(0, 5);
    const allWordsMatch = words.length
      ? sql.join(
          words.map((w) => sql`f_unaccent(${w}) <<% d.search_text`),
          sql` AND `,
        )
      : sql`false`;
    const wordScore = words.length
      ? sql`(${sql.join(
          words.map((w) => sql`strict_word_similarity(f_unaccent(${w}), d.search_text)`),
          sql` + `,
        )}) / ${words.length}`
      : sql`0`;
    try {
      return await this.db.transaction().execute(async (trx) => {
        await setLocalStatementTimeout(trx, this.config.SEARCH_TIMEOUT_MS);
        // 0.4 (default 0.5) also accepts one-letter typos in short words ("bowlr" → "bowler").
        await sql`SELECT set_config('pg_trgm.strict_word_similarity_threshold', '0.4', true)`.execute(trx);
        const { rows } = await sql<SearchHit>`
          WITH q AS (SELECT websearch_to_tsquery('simple', f_unaccent(${s.q})) AS tsq, f_unaccent(lower(${s.q})) AS raw)
          SELECT d.item_type, d.item_code, d.name, d.kind, d.sports, d.roles, d.muscles, d.equipment, d.level,
                 round((ts_rank_cd(d.search_tsv, q.tsq) * 2
                        + ${wordScore}
                        + word_similarity(q.raw, f_unaccent(lower(d.name))) * 0.5
                        + ln(1 + d.popularity) * 0.05)::numeric, 4) AS score
          FROM catalog_search_doc d, q
          WHERE d.status = 'PUBLISHED' AND d.locale = ${s.locale}
            AND (d.search_tsv @@ q.tsq OR (${allWordsMatch}))
            AND (${arr(s.types)}::text[] IS NULL OR d.item_type = ANY (${arr(s.types)}::text[]))
            AND (${arr(s.kinds)}::text[] IS NULL OR d.kind = ANY (${arr(s.kinds)}::text[]))
            AND (${arr(s.sports)}::text[] IS NULL OR d.sports && ${arr(s.sports)}::text[])
            AND (${arr(s.roles)}::text[] IS NULL OR d.roles && ${arr(s.roles)}::text[])
            AND (${arr(s.muscles)}::text[] IS NULL OR d.muscles && ${arr(s.muscles)}::text[])
            AND (${arr(s.equipment)}::text[] IS NULL OR d.equipment && ${arr(s.equipment)}::text[])
            AND (${arr(s.categories)}::text[] IS NULL OR d.categories && ${arr(s.categories)}::text[])
          ORDER BY score DESC, d.item_code
          LIMIT ${s.limit}`.execute(trx);
        return rows.map((r) => ({ ...r, score: Number(r.score) }));
      });
    } catch (err) {
      if (isQueryTimeout(err)) throw ProblemError.timeout();
      throw err;
    }
  }
}
