import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { ProblemError } from '@trainme/errors';
import { CurrentUser, etag, parseIfMatch, Roles, ZodPipe } from '@trainme/service-kit';
import { CoachingService, isTechnical } from '../application/coaching.service.js';
import { ProfileService } from '../application/profile.service.js';

const system = z.enum(['METRIC', 'IMPERIAL']);
/** Optional text: blank means "clear it". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const updateBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  middleName: optionalText(60),
  lastName: z.string().trim().min(1).max(60).optional(),
  // Digits with optional +, spaces, dashes and brackets; 7–15 digits (E.164 length).
  mobile: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]+$/, 'Use digits, spaces, dashes and an optional leading +')
    .refine((v) => {
      const n = v.replace(/\D/g, '').length;
      return n >= 7 && n <= 15;
    }, 'A phone number has 7 to 15 digits')
    .nullable()
    .optional(),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(16),
  country: optionalText(80),
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
const AVATAR_MAX_BYTES = 150 * 1024;
const avatarBody = z.object({
  /** data:image/jpeg;base64,… – the web app crops and shrinks the picture to 256 px first. */
  image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Send a JPEG, PNG or WebP data URL'),
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
  constructor(
    private readonly profiles: ProfileService,
    private readonly coaching: CoachingService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: FastifyReply) {
    const p = await this.profiles.me(user);
    void res.header('etag', etag(p.rowVersion));
    // Technical accounts (admin, curator, support) never coach or train with a coach (docs/12 §2);
    // coachingRole tells the web app which coaching screens this person gets (coach or trainee, never both).
    return { ...p, canCoach: !isTechnical(user), coachingRole: await this.coaching.roleOf(user, p.isTrainer) };
  }

  /** Optional profile picture (FR-PRF-01). */
  @Get('me/avatar')
  async avatar(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: FastifyReply) {
    const a = await this.profiles.avatar(user);
    void res.header('content-type', a.contentType).header('cache-control', 'private, max-age=86400');
    return a.data;
  }

  @Put('me/avatar')
  async setAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(avatarBody, '/body')) body: z.infer<typeof avatarBody>,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const [head, b64] = body.image.split(',', 2) as [string, string];
    const data = Buffer.from(b64, 'base64');
    if (data.length > AVATAR_MAX_BYTES)
      throw ProblemError.validation([
        { pointer: '/body/image', code: 'too-large', message: 'The picture must be 150 KB or smaller' },
      ]);
    const type = head.slice(5, head.indexOf(';')) as 'image/jpeg' | 'image/png' | 'image/webp';
    const p = await this.profiles.setAvatar(user, type, data);
    void res.header('etag', etag(p.rowVersion));
    return p;
  }

  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: FastifyReply) {
    const p = await this.profiles.removeAvatar(user);
    void res.header('etag', etag(p.rowVersion));
    return p;
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
