'use client';

import { useEffect, useMemo, useState } from 'react';

type Props = {
  cityName: string;
  /**
   * Variant controls layout density and copy. `hero` is a generous block
   * shown above the fold; `footer` is a compact pinned form for repeat
   * exposure further down the page.
   */
  variant?: 'hero' | 'footer';
};

/**
 * Subscribe form for the city blog. POSTs to /api/subscribe which forwards
 * to Beehiiv. Captures UTM params from the URL on mount so we can attribute
 * paid traffic to the right campaign.
 */
export default function SubscribeForm({ cityName, variant = 'hero' }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [utm, setUtm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const captured: Record<string, string> = {};
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const v = params.get(k);
        if (v) captured[k] = v.slice(0, 200);
      }
      if (Object.keys(captured).length > 0) setUtm(captured);
    } catch {
      /* noop */
    }
  }, []);

  const ready = useMemo(() => /\S+@\S+\.\S+/.test(email), [email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, utm }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      setStatus('ok');
      setEmail('');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  const compact = variant === 'footer';

  return (
    <section className={`subscribe-block${compact ? ' subscribe-block-footer' : ''}`}>
      <div className="subscribe-text">
        <h2 className="subscribe-title">
          {compact
            ? `Get ${cityName} Civic in your inbox`
            : `Don\u2019t miss what your city just decided`}
        </h2>
        <p className="subscribe-sub">
          {compact
            ? 'Weekly summaries of council, school board, and zoning meetings. Free.'
            : `One short email a week summarizing what ${cityName}\u2019s public bodies actually did \u2014 plus what residents can do about it.`}
        </p>
      </div>
      <form onSubmit={submit} className="subscribe-form">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
          aria-label="Email address"
        />
        <button type="submit" disabled={!ready || status === 'submitting'}>
          {status === 'submitting' ? 'Sending\u2026' : 'Subscribe'}
        </button>
      </form>
      {status === 'ok' ? (
        <p className="subscribe-msg ok">
          You&rsquo;re in. Watch for a welcome email from {cityName} Civic.
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="subscribe-msg err">{errorMsg || 'Something went wrong. Try again?'}</p>
      ) : null}
    </section>
  );
}
