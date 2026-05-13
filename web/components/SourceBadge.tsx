import type { ReactElement } from 'react';

type Props = {
  url: string | null | undefined;
  name: string | null | undefined;
};

/**
 * Compact "verify on source" chip for use on cards. Renders nothing when
 * the story has no source URL (legacy data).
 */
export function SourceChip({ url, name }: Props): ReactElement | null {
  if (!url) return null;
  const label = name || 'source';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="source-chip"
      aria-label={`Read original source on ${label}`}
    >
      <span>{label}</span>
      <span className="source-chip-icon" aria-hidden>{'\u2197'}</span>
    </a>
  );
}

/**
 * Prominent band for the story detail page. Sits between the back link and
 * the headline, gives the reader an unambiguous "this is where this came
 * from" signal.
 */
export function SourceBand({ url, name }: Props): ReactElement | null {
  if (!url) return null;
  const label = name || 'original source';
  return (
    <div className="source-band">
      <div className="source-band-text">
        <span className="source-band-label">Reported from</span>
        <span className="source-band-name">{label}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="source-band-link"
      >
        Verify on source {'\u2197'}
      </a>
    </div>
  );
}
