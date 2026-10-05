import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, Roles, ZodPipe } from '@trainme/service-kit';
import { CoachingService } from '../application/coaching.service.js';

const trainerBody = z.object({
  isTrainer: z.boolean(),
  bio: z.string().trim().max(500).nullable().optional(),
  specialties: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const connectBody = z
  .object({ trainerId: z.uuid().optional(), traineeEmail: z.email().max(254).optional() })
  .refine((b) => !!b.trainerId !== !!b.traineeEmail, { message: 'Send either trainerId or traineeEmail' });
const checkQuery = z.object({ trainerId: z.uuid(), traineeId: z.uuid() });
const namesQuery = z.object({
  ids: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).max(100)),
});
const idParam = new ZodPipe(z.uuid(), '/path/id');

/** Trainers and connections (docs/12 §5). Lives under /profiles so the gateway needs no new route. */
@Controller('profiles')
export class CoachingController {
  constructor(private readonly coaching: CoachingService) {}

  @Put('me/trainer')
  setTrainer(@CurrentUser() user: AuthUser, @Body(new ZodPipe(trainerBody, '/body')) b: z.infer<typeof trainerBody>) {
    return this.coaching.setTrainer(user, b);
  }

  @Get('trainers')
  async trainers(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(searchQuery, '/query')) q: z.infer<typeof searchQuery>,
  ) {
    return { items: await this.coaching.searchTrainers(user, q.q, q.limit) };
  }

  @Get('connections')
  connections(@CurrentUser() user: AuthUser) {
    return this.coaching.myConnections(user);
  }

  @Post('connections')
  connect(@CurrentUser() user: AuthUser, @Body(new ZodPipe(connectBody, '/body')) b: z.infer<typeof connectBody>) {
    return this.coaching.connect(user, b);
  }

  @Post('connections/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.coaching.respond(user, id, 'accept');
  }

  @Post('connections/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.coaching.respond(user, id, 'decline');
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    await this.coaching.disconnect(user, id);
  }

  /** Names of people the caller is (or was) connected with – for trainer dashboards. */
  @Get('names')
  async names(@CurrentUser() user: AuthUser, @Query(new ZodPipe(namesQuery, '/query')) q: z.infer<typeof namesQuery>) {
    return { items: await this.coaching.names(user, q.ids) };
  }

  /** records-svc only: is this trainer actively connected with this trainee? */
  @Get('internal/connections/check')
  @Roles('service')
  check(@Query(new ZodPipe(checkQuery, '/query')) q: z.infer<typeof checkQuery>) {
    return this.coaching.isActive(q.trainerId, q.traineeId);
  }
}
