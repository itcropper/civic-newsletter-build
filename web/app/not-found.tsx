import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="post-detail">
      <h1>Not found</h1>
      <p>The page you requested doesn&apos;t exist.</p>
      <p><Link href="/">Back to all stories</Link></p>
    </div>
  );
}
