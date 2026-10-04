'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';

type Plan = {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingInterval: string;
  trialDays: number;
  entitlements: Record<string, unknown>;
};
type Mine = {
  plan: Plan;
  subscription: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
};

/** FR-SUB-01..03: plans, current subscription, checkout via the provider page (MOCK in test). */
export default function SubscriptionPage() {
  const params = useSearchParams();
  const plans = useData<{ items: Plan[] }>('/plans');
  const mine = useData<Mine>('/subscriptions/me');
  const [error, setError] = useState<string>();
  const checkout = params.get('checkout');

  if (plans.error) return <ErrorBanner error={plans.error} />;
  if (!plans.data || !mine.data) return <Spinner />;
  const current = mine.data.plan.code;

  return (
    <div className="stack">
      <PageHeader title="Plan" subtitle="Test environment: payments use a mock provider – no money moves." />
      {checkout === 'success' && (
        <Notice>Payment received – your plan is active. Sign out and in again to refresh your plan everywhere.</Notice>
      )}
      {checkout === 'canceled' && <Notice tone="warn">Checkout canceled.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="grid-3">
        {plans.data.items.map((p) => (
          <Card
            key={p.code}
            title={
              <>
                {p.name} {p.code === current && <Badge tone="ok">current</Badge>}
              </>
            }
          >
            <div className="stat-value">
              {p.priceMinor === 0 ? 'Free' : `${(p.priceMinor / 100).toFixed(2)} ${p.currency}`}
              <span className="small muted">{p.priceMinor ? ` / ${p.billingInterval.toLowerCase()}` : ''}</span>
            </div>
            <ul className="small" style={{ paddingLeft: 18, margin: '12px 0' }}>
              <li>{String(p.entitlements.maxTrackers)} active trackers</li>
              <li>{p.entitlements.customParams ? 'Custom parameters & metrics' : 'Catalog parameters only'}</li>
              <li>{String(p.entitlements.historyDays)} days of history</li>
              <li>{p.entitlements.export ? 'Data export' : 'No export'}</li>
            </ul>
            {p.code !== current && p.priceMinor > 0 && (
              <button
                className="btn btn-primary btn-block"
                onClick={async () => {
                  try {
                    const r = await api<{ checkoutUrl: string }>('/subscriptions/checkout', {
                      method: 'POST',
                      body: { planCode: p.code },
                    });
                    window.location.href = r.checkoutUrl;
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Choose {p.name}
              </button>
            )}
          </Card>
        ))}
      </div>
      {mine.data.subscription && (
        <Card title="Your subscription">
          <p>
            Status: <Badge tone="ok">{mine.data.subscription.status}</Badge>{' '}
            {mine.data.subscription.currentPeriodEnd && (
              <>· renews {mine.data.subscription.currentPeriodEnd.slice(0, 10)}</>
            )}
            {mine.data.subscription.cancelAtPeriodEnd && ' · cancels at period end'}
          </p>
          <div className="row gap" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={async () => {
                await api('/subscriptions/me/cancel', { method: 'POST' });
                await mine.reload();
              }}
            >
              Cancel at period end
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api('/subscriptions/me/cancel?immediate=true', { method: 'POST' });
                await mine.reload();
              }}
            >
              Cancel now (test)
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
