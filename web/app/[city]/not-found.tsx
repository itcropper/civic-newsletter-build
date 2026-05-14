import Link from 'next/link';

export default function CityNotFound() {
  return (
    <div className="post-detail">
      <h1>City not found</h1>
      <p>We don&rsquo;t have a Civic Weekly site for that city yet.</p>
      <p>
        <Link href="/">Back to all cities</Link> or request your city from the home page.
      </p>
    </div>
  );
}
