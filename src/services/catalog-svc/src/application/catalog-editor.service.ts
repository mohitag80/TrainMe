import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { JsonCache } from '@trainme/cache';
import { newId, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError, type FieldError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type TemplatePublishedPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import {
  compileEffectiveSchema,
  type ActivitySnapshot,
  type MetricDefinition,
  type Override,
  type ParameterDefinition,
  type RecordingMode,
} from '@trainme/schema';
import { CACHE, DATABASE, OUTBOX } from '@trainme/service-kit';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { CACHE_KEYS, CatalogQueryService } from './catalog-query.service.js';
import { rebuildSearchDocuments } from './search-documents.js';

type Trx = Transaction<CatalogDatabase>;
type Status = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export const CATEGORY_KINDS = ['AREA', 'SPORT', 'DISCIPLINE', 'ROLE_GROUP', 'ROLE', 'MUSCLE_GROUP', 'MUSCLE'] as const;
export const ACTIVITY_KINDS = ['EXERCISE', 'DRILL', 'TEST', 'MATCH', 'LOG'] as const;

export interface CategoryInput {
  parentCode: string;
  name: string;
  kind: (typeof CATEGORY_KINDS)[number];
  description?: string | null;
}
export interface ActivityInput {
  name: string;
  categoryCode: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  recordingMode: RecordingMode;
  description?: string | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  equipment: string[];
  synonyms: string[];
  parameters: ParameterDefinition[];
  metrics: MetricDefinition[];
}
export interface TemplateInput {
  name: string;
  categoryCode: string;
  description?: string | null;
  activityCodes: string[];
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  level: number;
  parentId: string | null;
  sortOrder: number;
  status: string;
}

const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** "Table Tennis – Serve" → "table_tennis_serve" (codes are internal; the UI only shows names). */
export const slug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'x$1')
    .slice(0, 50) || 'item';

/**
 * Catalog editor (Admin Console): categories, draft activities and draft templates, validation with the same
 * rules trackers use, and publishing. Published versions stay immutable; edits always create a new draft.
 */
@Injectable()
export class CatalogEditorService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<CatalogDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    private readonly query: CatalogQueryService,
    private readonly admin: CatalogAdminService,
  ) {}

  // ---------------------------------------------------------------- category tree

  /** Every category with its display path and how many templates/activities sit there (any status). */
  async tree() {
    const cats = await this.categories(this.db);
    const [tpls, acts] = await Promise.all([
      this.db.selectFrom('profileTemplate').select(['code', 'categoryId', 'status', 'version']).execute(),
      this.db.selectFrom('activityDefinition').select(['code', 'categoryCodes', 'status', 'version']).execute(),
    ]);
    const latestTpl = latestPerCode(tpls);
    const latestAct = latestPerCode(acts);
    return cats.map((c) => ({
      code: c.code,
      name: c.name,
      kind: c.kind,
      level: c.level,
      parentCode: cats.find((p) => p.id === c.parentId)?.code ?? null,
      path: pathOf(c, cats).map((p) => p.name),
      templates: latestTpl.filter((t) => t.categoryId === c.id).length,
      activities: latestAct.filter((a) => a.categoryCodes.includes(c.code)).length,
    }));
  }

  async createCategory(actorId: string, input: CategoryInput) {
    return this.db
      .transaction()
      .execute(async (trx) => {
        const cats = await this.categories(trx);
        const parent = cats.find((c) => c.code === input.parentCode);
        if (!parent) throw ProblemError.validation([field('/body/parentCode', 'unknown', 'Choose where it belongs')]);
        if (parent.level >= 6)
          throw ProblemError.validation([field('/body/parentCode', 'too-deep', 'The tree is at most 6 levels deep')]);
        const name = input.name.trim();
        const siblings = cats.filter((c) => c.parentId === parent.id);
        if (siblings.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          throw ProblemError.validation([
            field('/body/name', 'duplicate', `“${name}” already exists under ${parent.name}`),
          ]);
        // Sports directly under a domain or group keep short codes (badminton); everything else is prefixed.
        const short = parent.kind === 'DOMAIN' || (input.kind === 'SPORT' && parent.kind === 'AREA');
        const code = uniqueCode(short ? slug(name) : `${parent.code}.${slug(name)}`, new Set(cats.map((c) => c.code)));
        const id = newId();
        await trx
          .insertInto('category')
          .values({
            id,
            parentId: parent.id,
            code,
            name,
            description: input.description?.trim() || null,
            level: parent.level + 1,
            kind: input.kind,
            sortOrder: Math.max(0, ...siblings.map((s) => s.sortOrder)) + 1,
            status: 'ACTIVE',
            source: 'ADMIN',
          })
          .execute();
        await this.audit(trx, actorId, 'CREATE', 'CATEGORY', code, { name, parent: parent.code });
        await rebuildSearchDocuments(trx);
        return { code, name, path: [...pathOf(parent, cats).map((p) => p.name), name] };
      })
      .finally(() => this.admin.invalidate());
  }

  async renameCategory(actorId: string, code: string, input: { name?: string; description?: string | null }) {
    await this.db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('category').select(['id', 'name']).where('code', '=', code).executeTakeFirst();
      if (!c) throw ProblemError.notFound('Category');
      await trx
        .updateTable('category')
        .set({
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          source: 'ADMIN', // the seed import no longer overwrites it
          updatedAt: new Date(),
        })
        .where('id', '=', c.id)
        .execute();
      await this.audit(trx, actorId, 'UPDATE', 'CATEGORY', code, { from: c.name, ...input });
      await rebuildSearchDocuments(trx);
    });
    await this.admin.invalidate();
  }

  // ---------------------------------------------------------------- activities

  /** Latest version of every activity code with its status, placement and usage. */
  async listActivities(q?: string) {
    const [cats, rows, used] = await Promise.all([
      this.categories(this.db),
      this.db
        .selectFrom('activityDefinition')
        .select(['code', 'version', 'name', 'status', 'kind', 'recordingMode', 'categoryCodes', 'source', 'createdAt'])
        .execute(),
      this.usage(),
    ]);
    const term = q?.trim().toLowerCase();
    return latestPerCode(rows)
      .filter((a) => !term || a.name.toLowerCase().includes(term))
      .map((a) => ({
        code: a.code,
        name: a.name,
        version: a.version,
        status: a.status,
        publishedVersion: maxVersion(rows, a.code, 'PUBLISHED'),
        hasDraft: rows.some((r) => r.code === a.code && r.status === 'DRAFT'),
        kind: a.kind,
        recordingMode: a.recordingMode,
        placements: a.categoryCodes.map((cc) => namePath(cc, cats)).filter((p) => p.length > 0),
        usedBy: used.get(a.code) ?? [],
        updatedAt: a.createdAt,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /** One activity version for the editor (drafts included), with its version history and usage. */
  async getActivity(code: string, version: number) {
    const row = await this.db
      .selectFrom('activityDefinition')
      .selectAll()
      .where('code', '=', code)
      .where('version', '=', version)
      .executeTakeFirst();
    if (!row) throw ProblemError.notFound('Activity version');
    const [snap] = await this.query.loadActivities([{ activityId: row.id, targets: {} }]);
    const [cats, versions, used] = await Promise.all([
      this.categories(this.db),
      this.db
        .selectFrom('activityDefinition')
        .select(['version', 'status', 'createdAt', 'source'])
        .where('code', '=', code)
        .orderBy('version', 'desc')
        .execute(),
      this.usage(code),
    ]);
    return {
      code,
      version,
      status: row.status,
      name: row.name,
      categoryCode: row.categoryCodes[0] ?? null,
      placements: row.categoryCodes.map((cc) => namePath(cc, cats)),
      kind: row.kind,
      recordingMode: row.recordingMode,
      description: row.description,
      level: row.level,
      equipment: row.equipment,
      synonyms: row.synonyms,
      parameters: snap!.parameters,
      metrics: snap!.metrics,
      versions,
      usedBy: used.get(code) ?? [],
    };
  }

  async createActivity(actorId: string, input: ActivityInput) {
    const issues = validateActivity(input);
    if (issues.length) throw ProblemError.validation(issues);
    return this.db.transaction().execute(async (trx) => {
      const cats = await this.categories(trx);
      const cat = cats.find((c) => c.code === input.categoryCode);
      if (!cat) throw ProblemError.validation([field('/body/categoryCode', 'unknown', 'Choose where it belongs')]);
      const prefix = pathOf(cat, cats).find((c) => c.kind === 'SPORT')?.code ?? cat.code;
      const taken = await trx.selectFrom('activityDefinition').select('code').distinct().execute();
      const code = uniqueCode(`${prefix}.${slug(input.name)}`, new Set(taken.map((t) => t.code)));
      await this.insertActivity(trx, code, 1, input, cats);
      await this.audit(trx, actorId, 'CREATE', 'ACTIVITY', code, { version: 1, name: input.name });
      return { code, version: 1 };
    });
  }

  /** Starts editing a published activity: copies its latest version into a new draft (or returns the open one). */
  async draftActivity(actorId: string, code: string) {
    const versions = await this.db
      .selectFrom('activityDefinition')
      .select(['version', 'status'])
      .where('code', '=', code)
      .orderBy('version', 'desc')
      .execute();
    if (!versions.length) throw ProblemError.notFound('Activity');
    const open = versions.find((v) => v.status === 'DRAFT');
    if (open) return { code, version: open.version };
    const current = await this.getActivity(code, versions[0]!.version);
    return this.db.transaction().execute(async (trx) => {
      const version = versions[0]!.version + 1;
      await this.insertActivity(trx, code, version, toInput(current), await this.categories(trx));
      await this.audit(trx, actorId, 'DRAFT', 'ACTIVITY', code, { version, from: current.version });
      return { code, version };
    });
  }

  async updateActivity(actorId: string, code: string, version: number, input: ActivityInput) {
    const issues = validateActivity(input);
    if (issues.length) throw ProblemError.validation(issues);
    await this.db.transaction().execute(async (trx) => {
      const row = await this.lockDraft(trx, 'activityDefinition', code, version);
      await this.checkHistoryCompatible(trx, code, input.parameters);
      await trx.deleteFrom('activityDefinition').where('id', '=', row.id).execute(); // cascades fields and stats
      await this.insertActivity(trx, code, version, input, await this.categories(trx));
      await this.audit(trx, actorId, 'UPDATE', 'ACTIVITY', code, { version });
    });
    return { code, version };
  }

  async deleteActivityDraft(actorId: string, code: string, version: number) {
    await this.db.transaction().execute(async (trx) => {
      const row = await this.lockDraft(trx, 'activityDefinition', code, version);
      const linked = await trx
        .selectFrom('templateActivity as ta')
        .innerJoin('profileTemplate as t', 't.id', 'ta.profileTemplateId')
        .select('t.name')
        .where('ta.activityId', '=', row.id)
        .execute();
      if (linked.length)
        throw ProblemError.conflict('in-use', `Remove it from ${linked.map((l) => `“${l.name}”`).join(', ')} first`);
      await trx.deleteFrom('activityDefinition').where('id', '=', row.id).execute();
      await this.audit(trx, actorId, 'DELETE_DRAFT', 'ACTIVITY', code, { version });
    });
  }

  /**
   * Publishes an activity version (retiring the previous one). Published templates that use this activity
   * get a new version pointing at it, so trackers see "update available".
   */
  async publishActivity(actorId: string, code: string, version: number) {
    const result = await this.db.transaction().execute(async (trx) => {
      const row = await this.lockDraft(trx, 'activityDefinition', code, version);
      const { name } = await trx
        .selectFrom('activityDefinition')
        .select('name')
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      const fields = await trx
        .selectFrom('parameterDefinition')
        .select('key')
        .where('activityId', '=', row.id)
        .execute();
      if (fields.length === 0)
        throw ProblemError.validation([
          field('/parameters', 'required', `Add at least one field to “${name}” before publishing`),
        ]);
      await trx
        .updateTable('activityDefinition')
        .set({ status: 'RETIRED' })
        .where('code', '=', code)
        .where('status', '=', 'PUBLISHED')
        .execute();
      await trx.updateTable('activityDefinition').set({ status: 'PUBLISHED' }).where('id', '=', row.id).execute();
      const templates = await this.republishTemplatesUsing(trx, actorId, code, row.id);
      await this.audit(trx, actorId, 'PUBLISH', 'ACTIVITY', code, { version, templates });
      await rebuildSearchDocuments(trx);
      return { code, version, status: 'PUBLISHED' as const, updatedTemplates: templates };
    });
    await this.admin.invalidateAll();
    return result;
  }

  async retireActivity(actorId: string, code: string, version: number) {
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('activityDefinition')
        .set({ status: 'RETIRED' })
        .where('code', '=', code)
        .where('version', '=', version)
        .where('status', '=', 'PUBLISHED')
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw ProblemError.conflict('not-published', 'Only a published version can be retired');
      await this.audit(trx, actorId, 'RETIRE', 'ACTIVITY', code, { version });
      await rebuildSearchDocuments(trx);
    });
    await this.admin.invalidateAll();
  }

  // ---------------------------------------------------------------- templates (profiles)

  /** Latest version of every template code, with placement, status and activity count. */
  async listTemplates() {
    const [cats, rows] = await Promise.all([
      this.categories(this.db),
      this.db
        .selectFrom('profileTemplate as t')
        .select((eb) => [
          't.code',
          't.version',
          't.name',
          't.status',
          't.categoryId',
          't.source',
          't.publishedAt',
          't.createdAt',
          eb
            .selectFrom('templateActivity as ta')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('ta.profileTemplateId', '=', 't.id')
            .as('activityCount'),
        ])
        .execute(),
    ]);
    return latestPerCode(rows)
      .map((t) => {
        const cat = cats.find((c) => c.id === t.categoryId);
        return {
          code: t.code,
          name: t.name,
          version: t.version,
          status: t.status,
          publishedVersion: maxVersion(rows, t.code, 'PUBLISHED'),
          hasDraft: rows.some((r) => r.code === t.code && r.status === 'DRAFT'),
          categoryCode: cat?.code ?? null,
          placement: cat ? pathOf(cat, cats).map((c) => c.name) : [],
          activityCount: Number(t.activityCount ?? 0),
          updatedAt: t.publishedAt ?? t.createdAt,
        };
      })
      .sort((a, b) => a.placement.join('›').localeCompare(b.placement.join('›')) || a.name.localeCompare(b.name));
  }

  async getTemplate(code: string, version: number) {
    const t = await this.db
      .selectFrom('profileTemplate')
      .selectAll()
      .where('code', '=', code)
      .where('version', '=', version)
      .executeTakeFirst();
    if (!t) throw ProblemError.notFound('Profile version');
    const [cats, links, versions] = await Promise.all([
      this.categories(this.db),
      this.db
        .selectFrom('templateActivity as ta')
        .innerJoin('activityDefinition as a', 'a.id', 'ta.activityId')
        .select(['a.code', 'a.name', 'a.version', 'a.status', 'a.categoryCodes', 'a.recordingMode', 'ta.sortOrder'])
        .where('ta.profileTemplateId', '=', t.id)
        .orderBy('ta.sortOrder')
        .execute(),
      this.db
        .selectFrom('profileTemplate')
        .select(['version', 'status', 'createdAt', 'publishedAt', 'source'])
        .where('code', '=', code)
        .orderBy('version', 'desc')
        .execute(),
    ]);
    const cat = cats.find((c) => c.id === t.categoryId);
    return {
      code,
      version,
      status: t.status,
      name: t.name,
      description: t.description,
      categoryCode: cat?.code ?? null,
      placement: cat ? pathOf(cat, cats).map((c) => c.name) : [],
      activities: links.map((l) => ({
        code: l.code,
        name: l.name,
        status: l.status,
        recordingMode: l.recordingMode,
        placements: l.categoryCodes.map((cc) => namePath(cc, cats)),
      })),
      versions,
    };
  }

  async createTemplate(actorId: string, input: TemplateInput) {
    return this.db.transaction().execute(async (trx) => {
      const cats = await this.categories(trx);
      const cat = this.requireCategory(cats, input.categoryCode);
      const prefix = pathOf(cat, cats).find((c) => c.kind === 'SPORT')?.code ?? cat.code;
      const taken = await trx.selectFrom('profileTemplate').select('code').distinct().execute();
      const code = uniqueCode(`${prefix}.${slug(input.name)}`, new Set(taken.map((t) => t.code)));
      await this.insertTemplate(trx, code, 1, input, cat.id, 'DRAFT');
      await this.audit(trx, actorId, 'CREATE', 'TEMPLATE', code, { version: 1, name: input.name });
      return { code, version: 1 };
    });
  }

  async draftTemplate(actorId: string, code: string) {
    const versions = await this.db
      .selectFrom('profileTemplate')
      .select(['version', 'status'])
      .where('code', '=', code)
      .orderBy('version', 'desc')
      .execute();
    if (!versions.length) throw ProblemError.notFound('Profile');
    const open = versions.find((v) => v.status === 'DRAFT');
    if (open) return { code, version: open.version };
    const current = await this.getTemplate(code, versions[0]!.version);
    return this.db.transaction().execute(async (trx) => {
      const cats = await this.categories(trx);
      const version = versions[0]!.version + 1;
      const input: TemplateInput = {
        name: current.name,
        description: current.description,
        categoryCode: current.categoryCode ?? '',
        activityCodes: current.activities.map((a) => a.code),
      };
      await this.insertTemplate(trx, code, version, input, this.requireCategory(cats, input.categoryCode).id, 'DRAFT');
      await this.audit(trx, actorId, 'DRAFT', 'TEMPLATE', code, { version, from: current.version });
      return { code, version };
    });
  }

  async updateTemplate(actorId: string, code: string, version: number, input: TemplateInput) {
    await this.db.transaction().execute(async (trx) => {
      const row = await this.lockDraft(trx, 'profileTemplate', code, version);
      const cat = this.requireCategory(await this.categories(trx), input.categoryCode);
      await trx.deleteFrom('profileTemplate').where('id', '=', row.id).execute(); // cascades its activity links
      await this.insertTemplate(trx, code, version, input, cat.id, 'DRAFT');
      await this.audit(trx, actorId, 'UPDATE', 'TEMPLATE', code, { version });
    });
    return { code, version };
  }

  async deleteTemplateDraft(actorId: string, code: string, version: number) {
    await this.db.transaction().execute(async (trx) => {
      const row = await this.lockDraft(trx, 'profileTemplate', code, version);
      await trx.deleteFrom('profileTemplate').where('id', '=', row.id).execute();
      await this.audit(trx, actorId, 'DELETE_DRAFT', 'TEMPLATE', code, { version });
    });
  }

  /**
   * Publishes a template draft: links every activity to its latest published version (all must be published),
   * then hands over to the status change that retires the previous version and announces the release.
   */
  async publishTemplate(actorId: string, code: string, version: number, publishActivities = false) {
    // Activities still in draft are published first (one click for the admin), or listed so the UI can ask.
    const drafts = await this.db
      .selectFrom('profileTemplate as t')
      .innerJoin('templateActivity as ta', 'ta.profileTemplateId', 't.id')
      .innerJoin('activityDefinition as linked', 'linked.id', 'ta.activityId')
      .innerJoin('activityDefinition as a', 'a.code', 'linked.code')
      .select(['a.code', 'a.version', 'a.name'])
      .where('t.code', '=', code)
      .where('t.version', '=', version)
      .where('t.status', '=', 'DRAFT')
      .where('a.status', '=', 'DRAFT')
      .execute();
    if (drafts.length && !publishActivities)
      throw ProblemError.conflict(
        'activities-not-published',
        `These activities are drafts: ${drafts.map((d) => `“${d.name}”`).join(', ')}`,
        { draftActivities: drafts.map((d) => d.name) },
      );
    for (const d of drafts) await this.publishActivity(actorId, d.code, d.version);
    await this.db.transaction().execute(async (trx) => {
      const t = await trx
        .selectFrom('profileTemplate')
        .select(['id', 'status'])
        .where('code', '=', code)
        .where('version', '=', version)
        .forUpdate()
        .executeTakeFirst();
      if (!t) throw ProblemError.notFound('Profile version');
      if (t.status !== 'DRAFT') return;
      const links = await trx
        .selectFrom('templateActivity as ta')
        .innerJoin('activityDefinition as a', 'a.id', 'ta.activityId')
        .select(['a.code', 'a.name', 'ta.sortOrder', 'ta.targets'])
        .where('ta.profileTemplateId', '=', t.id)
        .orderBy('ta.sortOrder')
        .execute();
      if (!links.length)
        throw ProblemError.validation([
          field('/activities', 'required', 'Add at least one activity before publishing'),
        ]);
      const published = await this.latestPublishedIds(
        trx,
        links.map((l) => l.code),
      );
      const missing = links.filter((l) => !published.has(l.code));
      if (missing.length)
        throw ProblemError.conflict(
          'activities-not-published',
          `Publish these activities first: ${missing.map((m) => `“${m.name}”`).join(', ')}`,
        );
      await trx.deleteFrom('templateActivity').where('profileTemplateId', '=', t.id).execute();
      await trx
        .insertInto('templateActivity')
        .values(
          links.map((l) => ({
            profileTemplateId: t.id,
            activityId: published.get(l.code)!,
            sortOrder: l.sortOrder,
            targets: JSON.stringify(l.targets ?? {}),
          })),
        )
        .execute();
    });
    await this.cache.del(CACHE_KEYS.template(code, version));
    return this.admin.setTemplateStatus(actorId, code, version, 'PUBLISHED');
  }

  // ---------------------------------------------------------------- helpers

  private async insertActivity(trx: Trx, code: string, version: number, input: ActivityInput, cats: CategoryRow[]) {
    const cat = this.requireCategory(cats, input.categoryCode);
    const path = pathOf(cat, cats);
    const id = newId();
    await trx
      .insertInto('activityDefinition')
      .values({
        id,
        code,
        version,
        name: input.name.trim(),
        kind: input.kind,
        recordingMode: input.recordingMode,
        grouping: null, // overs and similar groups are for match activities only
        maxEntries: 500,
        categoryCodes: [cat.code],
        sports: path.filter((c) => c.kind === 'SPORT').map((c) => c.code),
        roles: path.filter((c) => c.kind === 'ROLE').map((c) => c.code.replace(/^.*\./, '')),
        equipment: input.equipment.map(slug),
        primaryMuscles: path.filter((c) => c.kind === 'MUSCLE').map((c) => c.code.replace(/^.*\./, '')),
        secondaryMuscles: [],
        mechanic: null,
        force: null,
        level: input.level ?? null,
        synonyms: input.synonyms.map((s) => s.trim()).filter(Boolean),
        description: input.description?.trim() || null,
        status: 'DRAFT',
        source: 'ADMIN',
        license: null,
        contentHash: sha256(input),
      })
      .execute();
    if (input.parameters.length)
      await trx
        .insertInto('parameterDefinition')
        .values(
          input.parameters.map((p, i) => ({
            id: newId(),
            activityId: id,
            parameterSetId: null,
            key: p.key,
            label: p.label.trim(),
            dataType: p.type,
            unit: p.unit ?? null,
            dimension: p.dimension ?? null,
            allowedUnits: null,
            constraints: JSON.stringify(p.constraints ?? {}),
            condition: p.condition ? JSON.stringify(p.condition) : null,
            defaultAgg: p.agg,
            isRequired: p.required,
            description: p.description ?? null,
            sortOrder: i,
          })),
        )
        .execute();
    if (input.metrics.length)
      await trx
        .insertInto('metricDefinition')
        .values(
          input.metrics.map((m, i) => ({
            id: newId(),
            activityId: id,
            parameterSetId: null,
            key: m.key,
            label: m.label.trim(),
            kind: m.kind,
            numerator: JSON.stringify(m.numerator),
            denominator: m.denominator ? JSON.stringify(m.denominator) : null,
            display: JSON.stringify(m.display ?? {}),
            sortOrder: i,
          })),
        )
        .execute();
    return id;
  }

  private async insertTemplate(
    trx: Trx,
    code: string,
    version: number,
    input: TemplateInput,
    categoryId: string,
    status: Status,
  ) {
    const name = input.name.trim();
    if (name.length < 2) throw ProblemError.validation([field('/body/name', 'required', 'Give the profile a name')]);
    const codes = [...new Set(input.activityCodes)];
    // Drafts may point at draft activities; publishing re-links everything to the latest published versions.
    const rows = codes.length
      ? await trx
          .selectFrom('activityDefinition')
          .select(['id', 'code', 'version', 'status'])
          .where('code', 'in', codes)
          .where('status', '!=', 'RETIRED')
          .execute()
      : [];
    const pick = new Map<string, string>();
    for (const c of codes) {
      const mine = rows.filter((r) => r.code === c);
      const best = mine.find((r) => r.status === 'PUBLISHED') ?? mine.sort((a, b) => b.version - a.version)[0];
      if (!best)
        throw ProblemError.validation([
          field('/body/activityCodes', 'unknown', 'One of the activities no longer exists'),
        ]);
      pick.set(c, best.id);
    }
    const id = newId();
    await trx
      .insertInto('profileTemplate')
      .values({
        id,
        categoryId,
        code,
        version,
        name,
        description: input.description?.trim() || null,
        status,
        ownerType: 'SYSTEM',
        ownerId: null,
        source: 'ADMIN',
        contentHash: sha256(input),
        publishedAt: null,
      })
      .execute();
    if (codes.length)
      await trx
        .insertInto('templateActivity')
        .values(codes.map((c, i) => ({ profileTemplateId: id, activityId: pick.get(c)!, sortOrder: i, targets: '{}' })))
        .execute();
    return id;
  }

  /** New published version of every published template that still links an older version of `code`. */
  private async republishTemplatesUsing(
    trx: Trx,
    actorId: string,
    code: string,
    activityId: string,
  ): Promise<string[]> {
    const users = await trx
      .selectFrom('profileTemplate as t')
      .innerJoin('templateActivity as ta', 'ta.profileTemplateId', 't.id')
      .innerJoin('activityDefinition as a', 'a.id', 'ta.activityId')
      .select(['t.id', 't.code', 't.version', 't.name', 't.description', 't.categoryId'])
      .where('t.status', '=', 'PUBLISHED')
      .where('a.code', '=', code)
      .where('a.id', '!=', activityId)
      // A profile with an open draft picks the new version up when that draft is published.
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('profileTemplate as d')
              .select('d.id')
              .whereRef('d.code', '=', 't.code')
              .where('d.status', '=', 'DRAFT'),
          ),
        ),
      )
      .execute();
    for (const t of users) {
      const links = await trx
        .selectFrom('templateActivity as ta')
        .innerJoin('activityDefinition as a', 'a.id', 'ta.activityId')
        .select(['ta.activityId', 'ta.sortOrder', 'ta.targets', 'a.code'])
        .where('ta.profileTemplateId', '=', t.id)
        .execute();
      const top = await trx
        .selectFrom('profileTemplate')
        .select((eb) => eb.fn.max('version').as('v'))
        .where('code', '=', t.code)
        .executeTakeFirstOrThrow();
      const version = Number(top.v) + 1;
      const id = newId();
      await trx.updateTable('profileTemplate').set({ status: 'RETIRED' }).where('id', '=', t.id).execute();
      await trx
        .insertInto('profileTemplate')
        .values({
          id,
          categoryId: t.categoryId,
          code: t.code,
          version,
          name: t.name,
          description: t.description,
          status: 'PUBLISHED',
          ownerType: 'SYSTEM',
          ownerId: null,
          source: 'ADMIN',
          contentHash: sha256({ t: t.code, links, activityId }),
          publishedAt: new Date(),
        })
        .execute();
      await trx
        .insertInto('templateActivity')
        .values(
          links.map((l) => ({
            profileTemplateId: id,
            activityId: l.code === code ? activityId : l.activityId,
            sortOrder: l.sortOrder,
            targets: JSON.stringify(l.targets ?? {}),
          })),
        )
        .execute();
      await this.outbox.enqueue<TemplatePublishedPayload>(trx, TOPICS.catalog, {
        type: EVENT_TYPES.templatePublished,
        userId: 'system',
        key: t.code,
        subject: `template/${t.code}`,
        data: { templateCode: t.code, version, name: t.name },
      });
      await this.audit(trx, actorId, 'PUBLISH', 'TEMPLATE', t.code, { version, reason: `activity ${code} updated` });
    }
    return users.map((u) => u.name);
  }

  /**
   * Recorded entries keep their meaning across versions: a field that exists in any earlier version keeps its
   * type and unit (labels, ranges and options may change). A different kind of answer needs a new field.
   */
  private async checkHistoryCompatible(trx: Trx, code: string, params: ParameterDefinition[]) {
    const earlier = await trx
      .selectFrom('parameterDefinition as p')
      .innerJoin('activityDefinition as a', 'a.id', 'p.activityId')
      .select(['p.key', 'p.label', 'p.dataType', 'p.unit'])
      .where('a.code', '=', code)
      .where('a.status', '!=', 'DRAFT')
      .execute();
    const errors: FieldError[] = [];
    for (const p of params) {
      const old = earlier.find((e) => e.key === p.key);
      if (old && (old.dataType !== p.type || (old.unit ?? null) !== (p.unit ?? null)))
        errors.push(
          field(
            `/body/parameters/${p.key}`,
            'immutable-field',
            `Field “${p.label}”: its kind of answer and unit are fixed once published – add a new field instead`,
          ),
        );
    }
    if (errors.length) throw ProblemError.validation(errors);
  }

  private async latestPublishedIds(trx: Trx, codes: string[]) {
    const rows = await trx
      .selectFrom('activityDefinition')
      .select(['id', 'code', 'version'])
      .where('code', 'in', codes)
      .where('status', '=', 'PUBLISHED')
      .orderBy('version', 'desc')
      .execute();
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.code)) out.set(r.code, r.id);
    return out;
  }

  private async lockDraft(trx: Trx, table: 'activityDefinition' | 'profileTemplate', code: string, version: number) {
    const row = await trx
      .selectFrom(table)
      .select(['id', 'status'])
      .where('code', '=', code)
      .where('version', '=', version)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw ProblemError.notFound(table === 'profileTemplate' ? 'Profile version' : 'Activity version');
    if (row.status !== 'DRAFT')
      throw ProblemError.conflict('not-draft', 'Published versions cannot change – start a new draft instead');
    return row;
  }

  private requireCategory(cats: CategoryRow[], code: string) {
    const c = cats.find((x) => x.code === code && x.status === 'ACTIVE');
    if (!c)
      throw ProblemError.validation([field('/body/categoryCode', 'unknown', 'Choose where it belongs in the catalog')]);
    return c;
  }

  private categories(db: Kysely<CatalogDatabase> | Trx): Promise<CategoryRow[]> {
    return db
      .selectFrom('category')
      .select(['id', 'code', 'name', 'kind', 'level', 'parentId', 'sortOrder', 'status'])
      .orderBy('level')
      .orderBy('sortOrder')
      .execute();
  }

  /** Activity code → names of the published templates (profiles) that use any version of it. */
  private async usage(code?: string) {
    let q = this.db
      .selectFrom('templateActivity as ta')
      .innerJoin('profileTemplate as t', 't.id', 'ta.profileTemplateId')
      .innerJoin('activityDefinition as a', 'a.id', 'ta.activityId')
      .select(['a.code', 't.name'])
      .where('t.status', '=', 'PUBLISHED');
    if (code) q = q.where('a.code', '=', code);
    const rows = await q.execute();
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.code, [...new Set([...(out.get(r.code) ?? []), r.name])]);
    return out;
  }

  private audit(trx: Trx, actorId: string, action: string, entityType: string, entityCode: string, details: unknown) {
    return trx
      .insertInto('catalogAudit')
      .values({ id: newId(), actorId, action, entityType, entityCode, details: JSON.stringify(details) })
      .execute();
  }
}

// ------------------------------------------------------------------ pure helpers

const field = (pointer: string, code: string, message: string): FieldError => ({ pointer, code, message });

function uniqueCode(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

function pathOf(c: CategoryRow, all: CategoryRow[]): CategoryRow[] {
  const out: CategoryRow[] = [c];
  let cur = c;
  while (cur.parentId) {
    const p = all.find((x) => x.id === cur.parentId);
    if (!p) break;
    out.unshift(p);
    cur = p;
  }
  return out;
}

const namePath = (code: string, all: CategoryRow[]) => {
  const c = all.find((x) => x.code === code);
  return c ? pathOf(c, all).map((p) => p.name) : [];
};

function latestPerCode<T extends { code: string; version: number }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.code) || m.get(r.code)!.version < r.version) m.set(r.code, r);
  return [...m.values()];
}

const maxVersion = (rows: { code: string; version: number; status: string }[], code: string, status: string) =>
  rows
    .filter((r) => r.code === code && r.status === status)
    .reduce<number | null>((m, r) => Math.max(m ?? 0, r.version), null);

const toInput = (a: Awaited<ReturnType<CatalogEditorService['getActivity']>>): ActivityInput => ({
  name: a.name,
  categoryCode: a.categoryCode ?? '',
  kind: a.kind as ActivityInput['kind'],
  recordingMode: a.recordingMode,
  description: a.description,
  level: (a.level as ActivityInput['level']) ?? null,
  equipment: a.equipment,
  synonyms: a.synonyms,
  parameters: a.parameters,
  metrics: a.metrics,
});

/**
 * Same rules as tracker customisation: every field and stat is applied as an ADD to an empty activity, so the
 * schema compiler checks keys, types, units, ranges, options, conditions and stat references. Messages name
 * the field by its label, never by its key.
 */
export function validateActivity(input: ActivityInput): FieldError[] {
  const errors: FieldError[] = [];
  if (input.name.trim().length < 2) errors.push(field('/body/name', 'required', 'Give the activity a name'));
  const keys = new Set<string>();
  for (const p of input.parameters) {
    if (keys.has(p.key))
      errors.push(field(`/body/parameters/${p.key}`, 'duplicate', `Two fields are called “${p.label}”`));
    keys.add(p.key);
  }
  const base = {
    code: 'x.validate',
    version: 1,
    name: input.name,
    kind: input.kind,
    recordingMode: input.recordingMode,
    grouping: null,
    maxEntries: 500,
    description: null,
    equipment: [],
    primaryMuscles: [],
    secondaryMuscles: [],
    targets: {},
    parameters: [],
    metrics: [],
  } satisfies ActivitySnapshot;
  const overrides: Override[] = [
    ...input.parameters.map((p, i) => ({
      id: `p${i}`,
      target: 'PARAMETER' as const,
      action: 'ADD' as const,
      activityCode: base.code,
      definition: p as unknown as Record<string, unknown>,
    })),
    ...input.metrics.map((m, i) => ({
      id: `m${i}`,
      target: 'METRIC' as const,
      action: 'ADD' as const,
      activityCode: base.code,
      definition: m as unknown as Record<string, unknown>,
    })),
  ];
  const { issues } = compileEffectiveSchema({ activities: [base] }, overrides, { maxParametersPerActivity: 40 });
  const labelOf = (pointer: string) => {
    const [, kind, id] = pointer.split('/');
    if (kind === 'overrides' && id?.startsWith('p')) return `Field “${input.parameters[Number(id.slice(1))]?.label}”`;
    if (kind === 'overrides' && id?.startsWith('m')) return `Stat “${input.metrics[Number(id.slice(1))]?.label}”`;
    const key = pointer.split('/').pop() ?? '';
    const p = input.parameters.find((x) => x.key === key);
    const m = input.metrics.find((x) => x.key === key);
    return p ? `Field “${p.label}”` : m ? `Stat “${m.label}”` : 'Activity';
  };
  for (const i of issues) errors.push(field(i.pointer, i.code, `${labelOf(i.pointer)}: ${i.message}`));
  return errors;
}
