import { envBoolean, loadConfig, platformConfigSchema, z } from '@trainme/config';

export const catalogConfigSchema = platformConfigSchema.extend({
  SEED_CATALOG_ON_START: envBoolean.default(false),
  /** Overrides the seed baked into the image (dist/seed/catalog.json). */
  SEED_FILE: z.string().optional(),
  /** Per-query budget for search (08 §6: 1.5 s on k3s test, 4 s in production). */
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
});

export type CatalogConfig = z.infer<typeof catalogConfigSchema>;

export const loadCatalogConfig = (): CatalogConfig => loadConfig(catalogConfigSchema);
