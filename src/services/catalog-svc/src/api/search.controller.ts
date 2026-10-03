import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public, ZodPipe } from '@trainme/service-kit';
import { CatalogSearchService, type SearchQuery } from '../application/catalog-search.service.js';

const list = z
  .string()
  .max(400)
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .optional();

const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  type: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim().toUpperCase()))
    .pipe(z.array(z.enum(['CATEGORY', 'TEMPLATE', 'ACTIVITY'])))
    .optional(),
  sport: list,
  role: list,
  muscle: list,
  equipment: list,
  category: list,
  kind: list,
  locale: z.string().max(10).default('en'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const suggestQuery = z.object({
  q: z.string().trim().min(2).max(50),
  locale: z.string().max(10).default('en'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

@Public()
@Controller('catalog')
export class SearchController {
  constructor(private readonly search: CatalogSearchService) {}

  @Get('search')
  async find(@Query(new ZodPipe(searchQuery, '/query')) q: z.infer<typeof searchQuery>) {
    const query: SearchQuery = {
      q: q.q,
      locale: q.locale,
      limit: q.limit,
      ...(q.type ? { types: q.type } : {}),
      ...(q.sport ? { sports: q.sport } : {}),
      ...(q.role ? { roles: q.role } : {}),
      ...(q.muscle ? { muscles: q.muscle } : {}),
      ...(q.equipment ? { equipment: q.equipment } : {}),
      ...(q.category ? { categories: q.category } : {}),
      ...(q.kind ? { kinds: q.kind } : {}),
    };
    return { items: await this.search.search(query) };
  }

  @Get('suggest')
  async suggest(@Query(new ZodPipe(suggestQuery, '/query')) q: z.infer<typeof suggestQuery>) {
    return { items: await this.search.suggest(q.q, q.locale, q.limit) };
  }
}
