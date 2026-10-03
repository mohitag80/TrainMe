import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, Roles, ZodPipe } from '@trainme/service-kit';
import { CatalogAdminService } from '../application/catalog-admin.service.js';

const statusQuery = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']).optional() });
const versionParam = new ZodPipe(z.coerce.number().int().positive(), '/path/version');

/** Admin Console API (FR-CAT-06): curators publish and retire template versions. */
@Roles('curator', 'admin')
@Controller('admin/catalog')
export class AdminController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Get('templates')
  async templates(@Query(new ZodPipe(statusQuery, '/query')) q: z.infer<typeof statusQuery>) {
    return { items: await this.admin.listTemplateVersions(q.status) };
  }

  @Post('templates/:code/versions/:version/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('version', versionParam) version: number) {
    return this.admin.setTemplateStatus(user.id, code, version, 'PUBLISHED');
  }

  @Post('templates/:code/versions/:version/retire')
  @HttpCode(200)
  retire(@CurrentUser() user: AuthUser, @Param('code') code: string, @Param('version', versionParam) version: number) {
    return this.admin.setTemplateStatus(user.id, code, version, 'RETIRED');
  }
}
