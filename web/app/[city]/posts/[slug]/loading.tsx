export default function PostLoading() {
  return (
    <article className="post-detail" aria-busy="true" aria-label="Loading story">
      <div className="skeleton-line short" style={{ width: 120 }} />
      <div style={{ height: 16 }} />
      <div className="skeleton-line title" />
      <div style={{ height: 16 }} />
      <div className="skeleton-line long" />
      <div style={{ height: 8 }} />
      <div className="skeleton-line long" />
      <div style={{ height: 8 }} />
      <div className="skeleton-line medium" />
    </article>
  );
}
