/**
 * Splash loading state. Shown while the home page resolves Supabase queries
 * (active cities + top-requested cities). Kept deliberately light because
 * the splash is small.
 */
export default function HomeLoading() {
  return (
    <div className="splash-root" aria-busy="true" aria-label="Loading">
      <section className="splash-hero">
        <div className="skeleton-line title" />
        <div className="skeleton-line long" />
      </section>
    </div>
  );
}
