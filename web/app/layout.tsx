import type { ReactNode } from 'react';
import './globals.css';

// Force all pages through this layout to be rendered dynamically.
// Without this, Next.js tries to statically render /_not-found at build
// time, which can invoke nested layouts before env vars are resolvable.
export const dynamic = 'force-dynamic';

/**
 * Root layout is intentionally minimal. The chrome (header, footer, theming)
 * lives in the splash page (app/page.tsx) or the city layout
 * (app/[city]/layout.tsx) depending on the route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
