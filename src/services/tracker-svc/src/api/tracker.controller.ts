import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, etag, parseIfMatch, ZodPipe } from '@trainme/service-kit';
import { TrackerService } from '../application/tracker.service.js';

const idParam = new ZodPipe(z.uuid(), '/path/id');
const createBody = z.object({
  templateCode: z
    .string()
    .regex(/^[a-z0-9_.-]{2,80}$/)
    .optional(),
  templateVersion: z.number().int().positive().optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
});
const patchBody = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((b) => b.displayName !== undefined || b.status !== undefined, 'Nothing to change');
const overrideBody = z.object({
  target: z.enum(['ACTIVITY', 'PARAMETER', 'METRIC']),
  action: z.enum(['ADD', 'MODIFY', 'HIDE']),
  activityCode: z.string().min(2).max(80),
  itemKey: z.string().min(1).max(64).optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
});
const unitsBody = z.object({ displayUnits: z.record(z.string().max(150), z.string().max(16).nullable()) });
const schemaQuery = z.object({ version: z.coerce.number().int().positive().optional() });
const upgradeQuery = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

type Headers_ = Record<string, string | undefined>;

/** Trackers API (LLD §4.4). Every route is scoped to the caller's own trackers. */
@Controller('trackers')
export class TrackerController {
  constructor(private readonly trackers: TrackerService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { items: await this.trackers.list(user) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createBody, '/body')) body: z.infer<typeof createBody>,
    @Headers() h: Headers_,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const t = await this.trackers.create(user, body, h['x-request-id']);
    void res.status(201).header('etag', etag(t.rowVersion)).header('location', `/api/v1/trackers/${t.id}`);
    return t;
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const t = await this.trackers.get(user, id);
    void res.header('etag', etag(t.rowVersion));
    return t;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(patchBody, '/body')) body: z.infer<typeof patchBody>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const t = await this.trackers.update(user, id, parseIfMatch(ifMatch), body);
    void res.header('etag', etag(t.rowVersion));
    return t;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    await this.trackers.remove(user, id, parseIfMatch(ifMatch));
  }

  /** ETag "v<n>" lets clients revalidate cheaply; versions never change once created. */
  @Get(':id/schema')
  async schema(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Query(new ZodPipe(schemaQuery, '/query')) q: z.infer<typeof schemaQuery>,
    @Headers('if-none-match') inm: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const s = await this.trackers.schema(user, id, q.version);
    const tag = `"v${s.schemaVersion}"`;
    void res.header('etag', tag).header('cache-control', 'private, max-age=0, must-revalidate');
    if (inm === tag) {
      void res.status(304);
      return undefined;
    }
    return s;
  }

  @Post(':id/overrides')
  async addOverride(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(overrideBody, '/body')) body: z.infer<typeof overrideBody>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = await this.trackers.addOverride(user, id, parseIfMatch(ifMatch), body);
    void res.status(201).header('etag', etag(r.tracker.rowVersion));
    return r;
  }

  @Delete(':id/overrides/:overrideId')
  async removeOverride(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Param('overrideId', new ZodPipe(z.uuid(), '/path/overrideId')) overrideId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = await this.trackers.removeOverride(user, id, parseIfMatch(ifMatch), overrideId);
    void res.header('etag', etag(r.tracker.rowVersion));
    return r;
  }

  @Get(':id/display-units')
  async displayUnits(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    const t = await this.trackers.get(user, id);
    return { trackerId: id, displayUnits: t.displayUnits };
  }

  @Put(':id/display-units')
  setDisplayUnits(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(unitsBody, '/body')) body: z.infer<typeof unitsBody>,
  ) {
    return this.trackers.setDisplayUnits(user, id, body.displayUnits);
  }

  @Post(':id/upgrade')
  @HttpCode(200)
  upgrade(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Query(new ZodPipe(upgradeQuery, '/query')) q: z.infer<typeof upgradeQuery>,
    @Headers() h: Headers_,
  ) {
    return this.trackers.upgrade(user, id, parseIfMatch(h['if-match']), q.dryRun, h['x-request-id']);
  }
}
