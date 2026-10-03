// Plan limits used by tracker-svc. subscription-svc publishes the authoritative values (user_entitlement);
// these defaults apply until that read model has a row for the user (plan pricing is still open: SRS §6).

export interface TrackerEntitlements {
  maxTrackers: number;
  customParams: boolean;
  maxCustomMetrics: number;
}

export const PLAN_DEFAULTS: Record<string, TrackerEntitlements> = {
  FREE: { maxTrackers: 2, customParams: false, maxCustomMetrics: 0 },
  PRO: { maxTrackers: 10, customParams: true, maxCustomMetrics: 10 },
  ELITE: { maxTrackers: 50, customParams: true, maxCustomMetrics: 25 },
};

/** Merges a stored entitlement document over the plan defaults; unknown plans fall back to FREE. */
export function resolveEntitlements(plan: string, stored?: Record<string, unknown>): TrackerEntitlements {
  const base = PLAN_DEFAULTS[plan] ?? PLAN_DEFAULTS.FREE!;
  if (!stored) return base;
  return {
    maxTrackers: typeof stored.maxTrackers === 'number' ? stored.maxTrackers : base.maxTrackers,
    customParams: typeof stored.customParams === 'boolean' ? stored.customParams : base.customParams,
    maxCustomMetrics: typeof stored.maxCustomMetrics === 'number' ? stored.maxCustomMetrics : base.maxCustomMetrics,
  };
}
