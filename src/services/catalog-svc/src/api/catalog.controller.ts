import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public, ZodPipe } from '@trainme/service-kit';
import { CatalogQueryService } from '../application/catalog-query.service.js';

const codeParam = new ZodPipe(z.string().regex(/^[a-z0-9_.-]{2,120}$/), '/path/code');
const versionParam = new ZodPipe(z.coerce.number().int().positive(), '/path/version');
const listQuery = new ZodPipe(z.object({ category: z.string().max(80).optional() }), '/query');

/** Public read API: anyone may browse the catalog (responses are cacheable). */
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogQueryService) {}

  @Get('units')
  units() {
    return this.catalog.getUnits();
  }

  @Get('categories')
  async categories() {
    return { items: await this.catalog.getCategoryTree() };
  }

  @Get('templates')
  async templates(@Query(listQuery) q: { category?: string }) {
    return { items: await this.catalog.listTemplates(q.category) };
  }

  @Get('templates/:code')
  template(@Param('code', codeParam) code: string) {
    return this.catalog.getTemplate(code);
  }

  @Get('templates/:code/versions/:version')
  templateVersion(@Param('code', codeParam) code: string, @Param('version', versionParam) version: number) {
    return this.catalog.getTemplate(code, version);
  }

  @Get('activities/:code')
  activity(@Param('code', codeParam) code: string) {
    return this.catalog.getActivity(code);
  }
}
