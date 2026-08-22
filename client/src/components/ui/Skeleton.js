/**
 * Skeleton — structural loading placeholder.
 *
 * Responsibility: hold the exact shape of content that has not arrived yet.
 *
 * Invariants:
 *  - A skeleton MUST reserve the final dimensions of what replaces it. Cumulative layout shift is
 *    the whole reason this component exists; a placeholder that is the wrong size is worse than
 *    no placeholder, because the page visibly jumps at the moment the user starts reading.
 *  - Skeletons mirror the real layout (design-system §16): same line count, same widths, same
 *    gaps. A generic grey rectangle communicates "broken"; a structural skeleton communicates
 *    "arriving". Build one by copying the component's own layout, not by guessing.
 *  - `aria-hidden` throughout — the loading state is announced once by the container's
 *    `aria-busy`, not read out as a wall of empty boxes.
 */

/**
 * @param {'text'|'block'|'circle'|'card'|'table-row'} variant
 */
export function Skeleton({
  variant = 'text',
  width = '',
  height = '',
  lines = 3,
  columns = 4,
  radius = '',
} = {}) {
  const root = document.createElement('div');
  root.className = `skeleton skeleton--${variant}`;
  root.setAttribute('aria-hidden', 'true');
  if (width) root.style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) root.style.height = typeof height === 'number' ? `${height}px` : height;
  if (radius) root.style.borderRadius = radius;

  if (variant === 'text') {
    for (let i = 0; i < lines; i += 1) {
      const line = document.createElement('span');
      line.className = 'skeleton__line';
      // The last line of a paragraph is short — mimicking that is most of what makes a text
      // skeleton read as text rather than as a stack of bars.
      if (i === lines - 1 && lines > 1) line.style.width = '62%';
      root.append(line);
    }
    return root;
  }

  if (variant === 'card') {
    const media = document.createElement('span');
    media.className = 'skeleton__media';
    const body = document.createElement('span');
    body.className = 'skeleton__card-body';
    for (let i = 0; i < 3; i += 1) {
      const line = document.createElement('span');
      line.className = 'skeleton__line';
      if (i === 1) line.style.width = '55%';
      if (i === 2) line.style.width = '35%';
      body.append(line);
    }
    root.append(media, body);
    return root;
  }

  if (variant === 'table-row') {
    for (let i = 0; i < columns; i += 1) {
      const cell = document.createElement('span');
      cell.className = 'skeleton__cell';
      root.append(cell);
    }
    return root;
  }

  // block + circle need no children; their box IS the placeholder.
  return root;
}

/** Convenience: N stacked table-row skeletons, sized to the real row height. */
export function SkeletonRows({ rows = 5, columns = 4 } = {}) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < rows; i += 1) frag.append(Skeleton({ variant: 'table-row', columns }));
  return frag;
}
