/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type CityCard = {
  id: string;
  name: string;
  state: string | null;
  state_code: string | null;
  subdomain: string;
  latest_at: string | null;
  url: string;
};

type TopRequested = {
  city_name: string;
  state: string;
  request_count: number;
};

type SearchHit = {
  id: string;
  name: string;
  state: string | null;
  state_code: string | null;
  subdomain: string;
};

type Props = {
  cities: CityCard[];
  topRequested: TopRequested[];
  /**
   * Map from subdomain -> resolved URL. We resolve server-side because
   * server->client props must be serializable; can't pass a function.
   */
  cityUrls: Record<string, string>;
};

export default function SplashHome({ cities, topRequested, cityUrls }: Props) {
  return (
    <div className="splash-root">
      <Hero />
      <CitySearch
        cityUrls={cityUrls}
        onPick={(hit) => {
          const url = cityUrls[hit.subdomain];
          if (url) window.location.assign(url);
        }}
      />
      {cities.length > 0 ? (
        <section className="splash-section">
          <h2 className="splash-section-title">Live cities</h2>
          <p className="splash-section-sub">Plain-language coverage of public meetings, refreshed regularly.</p>
          <div className="splash-city-grid">
            {cities.map((c) => (
              <a key={c.id} href={c.url} className="splash-city-card">
                <h3>{c.name}</h3>
                <p>{[c.state_code, c.state].filter(Boolean).join(' ')}</p>
                <span className="splash-city-card-cta">Read coverage {'\u2192'}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <RequestForm />
      {topRequested.length > 0 ? (
        <section className="splash-section">
          <h2 className="splash-section-title">Coming next</h2>
          <p className="splash-section-sub">Cities readers have asked us to cover, by request volume.</p>
          <ol className="splash-coming-list">
            {topRequested.map((t, i) => (
              <li key={`${t.city_name}-${t.state}-${i}`}>
                <span className="splash-coming-rank">{i + 1}</span>
                <span className="splash-coming-name">
                  {t.city_name}, {t.state}
                </span>
                <span className="splash-coming-count">{t.request_count} {t.request_count === 1 ? 'request' : 'requests'}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Hero() {
  return (
    <section className="splash-hero">
      <h1>Plain-language coverage of public meetings.</h1>
      <p>
        Civic Weekly summarizes what your city council, school board, and zoning
        commission actually decided &mdash; who voted, what changes, and what residents can do about it.
      </p>
    </section>
  );
}

function CitySearch({
  onPick,
  cityUrls: _cityUrls,
}: {
  onPick: (hit: SearchHit) => void;
  cityUrls: Record<string, string>;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('search failed');
        const json = (await res.json()) as { hits: SearchHit[] };
        setHits(json.hits || []);
        setOpen(true);
      } catch {
        setHits([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  return (
    <section className="splash-search">
      <label className="splash-search-label" htmlFor="city-search">
        Find your city
      </label>
      <div className="splash-search-shell">
        <input
          id="city-search"
          type="search"
          autoComplete="off"
          placeholder="Start typing a city name..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {open && hits.length > 0 ? (
          <ul className="splash-search-results" role="listbox">
            {hits.map((h) => (
              <li key={h.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(h);
                  }}
                >
                  <strong>{h.name}</strong>
                  <span>{[h.state_code, h.state].filter(Boolean).join(' ')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {open && hits.length === 0 && q.trim().length >= 2 && !loading ? (
          <div className="splash-search-empty">
            No live coverage for &ldquo;{q}&rdquo; yet. Use the form below to request your city.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RequestForm() {
  const [name, setName] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const ready = useMemo(
    () => name.trim().length > 0 && stateVal.trim().length > 0 && /\S+@\S+\.\S+/.test(email),
    [name, stateVal, email]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/request-city', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city_name: name, state: stateVal, email }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      setStatus('ok');
      setName('');
      setStateVal('');
      setEmail('');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <section className="splash-section splash-request">
      <h2 className="splash-section-title">Request your city</h2>
      <p className="splash-section-sub">
        Tell us where you live and we&rsquo;ll line up coverage. We&rsquo;ll email you when it&rsquo;s live.
      </p>
      <form onSubmit={submit} className="splash-form">
        <div className="splash-form-row">
          <input
            type="text"
            placeholder="City"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <input
            type="text"
            placeholder="State"
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value)}
            required
            maxLength={60}
          />
        </div>
        <input
          type="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
        />
        <button type="submit" disabled={!ready || status === 'submitting'}>
          {status === 'submitting' ? 'Sending\u2026' : 'Request coverage'}
        </button>
        {status === 'ok' ? (
          <p className="splash-form-msg ok">Got it. We&rsquo;ll be in touch when {name || 'your city'} is live.</p>
        ) : null}
        {status === 'error' ? (
          <p className="splash-form-msg err">{errorMsg || 'Something went wrong. Try again?'}</p>
        ) : null}
      </form>
    </section>
  );
}
