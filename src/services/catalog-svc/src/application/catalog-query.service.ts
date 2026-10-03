import { Inject, Injectable } from '@nestjs/common';
import type { JsonCache } from '@trainme/cache';
import type { Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { CACHE, DATABASE } from '@trainme/service-kit';
import type {
  ActivitySnapshot,
  CategoryNode,
  MetricDefinition,
  ParameterDefinition,
  TemplateSnapshot,
  TemplateSummary,
} from '../domain/catalog.model.js';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';

export const CACHE_KEYS = {
  version: 'cat:version',
  units: 'cat:units',
  tree: (v: string) => `cat:tree:${v}`,
  templateLatest: (code: string) => `cat:tpl:${code}:latest`,
  template: (code: string, version: number) => `cat:tpl:${code}:v${version}`,
  activityLatest: (code: string) => `cat:act:${code}:latest`,
};

type ParamRow = {
  activityId: string | null;
  parameterSetId: string | null;
  key: string;
  label: string;
  dataType: string;
  unit: string | null;
  dimension: string | null;
  allowedUnits: string[] | null;
  constraints: Record<string, unknown>;
  condition: Record<string, unknown> | null;
  defaultAgg: string;
  isRequired: boolean;
  description: string | null;
};
type MetricRow = {
  activityId: string | null;
  parameterSetId: string | null;
  key: string;
  label: string;
  kind: 'RATIO' | 'SINGLE';
  numerator: unknown;
  denominator: unknown;
  display: Record<string, unknown>;
};

const toParam = (r: ParamRow): ParameterDefinition => ({
  key: r.key,
  label: r.label,
  type: r.dataType as ParameterDefinition['type'],
  ...(r.unit ? { unit: r.unit } : {}),
  ...(r.dimension ? { dimension: r.dimension } : {}),
  ...(r.allowedUnits ? { allowedUnits: r.allowedUnits } : {}),
  constraints: r.constraints,
  ...(r.condition ? { condition: r.condition as unknown as ParameterDefinition['condition'] } : {}),
  agg: r.defaultAgg as ParameterDefinition['agg'],
  required: r.isRequired,
  ...(r.description ? { description: r.description } : {}),
});

const toMetric = (r: MetricRow): MetricDefinition => ({
  key: r.key,
  label: r.label,
  kind: r.kind,
  numerator: r.numerator as MetricDefinition['numerator'],
  ...(r.denominator ? { denominator: r.denominator as MetricDefinition['denominator'] } : {}),
  display: r.display as unknown as MetricDefinition['display'],
});

@Injectable()
export class CatalogQueryService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<CatalogDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
  ) {}

  /** Bumped by seeding and publishing; part of every derived cache key. */
  async catalogVersion(): Promise<string> {
    return (await this.cache.get<string>(CACHE_KEYS.version)) ?? '0';
  }

  async getUnits() {
    return this.cache.getOrLoad(CACHE_KEYS.units, 3600, async () => ({
      dimensions: await this.db.selectFrom('unitDimension').selectAll().orderBy('code').execute(),
      units: await this.db.selectFrom('unit').selectAll().orderBy('dimension').orderBy('code').execute(),
    }));
  }

  /** Whole active tree (≈ 50 nodes) with the number of published templates per node. */
  async getCategoryTree(): Promise<CategoryNode[]> {
    const version = await this.catalogVersion();
    return this.cache.getOrLoad(CACHE_KEYS.tree(version), 3600, async () => {
      const rows = await this.db
        .selectFrom('category as c')
        .leftJoin('category as p', 'p.id', 'c.parentId')
        .select((eb) => [
          'c.code',
          'c.name',
          'c.kind',
          'c.level',
          'p.code as parentCode',
          eb
            .selectFrom('profileTemplate as t')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('t.categoryId', '=', 'c.id')
            .where('t.status', '=', 'PUBLISHED')
            .as('templateCount'),
        ])
        .where('c.status', '=', 'ACTIVE')
        .orderBy('c.level')
        .orderBy('c.sortOrder')
        .execute();
      return rows.map((r) => ({ ...r, parentCode: r.parentCode ?? null, templateCount: Number(r.templateCount ?? 0) }));
    });
  }

  /** Published templates, optionally limited to a category and all of its descendants. */
  async listTemplates(categoryCode?: string): Promise<TemplateSummary[]> {
    let q = this.db
      .selectFrom('profileTemplate as t')
      .innerJoin('category as c', 'c.id', 't.categoryId')
      .select((eb) => [
        't.code',
        't.version',
        't.name',
        't.description',
        'c.code as categoryCode',
        eb
          .selectFrom('templateActivity as ta')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('ta.profileTemplateId', '=', 't.id')
          .as('activityCount'),
      ])
      .where('t.status', '=', 'PUBLISHED');
    if (categoryCode) {
      const subtree = await this.db
        .withRecursive('sub(id)', (db) =>
          db
            .selectFrom('category')
            .select('id')
            .where('code', '=', categoryCode)
            .unionAll(db.selectFrom('category as ch').innerJoin('sub', 'sub.id', 'ch.parentId').select('ch.id')),
        )
        .selectFrom('sub')
        .select('sub.id')
        .execute();
      if (subtree.length === 0) return [];
      q = q.where(
        't.categoryId',
        'in',
        subtree.map((r) => r.id),
      );
    }
    const rows = await q.orderBy('t.name').execute();
    return rows.map((r) => ({ ...r, activityCount: Number(r.activityCount ?? 0) }));
  }

  /** Full snapshot of a template version (latest published when version is omitted). */
  async getTemplate(code: string, version?: number): Promise<TemplateSnapshot> {
    const v =
      version ??
      (await this.cache.getOrLoad(CACHE_KEYS.templateLatest(code), 3600, async () => {
        const row = await this.db
          .selectFrom('profileTemplate')
          .select('version')
          .where('code', '=', code)
          .where('status', '=', 'PUBLISHED')
          .orderBy('version', 'desc')
          .limit(1)
          .executeTakeFirst();
        return row?.version ?? null;
      }));
    if (v === null || v === undefined) throw ProblemError.notFound(`Template ${code}`);
    // Versions are immutable, so their snapshots are cached without expiry.
    const snapshot = await this.cache.getOrLoad(CACHE_KEYS.template(code, v), 0, () => this.loadTemplate(code, v));
    if (!snapshot || snapshot.status === 'DRAFT') throw ProblemError.notFound(`Template ${code} v${v}`);
    return snapshot;
  }

  async getActivity(code: string): Promise<ActivitySnapshot> {
    return this.cache.getOrLoad(CACHE_KEYS.activityLatest(code), 3600, async () => {
      const row = await this.db
        .selectFrom('activityDefinition')
        .select('id')
        .where('code', '=', code)
        .where('status', '=', 'PUBLISHED')
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!row) throw ProblemError.notFound(`Activity ${code}`);
      const acts = await this.loadActivities([{ activityId: row.id, targets: {} }]);
      return acts[0]!;
    });
  }

  private async loadTemplate(code: string, version: number): Promise<TemplateSnapshot | null> {
    const t = await this.db
      .selectFrom('profileTemplate as t')
      .innerJoin('category as c', 'c.id', 't.categoryId')
      .select(['t.id', 't.code', 't.version', 't.name', 't.description', 't.status', 'c.code as categoryCode'])
      .where('t.code', '=', code)
      .where('t.version', '=', version)
      .executeTakeFirst();
    if (!t) return null;
    const links = await this.db
      .selectFrom('templateActivity')
      .select(['activityId', 'targets'])
      .where('profileTemplateId', '=', t.id)
      .orderBy('sortOrder')
      .execute();
    const activities = await this.loadActivities(links);
    return {
      code: t.code,
      version: t.version,
      name: t.name,
      description: t.description,
      categoryCode: t.categoryCode,
      status: t.status,
      activities,
    };
  }

  /**
   * Assembles activity snapshots with their effective parameters and metrics:
   * parameter-set members first (in set order), then the activity's own items (same key overrides).
   */
  private async loadActivities(
    links: { activityId: string; targets: Record<string, unknown> }[],
  ): Promise<ActivitySnapshot[]> {
    if (links.length === 0) return [];
    const ids = links.map((l) => l.activityId);
    const acts = await this.db.selectFrom('activityDefinition').selectAll().where('id', 'in', ids).execute();
    const psetLinks = await this.db
      .selectFrom('activityParameterSet')
      .select(['activityId', 'parameterSetId'])
      .where('activityId', 'in', ids)
      .orderBy('sortOrder')
      .execute();
    const psetIds = [...new Set(psetLinks.map((l) => l.parameterSetId))];
    const paramCols = [
      'activityId',
      'parameterSetId',
      'key',
      'label',
      'dataType',
      'unit',
      'dimension',
      'allowedUnits',
      'constraints',
      'condition',
      'defaultAgg',
      'isRequired',
      'description',
    ] as const;
    const metricCols = [
      'activityId',
      'parameterSetId',
      'key',
      'label',
      'kind',
      'numerator',
      'denominator',
      'display',
    ] as const;
    // Two index-friendly queries per table instead of one OR across the two owner columns.
    const [ownParams, setParams, ownMetrics, setMetrics] = await Promise.all([
      this.db
        .selectFrom('parameterDefinition')
        .select(paramCols)
        .where('activityId', 'in', ids)
        .orderBy('sortOrder')
        .execute(),
      psetIds.length
        ? this.db
            .selectFrom('parameterDefinition')
            .select(paramCols)
            .where('parameterSetId', 'in', psetIds)
            .orderBy('sortOrder')
            .execute()
        : [],
      this.db
        .selectFrom('metricDefinition')
        .select(metricCols)
        .where('activityId', 'in', ids)
        .orderBy('sortOrder')
        .execute(),
      psetIds.length
        ? this.db
            .selectFrom('metricDefinition')
            .select(metricCols)
            .where('parameterSetId', 'in', psetIds)
            .orderBy('sortOrder')
            .execute()
        : [],
    ]);
    const byId = new Map(acts.map((a) => [a.id, a]));
    return links.map(({ activityId, targets }) => {
      const a = byId.get(activityId)!;
      const sets = psetLinks.filter((l) => l.activityId === activityId).map((l) => l.parameterSetId);
      const params = new Map<string, ParameterDefinition>();
      for (const s of sets)
        for (const p of setParams.filter((x) => x.parameterSetId === s)) params.set(p.key, toParam(p));
      for (const p of ownParams.filter((x) => x.activityId === activityId)) params.set(p.key, toParam(p));
      const metrics = new Map<string, MetricDefinition>();
      for (const s of sets)
        for (const m of setMetrics.filter((x) => x.parameterSetId === s)) metrics.set(m.key, toMetric(m));
      for (const m of ownMetrics.filter((x) => x.activityId === activityId)) metrics.set(m.key, toMetric(m));
      return {
        code: a.code,
        version: a.version,
        name: a.name,
        kind: a.kind,
        recordingMode: a.recordingMode,
        grouping: a.grouping,
        maxEntries: a.maxEntries,
        description: a.description,
        equipment: a.equipment,
        primaryMuscles: a.primaryMuscles,
        secondaryMuscles: a.secondaryMuscles,
        targets,
        parameters: [...params.values()],
        metrics: [...metrics.values()],
      };
    });
  }
}
