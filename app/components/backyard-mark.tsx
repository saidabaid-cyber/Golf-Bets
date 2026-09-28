/**
 * Exact crop of the approved Backyard master artwork. The source SVG remains
 * untouched; this view only hides the wordmark so product art can use the
 * symbol without redrawing or approximating it.
 */
export function BackyardMark({ className }: { className?: string }) {
  return <svg
    className={className}
    aria-hidden="true"
    focusable="false"
    viewBox="375 255 340 455"
    preserveAspectRatio="xMidYMid meet"
  >
    <image
      href="/brand/the-backyard-logo.svg"
      x="158.333333"
      y="259.333333"
      width="763.333333"
      height="630.666667"
      preserveAspectRatio="xMidYMid meet"
    />
  </svg>;
}
