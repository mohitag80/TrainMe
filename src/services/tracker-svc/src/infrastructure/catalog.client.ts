import { Inject, Injectable } from '@nestjs/common';
import { ProblemError } from '@trainme/errors';
import { ServiceClient, UpstreamError } from '@trainme/http-client';
import type { Logger } from '@trainme/observability';
import type { TemplateSnapshot } from '@trainme/schema';
import { LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { TrackerConfig } from '../config/tracker.config.js';

/** Reads template snapshots from catalog-svc (public, cacheable endpoints). */
@Injectable()
export class CatalogClient {
  private readonly http: ServiceClient;

  constructor(@Inject(SERVICE_CONFIG) config: TrackerConfig, @Inject(LOGGER) log: Logger) {
    this.http = new ServiceClient({ name: 'catalog-svc', baseUrl: config.CATALOG_SVC_URL, log, timeoutMs: 3_000 });
  }

  async template(code: string, version?: number, requestId?: string): Promise<TemplateSnapshot> {
    const path = version
      ? `/api/v1/templates/${encodeURIComponent(code)}/versions/${version}`
      : `/api/v1/templates/${encodeURIComponent(code)}`;
    try {
      return await this.http.get<TemplateSnapshot>(path, requestId ? { requestId } : {});
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404)
        throw ProblemError.notFound(`Template ${code}${version ? ` v${version}` : ''}`);
      throw err;
    }
  }
}
