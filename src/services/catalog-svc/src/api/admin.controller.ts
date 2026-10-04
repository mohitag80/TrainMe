import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import type { MetricDefinition, ParameterDefinition } from '@trainme/schema';
import { CurrentUser, Roles, ZodPipe } from '@trainme/service-kit';
import { CatalogAdminService } from '../application/catalog-admin.service.js';
import {
  ACTIVITY_KINDS,
  CATEGORY_KINDS,
  CatalogEditorService,
  type ActivityInput,
} from '../application/catalog-editor.service.js';

const statusQuery = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']).optional() });
const searchQuery = z.object({ q: z.string().trim().max(100).optional() });
const versionParam = new ZodPipe(z.coerce.number().int().positive(), '/path/version');
const name = z.string().trim().min(2).max(160);
const text = z.string().trim().max(2000).nullable().optional();

const categoryBody = z.object({
  parentCode: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(CATEGORY_KINDS),
  description: text,
});
const categoryPatch = z.object({ name: z.string().trim().min(2).max(120).optional(), description: text });

// Fields and stats are checked in depth by the schema compiler (same rules as tracker customisation).
const activityBody = z.object({
  name,
  categoryCode: z.string().min(1).max(80),
  kind: z.enum(ACTIVITY_KINDS),
  recordingMode: z.enum(['PER_SESSION', 'PER_SET', 'PER_ATTEMPT']),
  description: text,
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
  equipment: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  synonyms: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  parameters: z.array(z.record(z.string(), z.unknown())).max(40),
  metrics: z.array(z.record(z.string(), z.unknown())).max(40),
});
const templateBody = z.object({
  name: z.string().trim().min(2).max(120),
  categoryCode: z.string().min(1).max(80),
  description: text,
  activityCodes: z.array(z.string().min(1).max(80)).max(60),
});

/** `publishActivities`: also publish the profile's draft activities (otherwise 409 lists them). */
const publishBody = z.object({ publishActivities: z.boolean().default(false) }).default({ publishActivities: false });

const asActivity = (b: z.infer<typeof activityBody>): ActivityInput => ({
  ...b,
  parameters: b.parameters as unknown as ParameterDefinition[],
  metrics: b.metrics as unknown as MetricDefinition[],
});

/**
 * Admin Console API (FR-CAT-06): curators and admins place items in the category tree, edit draft activities
 * and profiles, and publish or retire versions. Published versions never change.
 */
@Roles('curator', 'admin')
@Controller('admin/catalog')
export class AdminController {
  constructor(
    private readonly admin: CatalogAdminService,
    private readonly editor: CatalogEditorService,
  ) {}

  // ---------------------------------------------------------------- categories
  @Get('tree')
  async tree() {
    return { items: await this.editor.tree() };
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(categoryBody, '/body')) b: z.infer<typeof categoryBody>,
  ) {
    return this.editor.createCategory(user.id, b);
  }

  @Patch('categories/:code')
  @HttpCode(204)
  async renameCategory(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(categoryPatch, '/body')) b: z.infer<typeof categoryPatch>,
  ) {
    await this.editor.renameCategory(user.id, code, b);
  }

  // ---------------------------------------------------------------- activities
  @Get('activities')
  async activities(@Query(new ZodPipe(searchQuery, '/query')) q: z.infer<typeof searchQuery>) {
    return { items: await this.editor.listActivities(q.q) };
  }

  @Post('activities')
  createActivity(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(activityBody, '/body')) b: z.infer<typeof activityBody>,
  ) {
    return this.editor.createActivity(user.id, asActivity(b));
  }

  @Get('activities/:code/versions/:version')
  activity(@Param('code') code: string, @Param('version', versionParam) version: number) {
    return this.editor.getActivity(code, version);
  }

  @Post('activities/:code/drafts')
  draftActivity(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.editor.draftActivity(user.id, code);
  }

  @Put('activities/:code/versions/:version')
  updateActivity(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) version: number,
    @Body(new ZodPipe(activityBody, '/body')) b: z.infer<typeof activityBody>,
  ) {
    return this.editor.updateActivity(user.id, code, version, asActivity(b));
  }

  @Delete('activities/:code/versions/:version')
  @HttpCode(204)
  async deleteActivity(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) v: number,
  ) {
    await this.editor.deleteActivityDraft(user.id, code, v);
  }

  @Post('activities/:code/versions/:version/publish')
  @HttpCode(200)
  publishActivity(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) v: number,
  ) {
    return this.editor.publishActivity(user.id, code, v);
  }

  @Post('activities/:code/versions/:version/retire')
  @HttpCode(204)
  async retireActivity(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) v: number,
  ) {
    await this.editor.retireActivity(user.id, code, v);
  }

  // ---------------------------------------------------------------- templates (profiles)
  @Get('templates')
  async templates(@Query(new ZodPipe(statusQuery, '/query')) q: z.infer<typeof statusQuery>) {
    return { items: await this.admin.listTemplateVersions(q.status) };
  }

  @Get('profiles')
  async profiles() {
    return { items: await this.editor.listTemplates() };
  }

  @Post('templates')
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(templateBody, '/body')) b: z.infer<typeof templateBody>,
  ) {
    return this.editor.createTemplate(user.id, b);
  }

  @Get('templates/:code/versions/:version')
  template(@Param('code') code: string, @Param('version', versionParam) version: number) {
    return this.editor.getTemplate(code, version);
  }

  @Post('templates/:code/drafts')
  draftTemplate(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.editor.draftTemplate(user.id, code);
  }

  @Put('templates/:code/versions/:version')
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) version: number,
    @Body(new ZodPipe(templateBody, '/body')) b: z.infer<typeof templateBody>,
  ) {
    return this.editor.updateTemplate(user.id, code, version, b);
  }

  @Delete('templates/:code/versions/:version')
  @HttpCode(204)
  async deleteTemplate(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) v: number,
  ) {
    await this.editor.deleteTemplateDraft(user.id, code, v);
  }

  @Post('templates/:code/versions/:version/publish')
  @HttpCode(200)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('version', versionParam) version: number,
    @Body(new ZodPipe(publishBody, '/body')) b: z.infer<typeof publishBody>,
  ) {
    return this.editor.publishTemplate(user.id, code, version, b.publishActivities);
  }

  @Post('templates/:code/versions/:version/retire')
  @HttpCode(200)
  retire(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('version', versionParam) version: number) {
    return this.admin.setTemplateStatus(user.id, code, version, 'RETIRED');
  }
}
