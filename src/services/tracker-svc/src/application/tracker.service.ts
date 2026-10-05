import type { Logger } from '@trainme/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import type { JsonCache } from '@trainme/cache';
import { newId, sql, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type TrackerPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import {
  compileEffectiveSchema,
  type ActivitySnapshot,
  type EffectiveSchema,
  type Override,
  type SchemaIssue,
  type TemplateSnapshot,
} from '@trainme/schema';
import { CACHE, DATABASE, LOGGER, OUTBOX } from '@trainme/service-kit';
import { UnitRegistry } from '@trainme/units';
import { resolveEntitlements, type TrackerEntitlements } from '../domain/entitlements.js';
import { CatalogClient } from '../infrastructure/catalog.client.js';
import type { TrackerDatabase, UserTrackerTable } from '../infrastructure/tracker.database.js';

type Trx = Transaction<TrackerDatabase>;
type TrackerRow = Pick<
  UserTrackerTable,
  'id' | 'userId' | 'templateCode' | 'templateVersion' | 'displayName' | 'status' | 'schemaVersion' | 'rowVersion'
> & {
  displayUnits: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
};

export interface OverrideInput {
  target: Override['target'];
  action: Override['action'];
  activityCode: string;
  itemKey?: string;
  definition?: Record<string, unknown>;
}

const units = new UnitRegistry();
const schemaKey = (id: string, v: number) => `trk:schema:${id}:v${v}`;

@Injectable()
export class TrackerService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<TrackerDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    private readonly catalog: CatalogClient,
  ) {}

  // ---------------------------------------------------------------- queries

  /** The caller's live trackers, newest first, with "upgrade available" hints. */
  async list(user: AuthUser) {
    const rows = await this.db
      .selectFrom('userTracker as t')
      .leftJoin('templateRelease as r', 'r.templateCode', 't.templateCode')
      .select([
        't.id',
        't.displayName',
        't.templateCode',
        't.templateVersion',
        't.status',
        't.schemaVersion',
        't.rowVersion',
        't.createdAt',
        't.updatedAt',
        'r.latestVersion',
        'r.name as latestName',
      ])
      .where('t.userId', '=', user.id)
      .where('t.deletedAt', 'is', null)
      .orderBy('t.createdAt', 'desc')
      .execute();
    return rows.map(({ latestVersion, latestName, ...t }) => ({
      ...t,
      upgradeAvailable:
        latestVersion && t.templateVersion && latestVersion > t.templateVersion
          ? { version: latestVersion, name: latestName }
          : null,
    }));
  }

  async get(user: AuthUser, id: string) {
    const t = await this.load(this.db, user, id);
    const overrides = await this.db
      .selectFrom('trackerOverride')
      .select(['id', 'target', 'action', 'activityCode', 'itemKey', 'definition', 'createdInVersion', 'createdAt'])
      .where('trackerId', '=', id)
      .orderBy('createdAt')
      .execute();
    const release = t.templateCode
      ? await this.db
          .selectFrom('templateRelease')
          .select(['latestVersion', 'name'])
          .where('templateCode', '=', t.templateCode)
          .executeTakeFirst()
      : undefined;
    return {
      ...t,
      overrides,
      upgradeAvailable:
        release && t.templateVersion && release.latestVersion > t.templateVersion
          ? { version: release.latestVersion, name: release.name }
          : null,
    };
  }

  /**
   * Effective schema of one version (latest by default). Owners and services may read it; versions are
   * immutable, so they are cached without expiry (records-svc validates checkpoints against them).
   */
  async schema(
    user: AuthUser,
    id: string,
    version?: number,
  ): Promise<{ trackerId: string; schemaVersion: number } & EffectiveSchema> {
    const t = await this.load(this.db, user, id, { allowService: true });
    const v = version ?? t.schemaVersion;
    if (v < 1 || v > t.schemaVersion) throw ProblemError.notFound(`Schema version ${v}`);
    const schema = await this.cache.getOrLoad(schemaKey(id, v), 0, async () => {
      const row = await this.db
        .selectFrom('trackerSchema')
        .select('effectiveSchema')
        .where('trackerId', '=', id)
        .where('version', '=', v)
        .executeTakeFirst();
      return row?.effectiveSchema;
    });
    if (!schema) throw ProblemError.notFound(`Schema version ${v}`);
    return { trackerId: id, schemaVersion: v, ...schema };
  }

  // ---------------------------------------------------------------- commands

  /** FR-TRK-01/05: subscribe to a template (snapshot copied) or start blank; plan limit on active trackers. */
  async create(
    user: AuthUser,
    input: { templateCode?: string; templateVersion?: number; displayName?: string },
    requestId?: string,
  ) {
    const ent = await this.entitlements(user);
    const active = await this.db
      .selectFrom('userTracker')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('userId', '=', user.id)
      .where('status', '=', 'ACTIVE')
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    if (Number(active.n) >= ent.maxTrackers) {
      throw new ProblemError(
        403,
        'plan-limit',
        'Plan limit reached',
        `Your plan allows ${ent.maxTrackers} active trackers; archive one or upgrade`,
      );
    }
    let base: Pick<TemplateSnapshot, 'activities'> & Partial<TemplateSnapshot> = { activities: [] };
    if (input.templateCode) base = await this.catalog.template(input.templateCode, input.templateVersion, requestId);
    const displayName = input.displayName?.trim() || (base.name ? `My ${base.name}` : 'My Tracker');
    const compiled = this.compile(base.activities, [], ent);
    if (compiled.issues.length) throw ProblemError.validation(compiled.issues);

    const id = newId();
    return this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('userTracker')
        .values({
          id,
          userId: user.id,
          templateCode: base.code ?? null,
          templateVersion: base.version ?? null,
          displayName,
          status: 'ACTIVE',
          baseSnapshot: JSON.stringify(base),
          schemaVersion: 1,
          displayUnits: '{}',
          rowVersion: 1,
          deletedAt: null,
        })
        .execute();
      await trx
        .insertInto('trackerSchema')
        .values({ trackerId: id, version: 1, effectiveSchema: JSON.stringify(compiled.schema) })
        .execute();
      const t = await this.load(trx, user, id);
      await this.emit(trx, EVENT_TYPES.trackerCreated, t);
      return t;
    });
  }

  /** Rename, archive or restore (If-Match on row_version). Restoring counts against the plan limit. */
  async update(
    user: AuthUser,
    id: string,
    ifMatch: number | undefined,
    patch: { displayName?: string; status?: 'ACTIVE' | 'ARCHIVED' },
  ) {
    return this.db.transaction().execute(async (trx) => {
      const t = await this.lockForUpdate(trx, user, id, ifMatch);
      if (patch.status === 'ACTIVE' && t.status === 'ARCHIVED') {
        const ent = await this.entitlements(user);
        const active = await trx
          .selectFrom('userTracker')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('userId', '=', user.id)
          .where('status', '=', 'ACTIVE')
          .where('deletedAt', 'is', null)
          .executeTakeFirstOrThrow();
        if (Number(active.n) >= ent.maxTrackers)
          throw new ProblemError(
            403,
            'plan-limit',
            'Plan limit reached',
            `Your plan allows ${ent.maxTrackers} active trackers`,
          );
      }
      await trx
        .updateTable('userTracker')
        .set({
          ...(patch.displayName ? { displayName: patch.displayName.trim() } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          rowVersion: t.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      const updated = await this.load(trx, user, id);
      const type =
        patch.status === 'ARCHIVED' && t.status !== 'ARCHIVED'
          ? EVENT_TYPES.trackerArchived
          : EVENT_TYPES.trackerUpdated;
      await this.emit(trx, type, updated);
      return updated;
    });
  }

  /** Soft delete; records-svc purges the tracker's sessions asynchronously on tracker.deleted. */
  async remove(user: AuthUser, id: string, ifMatch: number | undefined): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const t = await this.lockForUpdate(trx, user, id, ifMatch);
      await trx
        .updateTable('userTracker')
        .set({ deletedAt: new Date(), rowVersion: t.rowVersion + 1, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      await this.emit(trx, EVENT_TYPES.trackerDeleted, t);
    });
  }

  /** FR-TRK-02..06: add/modify/hide → recompile → new schema version (only if the result is valid). */
  async addOverride(user: AuthUser, id: string, ifMatch: number | undefined, input: OverrideInput, requestId?: string) {
    // Adding a catalog activity: the snapshot always comes from catalog-svc, never from the client.
    const fromCatalog = input.target === 'ACTIVITY' && input.action === 'ADD' && input.definition?.source === 'CATALOG';
    this.log.debug(
      {
        trackerId: id,
        userId: user.id,
        target: input.target,
        action: input.action,
        activityCode: input.activityCode,
        itemKey: input.itemKey,
        fromCatalog,
      },
      'add customisation',
    );
    const definition = fromCatalog
      ? { source: 'CATALOG', snapshot: await this.catalog.activity(input.activityCode, requestId) }
      : (input.definition ?? {});
    return this.mutateOverrides(user, id, ifMatch, async (trx, t, overrides) => {
      const o: Override = {
        id: newId(),
        target: input.target,
        action: input.action,
        activityCode: input.activityCode,
        itemKey: input.itemKey ?? (typeof input.definition?.key === 'string' ? input.definition.key : null),
        definition,
      };
      if (o.target === 'ACTIVITY' && o.action === 'ADD') o.activityCode = String(o.definition.code ?? o.activityCode);
      await trx
        .insertInto('trackerOverride')
        .values({
          id: o.id,
          trackerId: id,
          target: o.target,
          action: o.action,
          activityCode: o.activityCode,
          itemKey: o.itemKey ?? null,
          definition: JSON.stringify(o.definition),
          createdInVersion: t.schemaVersion + 1,
        })
        .execute();
      return [...overrides, o];
    });
  }

  async removeOverride(user: AuthUser, id: string, ifMatch: number | undefined, overrideId: string) {
    return this.mutateOverrides(user, id, ifMatch, async (trx, _t, overrides) => {
      if (!overrides.some((o) => o.id === overrideId)) throw ProblemError.notFound(`Override ${overrideId}`);
      await trx.deleteFrom('trackerOverride').where('id', '=', overrideId).where('trackerId', '=', id).execute();
      return overrides.filter((o) => o.id !== overrideId);
    });
  }

  /**
   * FR-TRK-09: display units per parameter ("<activity>.<param>") or dimension ("*.<dimension>").
   * Not part of the schema version, so it may change during a live session (ADR-014).
   */
  async setDisplayUnits(user: AuthUser, id: string, displayUnits: Record<string, string | null>) {
    return this.db.transaction().execute(async (trx) => {
      const t = await this.lockForUpdate(trx, user, id, undefined);
      const schema = await this.latestSchema(trx, id, t.schemaVersion);
      const next: Record<string, string> = { ...t.displayUnits };
      const issues: SchemaIssue[] = [];
      for (const [key, unit] of Object.entries(displayUnits)) {
        const pointer = `/displayUnits/${key}`;
        if (unit === null) {
          delete next[key];
          continue;
        }
        if (!units.get(unit)?.dimension) {
          issues.push({ pointer, code: 'unknown-unit', message: `${unit} is not a convertible unit` });
          continue;
        }
        if (key.startsWith('*.')) {
          if (units.get(unit)!.dimension !== key.slice(2))
            issues.push({ pointer, code: 'wrong-dimension', message: `${unit} is not a ${key.slice(2)} unit` });
          else next[key] = unit;
          continue;
        }
        const dot = key.lastIndexOf('.');
        const param = schema.activities
          .find((a) => a.code === key.slice(0, dot))
          ?.parameters.find((p) => p.key === key.slice(dot + 1));
        if (!param?.unit)
          issues.push({ pointer, code: 'unknown-parameter', message: 'No measured parameter with this key' });
        else if (!units.isConvertible(param.unit, unit))
          issues.push({ pointer, code: 'wrong-dimension', message: `${param.unit} cannot be shown as ${unit}` });
        else next[key] = unit;
      }
      if (issues.length) throw ProblemError.validation(issues);
      await trx
        .updateTable('userTracker')
        .set({ displayUnits: JSON.stringify(next), rowVersion: t.rowVersion + 1, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      this.log.info({ trackerId: id, userId: user.id, displayUnits: next }, 'display units changed');
      return { trackerId: id, displayUnits: next };
    });
  }

  /**
   * FR-TRK-08: move to a newer template version keeping overrides. Overrides that no longer apply
   * (their activity/parameter was removed) are dropped and reported; dryRun only previews.
   */
  async upgrade(user: AuthUser, id: string, ifMatch: number | undefined, dryRun: boolean, requestId?: string) {
    const current = await this.load(this.db, user, id);
    if (!current.templateCode)
      throw ProblemError.badRequest('not-template-based', 'This tracker was built from scratch');
    const next = await this.catalog.template(current.templateCode, undefined, requestId);
    if (next.version <= (current.templateVersion ?? 0))
      return { upgraded: false, reason: 'already-latest', templateVersion: current.templateVersion };
    const overrides = await this.overrides(this.db, id);
    const ent = await this.entitlements(user);
    const trial = this.compile(next.activities, overrides, ent);
    const orphanCodes = new Set(['unknown-activity', 'unknown-parameter', 'unknown-metric']);
    const dropped = trial.issues
      .filter((i) => i.pointer.startsWith('/overrides/') && orphanCodes.has(i.code))
      .map((i) => i.pointer.split('/')[2]!);
    const blocking = trial.issues.filter((i) => !(i.pointer.startsWith('/overrides/') && orphanCodes.has(i.code)));
    const before = await this.latestSchema(this.db, id, current.schemaVersion);
    const diff = {
      from: current.templateVersion,
      to: next.version,
      addedActivities: next.activities
        .filter((a) => !before.activities.some((b) => b.code === a.code))
        .map((a) => a.code),
      removedActivities: before.activities
        .filter((b) => !b.custom && !next.activities.some((a) => a.code === b.code))
        .map((b) => b.code),
      droppedOverrides: dropped,
      issues: blocking,
    };
    this.log.info(
      {
        trackerId: id,
        userId: user.id,
        from: diff.from,
        to: diff.to,
        dryRun,
        blocking: blocking.length,
        dropped: dropped.length,
      },
      dryRun ? 'upgrade preview' : 'upgrade requested',
    );
    if (dryRun || blocking.length) return { upgraded: false, ...diff };
    return this.db.transaction().execute(async (trx) => {
      const t = await this.lockForUpdate(trx, user, id, ifMatch);
      if (dropped.length) await trx.deleteFrom('trackerOverride').where('id', 'in', dropped).execute();
      const kept = overrides.filter((o) => !dropped.includes(o.id));
      const compiled = this.compile(next.activities, kept, ent);
      const version = t.schemaVersion + 1;
      await trx
        .insertInto('trackerSchema')
        .values({ trackerId: id, version, effectiveSchema: JSON.stringify(compiled.schema) })
        .execute();
      await trx
        .updateTable('userTracker')
        .set({
          baseSnapshot: JSON.stringify(next),
          templateVersion: next.version,
          schemaVersion: version,
          rowVersion: t.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      const updated = await this.load(trx, user, id);
      await this.emit(trx, EVENT_TYPES.trackerSchemaChanged, updated);
      return { upgraded: true, ...diff, tracker: updated };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async mutateOverrides(
    user: AuthUser,
    id: string,
    ifMatch: number | undefined,
    change: (trx: Trx, t: TrackerRow, overrides: Override[]) => Promise<Override[]>,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const t = await this.lockForUpdate(trx, user, id, ifMatch);
      const base = await trx
        .selectFrom('userTracker')
        .select('baseSnapshot')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const overrides = await change(trx, t, await this.overrides(trx, id));
      const compiled = this.compile(base.baseSnapshot.activities, overrides, await this.entitlements(user));
      if (compiled.issues.length) {
        this.log.debug({ trackerId: id, userId: user.id, issues: compiled.issues }, 'customisation rejected');
        throw ProblemError.validation(compiled.issues); // rolls back the change
      }
      this.log.debug(
        { trackerId: id, overrides: overrides.length, nextVersion: t.schemaVersion + 1 },
        'customisation compiled',
      );
      const version = t.schemaVersion + 1;
      await trx
        .insertInto('trackerSchema')
        .values({ trackerId: id, version, effectiveSchema: JSON.stringify(compiled.schema) })
        .execute();
      await trx
        .updateTable('userTracker')
        .set({ schemaVersion: version, rowVersion: t.rowVersion + 1, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      const updated = await this.load(trx, user, id);
      await this.emit(trx, EVENT_TYPES.trackerSchemaChanged, updated);
      return { tracker: updated, schemaVersion: version };
    });
  }

  private compile(activities: ActivitySnapshot[], overrides: Override[], ent: TrackerEntitlements) {
    return compileEffectiveSchema({ activities }, overrides, {
      allowCustomItems: ent.customParams,
      maxCustomMetrics: ent.maxCustomMetrics,
      units,
    });
  }

  private async overrides(db: Kysely<TrackerDatabase> | Trx, id: string): Promise<Override[]> {
    const rows = await db
      .selectFrom('trackerOverride')
      .select(['id', 'target', 'action', 'activityCode', 'itemKey', 'definition'])
      .where('trackerId', '=', id)
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({ ...r, itemKey: r.itemKey }));
  }

  private async latestSchema(db: Kysely<TrackerDatabase> | Trx, id: string, version: number): Promise<EffectiveSchema> {
    const row = await db
      .selectFrom('trackerSchema')
      .select('effectiveSchema')
      .where('trackerId', '=', id)
      .where('version', '=', version)
      .executeTakeFirstOrThrow();
    return row.effectiveSchema;
  }

  private async entitlements(user: AuthUser): Promise<TrackerEntitlements> {
    const row = await this.db
      .selectFrom('userEntitlement')
      .select(['planCode', 'entitlements'])
      .where('userId', '=', user.id)
      .executeTakeFirst();
    return resolveEntitlements(row?.planCode ?? user.plan, row?.entitlements);
  }

  /** Loads a live tracker the caller owns (or any tracker for service/support/admin callers when allowed). */
  private async load(
    db: Kysely<TrackerDatabase> | Trx,
    user: AuthUser,
    id: string,
    opts: { allowService?: boolean } = {},
  ): Promise<TrackerRow> {
    const t = await db
      .selectFrom('userTracker')
      .select([
        'id',
        'userId',
        'templateCode',
        'templateVersion',
        'displayName',
        'status',
        'schemaVersion',
        'rowVersion',
        'displayUnits',
        'createdAt',
        'updatedAt',
      ])
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    const privileged = opts.allowService && user.roles.some((r) => r === 'service' || r === 'support' || r === 'admin');
    if (!t || (t.userId !== user.id && !privileged)) throw ProblemError.notFound(`Tracker ${id}`);
    return t;
  }

  private async lockForUpdate(trx: Trx, user: AuthUser, id: string, ifMatch: number | undefined): Promise<TrackerRow> {
    await sql`SELECT 1 FROM user_tracker WHERE id = ${id} FOR UPDATE`.execute(trx);
    const t = await this.load(trx, user, id);
    if (ifMatch !== undefined && ifMatch !== t.rowVersion) throw ProblemError.preconditionFailed();
    return t;
  }

  private async emit(trx: Trx, type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES], t: TrackerRow) {
    this.log.info(
      {
        event: type,
        trackerId: t.id,
        userId: t.userId,
        templateCode: t.templateCode,
        schemaVersion: t.schemaVersion,
        status: t.status,
      },
      type.replace('tracker.', 'tracker ').replace('.', ' '),
    );
    await this.outbox.enqueue<TrackerPayload>(trx, TOPICS.tracker, {
      type,
      userId: t.userId,
      subject: `tracker/${t.id}`,
      data: {
        trackerId: t.id,
        userId: t.userId,
        displayName: t.displayName,
        templateCode: t.templateCode,
        schemaVersion: t.schemaVersion,
        status: t.status,
      },
    });
  }
}
