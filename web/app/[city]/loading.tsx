/**
 * City home skeleton — matches card-grid shape. Shown while the page's
 * server component (which queries Supabase) is resolving.
 */
export default function CityHomeLoading() {
  return (
    <div className="card-grid" aria-busy="true" aria-label="Loading stories">
      <SkeletonCard lead />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

function SkeletonCard({ lead = false }: { lead?: boolean }) {
  return (
    <div className={`skeleton-card${lead ? ' card-lead' : ''}`}>
      <div className="skeleton-line short" />
      <div className="skeleton-line title" />
      <div className="skeleton-line long" />
      <div className="skeleton-line medium" />
    </div>
  );
}
