import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, etag, parseIfMatch, ZodPipe } from '@trainme/service-kit';
import { CheckpointService } from '../application/checkpoint.service.js';
import { FeedbackService } from '../application/feedback.service.js';
import { SessionService } from '../application/session.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const instant = z.iso.datetime({ offset: true });
const idParam = new ZodPipe(z.uuid(), '/path/id');

const startBody = z.object({
  clientSessionId: z.uuid(),
  trackerId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  sessionDate: isoDate.optional(),
  schemaVersion: z.number().int().positive().optional(),
  startedAt: instant,
  timezone: z.string().min(1).max(40),
  source: z.enum(['MOBILE', 'WEB', 'IMPORT']).optional(),
  onNameConflict: z.enum(['REJECT', 'SUFFIX']).default('REJECT'),
  trainerId: z.uuid().optional(),
});
const coachingQuery = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  traineeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const feedbackBody = z.object({
  body: z.string().trim().min(1).max(2000),
  clientEntryId: z.uuid().nullable().optional(),
});
const feedbackPatch = z.object({ body: z.string().trim().min(1).max(2000) });
const fidParam = new ZodPipe(z.uuid(), '/path/feedbackId');
const listQuery = z.object({
  date: isoDate.optional(),
  trackerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'DISCARDED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
const lookupQuery = z.object({ date: isoDate, name: z.string().trim().min(1).max(80) });
const getQuery = z.object({ include: z.enum(['entries']).optional() });
const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sessionDate: isoDate.optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  startedAt: instant.optional(),
  endedAt: instant.optional(),
});
const entry = z.object({
  clientEntryId: z.uuid(),
  activity: z.string().min(2).max(80),
  seq: z.number().int().min(1),
  group: z.number().int().min(1).nullable().optional(),
  recordedAt: instant,
  values: z.record(z.string(), z.unknown()),
  rowVersion: z.number().int().min(1).optional(),
});
const batchBody = z.object({
  batchSeq: z.number().int().min(1),
  schemaVersion: z.number().int().positive(),
  entries: z.array(entry).max(100).default([]),
  deletes: z.array(z.uuid()).max(100).default([]),
});
const completeBody = z.object({
  endedAt: instant,
  entryCount: z.number().int().min(0),
  lastBatchSeq: z.number().int().min(0).optional(),
  clientEntryIds: z.array(z.uuid()).max(5000).optional(),
});

/** Live sessions API (LLD §4.5, FR-REC-09..20). Every route is scoped to the caller's own sessions. */
@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly checkpoints: CheckpointService,
    private readonly feedback: FeedbackService,
  ) {}

  @Post()
  async start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(startBody, '/body')) body: z.infer<typeof startBody>,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = await this.sessions.start(user, body);
    void res
      .status(r.created ? 201 : 200)
      .header('etag', etag(r.session.rowVersion))
      .header('location', `/api/v1/sessions/${r.session.id}`);
    return { ...r.session, nameAdjusted: 'nameAdjusted' in r ? r.nameAdjusted : false };
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery, '/query')) q: z.infer<typeof listQuery>) {
    return this.sessions.list(user, q);
  }

  /** FR-COA-06/08: sessions where the caller is the trainer ("Live now" with status=IN_PROGRESS). */
  @Get('coaching')
  coaching(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(coachingQuery, '/query')) q: z.infer<typeof coachingQuery>,
  ) {
    return this.sessions.listCoaching(user, q);
  }

  @Get(':id/schema')
  schema(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.sessions.schema(user, id);
  }

  @Get(':id/feedback')
  listFeedback(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.feedback.list(user, id);
  }

  @Post(':id/feedback')
  addFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(feedbackBody, '/body')) b: z.infer<typeof feedbackBody>,
  ) {
    return this.feedback.add(user, id, b);
  }

  @Patch(':id/feedback/:feedbackId')
  editFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Param('feedbackId', fidParam) fid: string,
    @Body(new ZodPipe(feedbackPatch, '/body')) b: z.infer<typeof feedbackPatch>,
  ) {
    return this.feedback.update(user, id, fid, b.body);
  }

  @Delete(':id/feedback/:feedbackId')
  @HttpCode(204)
  async removeFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Param('feedbackId', fidParam) fid: string,
  ) {
    await this.feedback.remove(user, id, fid);
  }

  @Get('lookup')
  lookup(@CurrentUser() user: AuthUser, @Query(new ZodPipe(lookupQuery, '/query')) q: z.infer<typeof lookupQuery>) {
    return this.sessions.lookup(user, q.date, q.name);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Query(new ZodPipe(getQuery, '/query')) q: z.infer<typeof getQuery>,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const s = await this.sessions.get(user, id, q.include === 'entries');
    void res.header('etag', etag(s.rowVersion));
    return s;
  }

  @Patch(':id')
  async patch(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(patchBody, '/body')) body: z.infer<typeof patchBody>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const s = await this.sessions.patch(user, id, parseIfMatch(ifMatch), body);
    void res.header('etag', etag(s.rowVersion));
    return s;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    await this.sessions.remove(user, id, parseIfMatch(ifMatch));
  }

  /** Checkpoint every 3–5 min (FR-REC-10). `entries:batch` per the LLD; `entries/batch` is an alias. */
  @Post([':id/entries::batch', ':id/entries/batch'])
  @HttpCode(200)
  batch(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(batchBody, '/body')) body: z.infer<typeof batchBody>,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.checkpoints.apply(user, id, parseIfMatch(ifMatch), body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(completeBody, '/body')) body: z.infer<typeof completeBody>,
  ) {
    return this.sessions.complete(user, id, body);
  }

  @Post(':id/discard')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.sessions.discard(user, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.sessions.reopen(user, id);
  }
}
