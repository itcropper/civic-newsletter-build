import type { ReactElement } from 'react';

type Props = { impact: string | null | undefined };

/**
 * Three-state impact pill: High = filled primary, Medium = outlined primary,
 * Low = outlined muted. Renders nothing for null/unknown values.
 */
export function ImpactPill({ impact }: Props): ReactElement | null {
  if (!impact) return null;
  const tier = impact.toLowerCase();
  const className =
    tier === 'high'
      ? 'impact-pill impact-pill-high'
      : tier === 'medium'
      ? 'impact-pill impact-pill-medium'
      : tier === 'low'
      ? 'impact-pill impact-pill-low'
      : null;
  if (!className) return null;
  return <span className={className}>{impact}</span>;
}
