import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, etag, parseIfMatch, Roles, ZodPipe } from '@trainme/service-kit';
import { isTechnical } from '../application/coaching.service.js';
import { ProfileService } from '../application/profile.service.js';

const system = z.enum(['METRIC', 'IMPERIAL']);
const updateBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED']).nullable().optional(),
  heightCm: z.number().min(50).max(260).nullable().optional(),
  weightKg: z.number().min(20).max(400).nullable().optional(),
  unitPreset: system.optional(),
  unitPreferences: z
    .object({
      speed: system,
      mass: system,
      length: system,
      volume: system,
      pace: system,
      energy: system,
      duration: system,
    })
    .partial()
    .optional(),
  timezone: z.string().min(1).max(40).optional(),
  locale: z.string().min(2).max(10).optional(),
  weekStart: z.enum(['MON', 'SUN']).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isOnboarded: z.boolean().optional(),
});
const deviceBody = z.object({
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  pushToken: z.string().min(10).max(4096),
  appVersion: z.string().max(20).optional(),
});
const searchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Profile API (LLD §4.1). `me` is always the token's subject. */
@Controller('profiles')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: FastifyReply) {
    const p = await this.profiles.me(user);
    void res.header('etag', etag(p.rowVersion));
    // Technical accounts (admin, curator, support) never coach or train with a coach (docs/12 §2).
    return { ...p, canCoach: !isTechnical(user) };
  }

  @Put('me')
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateBody, '/body')) body: z.infer<typeof updateBody>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const p = await this.profiles.update(user, parseIfMatch(ifMatch), body);
    void res.header('etag', etag(p.rowVersion));
    return p;
  }

  @Delete('me')
  @HttpCode(202)
  erase(@CurrentUser() user: AuthUser) {
    return this.profiles.erase(user);
  }

  @Get('me/devices')
  async devices(@CurrentUser() user: AuthUser) {
    return { items: await this.profiles.devices(user) };
  }

  @Post('me/devices')
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(deviceBody, '/body')) body: z.infer<typeof deviceBody>,
  ) {
    return this.profiles.registerDevice(user, body);
  }

  @Delete('me/devices/:deviceId')
  @HttpCode(204)
  async removeDevice(
    @CurrentUser() user: AuthUser,
    @Param('deviceId', new ZodPipe(z.uuid(), '/path/deviceId')) id: string,
  ) {
    await this.profiles.removeDevice(user, id);
  }

  @Post('me/export')
  @HttpCode(202)
  export(@CurrentUser() user: AuthUser) {
    return this.profiles.requestExport(user);
  }

  @Get('me/requests')
  async requests(@CurrentUser() user: AuthUser) {
    return { items: await this.profiles.requests(user) };
  }

  @Get()
  @Roles('support', 'admin')
  async search(@Query(new ZodPipe(searchQuery, '/query')) q: z.infer<typeof searchQuery>) {
    return { items: await this.profiles.search(q.q, q.limit) };
  }
}
