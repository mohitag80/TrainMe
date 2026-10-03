import { sql, type Transaction } from 'kysely';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';

/**
 * Rebuilds the denormalised search rows (08 §4.1) for the default locale in one statement.
 * `categories` holds every ancestor code, so a facet on "gym.legs" also finds quads exercises.
 */
export async function rebuildSearchDocuments(trx: Transaction<CatalogDatabase>): Promise<number> {
  await sql`DELETE FROM catalog_search_doc WHERE locale = 'en'`.execute(trx);
  await sql`
    WITH RECURSIVE tree AS (
        SELECT id, code, ARRAY[code::text] AS path FROM category WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.code, t.path || c.code::text FROM category c JOIN tree t ON c.parent_id = t.id
    ),
    category_docs AS (
        INSERT INTO catalog_search_doc (item_type, item_code, name, description, kind, categories)
        SELECT 'CATEGORY', c.code, c.name, c.description, c.kind, t.path
        FROM category c JOIN tree t ON t.id = c.id
        WHERE c.status = 'ACTIVE'
        RETURNING 1
    ),
    activity_docs AS (
        INSERT INTO catalog_search_doc (item_type, item_code, name, synonyms, description, kind,
                                        sports, roles, categories, muscles, equipment, level)
        SELECT 'ACTIVITY', a.code, a.name, a.synonyms, a.description, a.kind, a.sports, a.roles,
               COALESCE((SELECT array_agg(DISTINCT p) FROM tree t, unnest(t.path) p WHERE t.code = ANY (a.category_codes)), '{}'),
               a.primary_muscles || a.secondary_muscles, a.equipment, a.level
        FROM activity_definition a
        WHERE a.status = 'PUBLISHED'
        RETURNING 1
    )
    INSERT INTO catalog_search_doc (item_type, item_code, name, description, sports, roles, categories, muscles, equipment)
    SELECT 'TEMPLATE', p.code, p.name, p.description,
           -- Sport and role come from the template's own category path (Cricket › … › Fast Bowler), not from
           -- its activities: shared conditioning drills are tagged with many sports.
           COALESCE((SELECT array_agg(c.code::text) FROM category c WHERE c.code = ANY (t.path) AND c.kind = 'SPORT'), '{}'),
           COALESCE((SELECT array_agg(regexp_replace(c.code, '^.*\\.', '')) FROM category c WHERE c.code = ANY (t.path) AND c.kind = 'ROLE'), '{}'),
           t.path,
           COALESCE((SELECT array_agg(DISTINCT x) FROM template_activity ta JOIN activity_definition a ON a.id = ta.activity_id,
                     unnest(a.primary_muscles) x WHERE ta.profile_template_id = p.id), '{}'),
           COALESCE((SELECT array_agg(DISTINCT x) FROM template_activity ta JOIN activity_definition a ON a.id = ta.activity_id,
                     unnest(a.equipment) x WHERE ta.profile_template_id = p.id), '{}')
    FROM profile_template p JOIN tree t ON t.id = p.category_id
    WHERE p.status = 'PUBLISHED'`.execute(trx);
  const { count } = await trx
    .selectFrom('catalogSearchDoc')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('locale', '=', 'en')
    .executeTakeFirstOrThrow();
  return Number(count);
}
