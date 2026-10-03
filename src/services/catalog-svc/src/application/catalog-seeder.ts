import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { newId } from '@trainme/db';
import { EVENT_TYPES, TOPICS, type TemplatePublishedPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import type { ParameterDefinition, MetricDefinition } from '../domain/catalog.model.js';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';
import { rebuildSearchDocuments } from './search-documents.js';

// ---------------------------------------------------------------- seed file shape (catalog.json)
interface SeedParam {
  key: string;
  label: string;
  type: string;
  unit?: string;
  dimension?: string;
  constraints?: { min?: number; max?: number; step?: number; options?: string[]; max_ref?: string };
  condition?: { when: { key: string; eq: boolean | string } };
  agg: string;
  required: boolean;
  description?: string;
}
type SeedMetric = MetricDefinition;
interface SeedParameterSet {
  code: string;
  name: string;
  description?: string;
  params: SeedParam[];
  metrics: SeedMetric[];
}
interface SeedActivity {
  code: string;
  name: string;
  kind: string;
  recordingMode: 'PER_SESSION' | 'PER_SET' | 'PER_ATTEMPT';
  categories: string[];
  sports: string[];
  roles: string[];
  parameterSets: string[];
  params: SeedParam[];
  metrics: SeedMetric[];
  grouping: { label: string; size: number } | null;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  mechanic: string | null;
  force: string | null;
  level: string | null;
  synonyms: string[];
  description?: string;
}
interface SeedTemplate {
  code: string;
  name: string;
  category: string;
  description?: string;
  activities: { activity: string; targetSets?: number; targetReps?: string }[];
}
interface SeedCategory {
  code: string;
  name: string;
  parent: string | null;
  kind: string;
  description?: string;
}
export interface CatalogSeedFile {
  version: string;
  lookups: {
    units: {
      dimensions: { code: string; name: string; baseUnit: string }[];
      units: {
        code: string;
        label: string;
        dimension: string | null;
        toBase: number | null;
        system: 'METRIC' | 'IMPERIAL' | 'BOTH';
        counterpart: string | null;
        decimals: number;
        step: number | null;
      }[];
    };
  };
  categories: SeedCategory[];
  parameterSets: SeedParameterSet[];
  activities: SeedActivity[];
  templates: SeedTemplate[];
}

export interface SeedResult {
  skipped: boolean;
  contentHash: string;
  stats: Record<string, number>;
}

type Trx = Transaction<CatalogDatabase>;
interface Versioned {
  id: string;
  version: number;
  hash: string;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Normalises a seed parameter (snake_case `max_ref`) to the API shape. */
export function toParameterDefinition(p: SeedParam): ParameterDefinition {
  const c = p.constraints ?? {};
  return {
    key: p.key,
    label: p.label,
    type: p.type as ParameterDefinition['type'],
    ...(p.unit ? { unit: p.unit } : {}),
    ...(p.dimension ? { dimension: p.dimension } : {}),
    constraints: {
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
      ...(c.step !== undefined ? { step: c.step } : {}),
      ...(c.options ? { options: c.options } : {}),
      ...(c.max_ref ? { maxRef: c.max_ref } : {}),
    },
    ...(p.condition ? { condition: p.condition } : {}),
    agg: p.agg as ParameterDefinition['agg'],
    required: p.required,
    ...(p.description ? { description: p.description } : {}),
  };
}

/**
 * Imports catalog.json (LLD §11): idempotent by file hash, upserts by code, creates version n+1
 * for changed items (published versions stay immutable), retires removed SEED items, never
 * touches ADMIN rows, rebuilds the search documents and announces changed templates.
 */
export class CatalogSeeder {
  constructor(
    private readonly db: Kysely<CatalogDatabase>,
    private readonly outbox: OutboxWriter,
    private readonly log: Logger,
  ) {}

  async seed(rawJson: string): Promise<SeedResult> {
    const contentHash = sha256(rawJson);
    const file = JSON.parse(rawJson) as CatalogSeedFile;
    const done = await this.db
      .selectFrom('catalogSeedRun')
      .select('contentHash')
      .where('contentHash', '=', contentHash)
      .executeTakeFirst();
    if (done) {
      this.log.info({ contentHash }, 'catalog seed already applied');
      return { skipped: true, contentHash, stats: {} };
    }
    return this.db.transaction().execute(async (trx) => {
      // Several replicas may start together; only one seeds, the others then see the run row.
      await sql`SELECT pg_advisory_xact_lock(hashtext('catalog-seed'))`.execute(trx);
      const again = await trx
        .selectFrom('catalogSeedRun')
        .select('contentHash')
        .where('contentHash', '=', contentHash)
        .executeTakeFirst();
      if (again) return { skipped: true, contentHash, stats: {} };

      await this.upsertUnits(trx, file);
      const categories = await this.upsertCategories(trx, file.categories);
      const psets = await this.upsertParameterSets(trx, file.parameterSets);
      const activities = await this.upsertActivities(trx, file.activities, psets);
      const changed = await this.upsertTemplates(trx, file.templates, activities, categories);
      const retired = await this.retireMissing(trx, file);
      const docs = await rebuildSearchDocuments(trx);
      for (const t of changed) {
        await this.outbox.enqueue<TemplatePublishedPayload>(trx, TOPICS.catalog, {
          type: EVENT_TYPES.templatePublished,
          userId: 'system',
          key: t.code,
          subject: `template/${t.code}`,
          data: { templateCode: t.code, version: t.version, name: t.name },
        });
      }
      const stats = {
        categories: categories.size,
        parameterSets: psets.size,
        activities: activities.size,
        templates: file.templates.length,
        templatesChanged: changed.length,
        retired,
        searchDocuments: docs,
      };
      await trx
        .insertInto('catalogSeedRun')
        .values({ contentHash, version: file.version, stats: JSON.stringify(stats) })
        .execute();
      this.log.info({ contentHash, ...stats }, 'catalog seed applied');
      return { skipped: false, contentHash, stats };
    });
  }

  private async upsertUnits(trx: Trx, file: CatalogSeedFile): Promise<void> {
    const { dimensions, units } = file.lookups.units;
    await trx
      .insertInto('unitDimension')
      .values(dimensions.map((d) => ({ code: d.code, name: d.name, baseUnit: d.baseUnit })))
      .onConflict((oc) =>
        oc
          .column('code')
          .doUpdateSet((eb) => ({ name: eb.ref('excluded.name'), baseUnit: eb.ref('excluded.baseUnit') })),
      )
      .execute();
    await trx
      .insertInto('unit')
      .values(units.map((u) => ({ ...u })))
      .onConflict((oc) =>
        oc.column('code').doUpdateSet((eb) => ({
          dimension: eb.ref('excluded.dimension'),
          label: eb.ref('excluded.label'),
          toBase: eb.ref('excluded.toBase'),
          system: eb.ref('excluded.system'),
          counterpart: eb.ref('excluded.counterpart'),
          decimals: eb.ref('excluded.decimals'),
          step: eb.ref('excluded.step'),
        })),
      )
      .execute();
  }

  /** Parents before children; returns code → id for every category in the file. */
  private async upsertCategories(trx: Trx, cats: SeedCategory[]): Promise<Map<string, string>> {
    const byCode = new Map(cats.map((c) => [c.code, c]));
    const depth = (c: SeedCategory): number => (c.parent ? 1 + depth(byCode.get(c.parent)!) : 1);
    const ordered = [...cats].sort((a, b) => depth(a) - depth(b));
    const existing = await trx.selectFrom('category').select(['id', 'code', 'source']).execute();
    const ids = new Map(existing.map((r) => [r.code, r.id]));
    const sources = new Map(existing.map((r) => [r.code, r.source]));
    for (const [i, c] of ordered.entries()) {
      const parentId = c.parent ? ids.get(c.parent)! : null;
      const row = {
        parentId,
        name: c.name,
        kind: c.kind,
        level: depth(c),
        sortOrder: i,
        description: c.description ?? null,
      };
      const id = ids.get(c.code);
      if (!id) {
        const newCatId = newId();
        await trx
          .insertInto('category')
          .values({ id: newCatId, code: c.code, status: 'ACTIVE', source: 'SEED', ...row })
          .execute();
        ids.set(c.code, newCatId);
      } else if (sources.get(c.code) !== 'ADMIN') {
        await trx
          .updateTable('category')
          .set({ ...row, status: 'ACTIVE', updatedAt: new Date() })
          .where('id', '=', id)
          .execute();
      }
    }
    return ids;
  }

  private async latest(trx: Trx, table: 'parameterSet' | 'activityDefinition' | 'profileTemplate', code: string) {
    return trx
      .selectFrom(table)
      .select(['id', 'version', 'contentHash'])
      .where('code', '=', code)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  private async upsertParameterSets(trx: Trx, sets: SeedParameterSet[]): Promise<Map<string, Versioned>> {
    const out = new Map<string, Versioned>();
    for (const s of sets) {
      const hash = sha256(JSON.stringify(s));
      const prev = await this.latest(trx, 'parameterSet', s.code);
      if (prev?.contentHash === hash) {
        out.set(s.code, { id: prev.id, version: prev.version, hash });
        continue;
      }
      const id = newId();
      const version = (prev?.version ?? 0) + 1;
      await trx
        .insertInto('parameterSet')
        .values({ id, code: s.code, version, name: s.name, description: s.description ?? null, contentHash: hash })
        .execute();
      await this.insertParameters(trx, { parameterSetId: id }, s.params);
      await this.insertMetrics(trx, { parameterSetId: id }, s.metrics);
      out.set(s.code, { id, version, hash });
    }
    return out;
  }

  private async upsertActivities(
    trx: Trx,
    acts: SeedActivity[],
    psets: Map<string, Versioned>,
  ): Promise<Map<string, Versioned>> {
    const out = new Map<string, Versioned>();
    for (const a of acts) {
      const hash = sha256(JSON.stringify({ a, psets: a.parameterSets.map((c) => psets.get(c)?.hash) }));
      const prev = await this.latest(trx, 'activityDefinition', a.code);
      if (prev?.contentHash === hash) {
        out.set(a.code, { id: prev.id, version: prev.version, hash });
        continue;
      }
      const id = newId();
      const version = (prev?.version ?? 0) + 1;
      if (prev) {
        await trx
          .updateTable('activityDefinition')
          .set({ status: 'RETIRED' })
          .where('code', '=', a.code)
          .where('status', '=', 'PUBLISHED')
          .where('source', '=', 'SEED')
          .execute();
      }
      await trx
        .insertInto('activityDefinition')
        .values({
          id,
          code: a.code,
          version,
          name: a.name,
          kind: a.kind,
          recordingMode: a.recordingMode,
          grouping: a.grouping ? JSON.stringify(a.grouping) : null,
          maxEntries: 500,
          categoryCodes: a.categories,
          sports: a.sports,
          roles: a.roles,
          equipment: a.equipment,
          primaryMuscles: a.primaryMuscles,
          secondaryMuscles: a.secondaryMuscles,
          mechanic: a.mechanic,
          force: a.force,
          level: a.level,
          synonyms: a.synonyms,
          description: a.description ?? null,
          status: 'PUBLISHED',
          source: 'SEED',
          license: null,
          contentHash: hash,
        })
        .execute();
      if (a.parameterSets.length > 0) {
        await trx
          .insertInto('activityParameterSet')
          .values(a.parameterSets.map((c, i) => ({ activityId: id, parameterSetId: psets.get(c)!.id, sortOrder: i })))
          .execute();
      }
      await this.insertParameters(trx, { activityId: id }, a.params);
      await this.insertMetrics(trx, { activityId: id }, a.metrics);
      out.set(a.code, { id, version, hash });
    }
    return out;
  }

  private async upsertTemplates(
    trx: Trx,
    tpls: SeedTemplate[],
    acts: Map<string, Versioned>,
    cats: Map<string, string>,
  ): Promise<{ code: string; version: number; name: string }[]> {
    const changed: { code: string; version: number; name: string }[] = [];
    for (const t of tpls) {
      const hash = sha256(JSON.stringify({ t, acts: t.activities.map((x) => acts.get(x.activity)?.hash) }));
      const prev = await this.latest(trx, 'profileTemplate', t.code);
      if (prev?.contentHash === hash) continue;
      const id = newId();
      const version = (prev?.version ?? 0) + 1;
      if (prev) {
        await trx
          .updateTable('profileTemplate')
          .set({ status: 'RETIRED' })
          .where('code', '=', t.code)
          .where('status', '=', 'PUBLISHED')
          .where('source', '=', 'SEED')
          .execute();
      }
      await trx
        .insertInto('profileTemplate')
        .values({
          id,
          categoryId: cats.get(t.category)!,
          code: t.code,
          version,
          name: t.name,
          description: t.description ?? null,
          status: 'PUBLISHED',
          ownerId: null,
          source: 'SEED',
          contentHash: hash,
          publishedAt: new Date(),
        })
        .execute();
      await trx
        .insertInto('templateActivity')
        .values(
          t.activities.map((x, i) => ({
            profileTemplateId: id,
            activityId: acts.get(x.activity)!.id,
            sortOrder: i,
            targets: JSON.stringify({
              ...(x.targetSets !== undefined ? { targetSets: x.targetSets } : {}),
              ...(x.targetReps !== undefined ? { targetReps: x.targetReps } : {}),
            }),
          })),
        )
        .execute();
      changed.push({ code: t.code, version, name: t.name });
    }
    return changed;
  }

  /** SEED items no longer in the file are retired (never deleted: trackers may still pin them). */
  private async retireMissing(trx: Trx, file: CatalogSeedFile): Promise<number> {
    const keep = (codes: string[]) => (codes.length ? codes : ['__none__']);
    const r1 = await trx
      .updateTable('category')
      .set({ status: 'RETIRED', updatedAt: new Date() })
      .where('source', '=', 'SEED')
      .where('status', '=', 'ACTIVE')
      .where('code', 'not in', keep(file.categories.map((c) => c.code)))
      .executeTakeFirst();
    const r2 = await trx
      .updateTable('activityDefinition')
      .set({ status: 'RETIRED' })
      .where('source', '=', 'SEED')
      .where('status', '=', 'PUBLISHED')
      .where('code', 'not in', keep(file.activities.map((a) => a.code)))
      .executeTakeFirst();
    const r3 = await trx
      .updateTable('profileTemplate')
      .set({ status: 'RETIRED' })
      .where('source', '=', 'SEED')
      .where('status', '=', 'PUBLISHED')
      .where('code', 'not in', keep(file.templates.map((t) => t.code)))
      .executeTakeFirst();
    return Number(r1.numUpdatedRows + r2.numUpdatedRows + r3.numUpdatedRows);
  }

  private async insertParameters(
    trx: Trx,
    owner: { activityId?: string; parameterSetId?: string },
    params: SeedParam[],
  ) {
    if (params.length === 0) return;
    await trx
      .insertInto('parameterDefinition')
      .values(
        params.map((raw, i) => {
          const p = toParameterDefinition(raw);
          return {
            id: newId(),
            activityId: owner.activityId ?? null,
            parameterSetId: owner.parameterSetId ?? null,
            key: p.key,
            label: p.label,
            dataType: p.type,
            unit: p.unit ?? null,
            dimension: p.dimension ?? null,
            allowedUnits: null,
            constraints: JSON.stringify(p.constraints),
            condition: p.condition ? JSON.stringify(p.condition) : null,
            defaultAgg: p.agg,
            isRequired: p.required,
            description: p.description ?? null,
            sortOrder: i,
          };
        }),
      )
      .execute();
  }

  private async insertMetrics(
    trx: Trx,
    owner: { activityId?: string; parameterSetId?: string },
    metrics: SeedMetric[],
  ) {
    if (metrics.length === 0) return;
    await trx
      .insertInto('metricDefinition')
      .values(
        metrics.map((m, i) => ({
          id: newId(),
          activityId: owner.activityId ?? null,
          parameterSetId: owner.parameterSetId ?? null,
          key: m.key,
          label: m.label,
          kind: m.kind,
          numerator: JSON.stringify(m.numerator),
          denominator: m.denominator ? JSON.stringify(m.denominator) : null,
          display: JSON.stringify(m.display),
          sortOrder: i,
        })),
      )
      .execute();
  }
}
