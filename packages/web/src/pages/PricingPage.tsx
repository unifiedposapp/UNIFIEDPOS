import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Check, Sparkles, Repeat, ArrowRight } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Money,
  PageHeader,
  call,
  ghostButton,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Plans & Billing — the account's OWN plan picker and trial funnel.
 *
 * This is deliberately separate from the merchant-facing `SubscriptionsPage`
 * (which a store uses to bill *its* customers). Here the store owner chooses a
 * Unified POS plan and starts a free trial that — courtesy of the existing
 * recurring-billing engine — converts to paid automatically at the end of the
 * trial unless it is cancelled first. Every action goes through real endpoints
 * (`/subscriptions/plans`, `/subscriptions`, `/customers`); nothing is mocked.
 */

interface Plan {
  id: string;
  name: string;
  interval: string;
  intervalCount: number;
  amount: number;
  currency: string;
  trialDays: number;
  features?: string[];
  active?: boolean;
}

interface Sub {
  id: string;
  status: string;
  plan?: { name?: string } | null;
  trialEnd?: string | null;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

const TRIAL_DAYS = 14;

// Named to keep the `Promise<…>` annotation JSX-parser-friendly in a .tsx file
// (an inline `string | null` inside the generics trips TS1005 in this context).
type MaybeId = string | null;

/** Marketing-grade defaults so the page is meaningful even on a fresh account
 *  that has no plans yet. One click turns these into real DB plans. */
const RECOMMENDED: { name: string; monthly: number; tagline: string; popular?: boolean; features: string[] }[] = [
  {
    name: 'Starter',
    monthly: 39,
    tagline: 'A single outlet getting online.',
    features: ['1 register', 'Unlimited products & sales', 'Cash + card payments', 'Daily sales reports', 'Email support'],
  },
  {
    name: 'Growth',
    monthly: 119,
    tagline: 'Multi-register retail & hospitality.',
    popular: true,
    features: ['Up to 5 registers', 'Inventory + purchasing', 'Loyalty & marketing', 'Barcode labels & printing', 'Restaurant floor plan', 'Priority support'],
  },
  {
    name: 'Scale',
    monthly: 299,
    tagline: 'Chains and franchise HQ.',
    features: ['Unlimited registers', 'Franchise royalties & P&L', 'AI forecasting + copilot', 'Agent replenishment ops', 'Multi-location mesh', 'Advanced analytics'],
  },
  {
    name: 'Enterprise',
    monthly: 499,
    tagline: 'Global, regulated markets.',
    features: ['Fiscalisation & e-invoicing', 'Multi-region data residency', 'SSO / SCIM + audit', 'Embedded finance & rails', 'Dedicated success manager', '99.9% uptime SLA'],
  },
];

const CADENCES = ['MONTH', 'YEAR'] as const;
type Cadence = (typeof CADENCES)[number];

const daysLeft = (iso?: string | null): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
};

export default function PricingPage() {
  const { user, organization } = useAuthStore();
  const currency = organization?.currency || 'USD';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<Cadence>('MONTH');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canSeed = ['OWNER', 'ADMIN'].includes(user?.role || '');
  const canSubscribe = ['OWNER', 'ADMIN', 'MANAGER'].includes(user?.role || '');

  const load = useCallback(async () => {
    const [p, s, c] = await Promise.all([
      call(() => api.getSubscriptionPlans({ active: 'true' }), setError),
      call(() => api.getSubscriptions(), setError),
      call(() => api.getCustomers({ pageSize: '5' }), setError),
    ]);
    setPlans(Array.isArray(p) ? p : []);
    setSubs(Array.isArray(s) ? s : s?.subscriptions || []);
    // /customers is paginated ({ items }); read .items — never .data.
    setCustomerIds((Array.isArray(c) ? c : c?.items || []).map((x: any) => x.id).filter(Boolean));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activePlans = plans.filter((x) => x.active !== false);
  const hasPlans = activePlans.length > 0;

  // Current plan for the banner: the live subscription (trial, active, or past
  // due) — most-recently created first.
  const current: Sub | null =
    subs.find((x) => x.status === 'TRIALING') ||
    subs.find((x) => x.status === 'ACTIVE') ||
    subs.find((x) => x.status === 'PAST_DUE') ||
    null;

  // Plans to show for the chosen cadence; fall back to everything so a store
  // with only monthly plans never sees an empty page.
  const cadencePlans = activePlans.filter((x) => x.interval === cadence);
  const shownPlans = cadencePlans.length ? cadencePlans : activePlans;

  const resolveBillingCustomer = async (): Promise<MaybeId> => {
    if (customerIds[0]) return customerIds[0];
    const created = await call(
      () => api.createCustomer({ name: `${organization?.name || 'My business'} — Account Billing`, email: user?.email || '' }),
      setError,
    );
    if (created?.id) {
      setCustomerIds((ids) => [...ids, created.id]);
      return created.id;
    }
    return null;
  };

  const startTrial = async (plan: Plan) => {
    setBusy(plan.id);
    setNote(null);
    const customerId = await resolveBillingCustomer();
    if (customerId) {
      const sub: any = await call(
        () => api.createSubscription({ customerId, planId: plan.id, trialDaysOverride: plan.trialDays || TRIAL_DAYS }),
        setError,
      );
      if (sub) {
        const tl = daysLeft(sub.trialEnd);
        setNote(
          sub.status === 'TRIALING'
            ? `Your ${plan.name} trial has started — free until ${new Date(sub.trialEnd).toLocaleDateString()}. It converts to paid unless you cancel.`
            : `You're now on the ${plan.name} plan.${tl && tl > 0 ? ` ${tl} days left in the trial.` : ''}`,
        );
        await load();
      }
    }
    setBusy(null);
  };

  const loadRecommended = async () => {
    setBusy('seed');
    setNote(null);
    let created = 0;
    for (const tier of RECOMMENDED) {
      // Create a monthly and an annual variant (year = 10× monthly → 2 months free).
      const monthly: any = await call(
        () =>
          api.createSubscriptionPlan({
            name: tier.name,
            code: tier.name.toLowerCase(),
            interval: 'MONTH',
            amount: tier.monthly,
            currency,
            trialDays: TRIAL_DAYS,
            features: tier.features,
          }),
        setError,
      );
      if (monthly) created += 1;
      await call(
        () =>
          api.createSubscriptionPlan({
            name: `${tier.name} Annual`,
            code: `${tier.name.toLowerCase()}-annual`,
            interval: 'YEAR',
            amount: tier.monthly * 10,
            currency,
            trialDays: TRIAL_DAYS,
            features: tier.features,
          }),
        setError,
      );
    }
    setNote(created ? `Loaded ${created} plan tier(s). Pick one to start your free ${TRIAL_DAYS}-day trial.` : 'Plans already exist — showing your current plans.');
    await load();
    setBusy(null);
  };

  const cancelCurrent = async (atPeriodEnd: boolean) => {
    if (!current) return;
    setBusy(current.id);
    await call(() => api.cancelSubscription(current.id, { atPeriodEnd }), setError);
    await load();
    setBusy(null);
  };

  const reinstateCurrent = async () => {
    if (!current) return;
    setBusy(current.id);
    await call(() => api.reinstateSubscription(current.id), setError);
    await load();
    setBusy(null);
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Plans & Billing"
        subtitle={`Start free, upgrade when you're ready. Every plan begins with a ${TRIAL_DAYS}-day trial — you're only charged if you keep it past the trial end.`}
        actions={
          <div className="flex items-center gap-2">
            {/* Monthly / Annual cadence toggle. */}
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Billing cadence">
              {CADENCES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCadence(c)}
                  aria-pressed={cadence === c}
                  className={
                    'px-3 py-1.5 text-sm rounded-md font-medium transition ' +
                    (cadence === c ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50')
                  }
                >
                  {c === 'MONTH' ? 'Monthly' : 'Annual'}
                  {c === 'YEAR' && <span className="ms-1 text-[10px] opacity-80">· 2 months free</span>}
                </button>
              ))}
            </div>
            {!hasPlans && canSeed && (
              <button className={primaryButton} onClick={loadRecommended} disabled={busy === 'seed'}>
                <Sparkles size={14} className="inline -mt-0.5 mr-1" />
                {busy === 'seed' ? 'Loading…' : 'Load recommended plans'}
              </button>
            )}
          </div>
        }
      />

      <ErrorNote message={error} />
      {note && (
        <div role="status" className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-3 py-2">
          {note}
        </div>
      )}

      {/* Current subscription banner. */}
      {current && (
        <Card
          title="Your current plan"
          icon={<Repeat size={18} />}
          actions={
            <Link to="/subscriptions" className={ghostButton}>
              Manage billing <ArrowRight size={14} />
            </Link>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">{current.plan?.name || 'Subscription'}</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={current.status === 'TRIALING' ? 'info' : current.status === 'ACTIVE' ? 'good' : 'warn'}>{current.status}</Badge>
                {current.status === 'TRIALING' && daysLeft(current.trialEnd) != null && (
                  <span className="text-sm text-gray-600">{daysLeft(current.trialEnd)} days left in your free trial</span>
                )}
                {current.status !== 'TRIALING' && current.currentPeriodEnd && (
                  <span className="text-sm text-gray-600">Renews {new Date(current.currentPeriodEnd).toLocaleDateString()}</span>
                )}
                {current.cancelAtPeriodEnd && <span className="text-sm text-amber-600">Cancels at period end</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {['CANCELLED', 'EXPIRED'].includes(current.status) ? (
                <button className={ghostButton} onClick={reinstateCurrent} disabled={busy === current.id}>Reinstate</button>
              ) : (
                <button className={ghostButton} onClick={() => cancelCurrent(true)} disabled={busy === current.id}>
                  Cancel at period end
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Plan grid — real DB plans when present, otherwise the recommended tiers. */}
      {!hasPlans ? (
        <div className="space-y-3">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {RECOMMENDED.map((tier) => {
              const price = cadence === 'MONTH' ? tier.monthly : tier.monthly * 10;
              return (
                <div
                  key={tier.name}
                  className={'relative bg-white rounded-lg border p-5 flex flex-col ' + (tier.popular ? 'ring-2 ring-blue-500' : '')}
                >
                  {tier.popular && (
                    <span className="absolute -top-3 left-4 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">Most popular</span>
                  )}
                  <div className="font-semibold text-lg">{tier.name}</div>
                  <div className="text-sm text-gray-500">{tier.tagline}</div>
                  <div className="mt-3">
                    <span className="text-2xl font-bold">${price.toLocaleString()}</span>
                    <span className="text-gray-500 text-sm"> / {cadence === 'MONTH' ? 'mo' : 'yr'}</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className={primaryButton + ' mt-4 justify-center'}
                    onClick={canSeed ? loadRecommended : undefined}
                    disabled={!canSeed || busy === 'seed'}
                    title={canSeed ? 'Create these plans to enable a trial' : 'An owner/admin must load plans first'}
                  >
                    {canSeed ? 'Load & start trial' : 'Coming soon'}
                  </button>
                </div>
              );
            })}
          </div>
          {!canSeed && (
            <p className="text-sm text-gray-500 text-center">Plans for this account are managed by the owner/administrator.</p>
          )}
        </div>
      ) : shownPlans.length === 0 ? (
        <Card>
          <Empty>No {cadence === 'MONTH' ? 'monthly' : 'annual'} plans yet. Switch cadence, or load the recommended plans to get started.</Empty>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {shownPlans.map((plan) => {
            const isCurrent = !!current?.id && subs.find((s) => s.id === current.id)?.plan?.name === plan.name;
            const onTrial = current?.plan?.name === plan.name;
            return (
              <div key={plan.id} className={'bg-white rounded-lg border p-5 flex flex-col ' + (plan.name === 'Growth' ? 'ring-2 ring-blue-500' : '')}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-lg">{plan.name}</div>
                  {onTrial && <Badge tone="info">Current</Badge>}
                </div>
                <div className="mt-3">
                  <Money value={plan.amount} currency={plan.currency} />
                  <span className="text-gray-500 text-sm"> / {(plan.interval || '').toLowerCase() === 'year' ? 'yr' : 'mo'}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {plan.trialDays ? `${plan.trialDays}-day free trial` : 'No trial — billed immediately'}
                </div>
                {Array.isArray(plan.features) && plan.features.length > 0 && (
                  <ul className="mt-4 space-y-2 text-sm flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  className={primaryButton + ' mt-4 justify-center'}
                  onClick={() => startTrial(plan)}
                  disabled={!canSubscribe || busy === plan.id || isCurrent}
                >
                  {busy === plan.id ? 'Starting…' : plan.trialDays > 0 ? `Start ${plan.trialDays}-day trial` : 'Choose plan'}
                </button>
                {!canSubscribe && <p className="text-[11px] text-gray-400 mt-2 text-center">Only an owner/admin/manager can change the plan.</p>}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Trials are managed by the recurring-billing engine and convert to paid automatically at the trial end date unless cancelled.
      </p>
    </div>
  );
}
