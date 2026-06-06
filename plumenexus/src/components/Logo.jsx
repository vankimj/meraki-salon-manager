// Plume Nexus brand mark: a feather-plume rosette — eight iridescent plumes
// converging on a peacock-eye "nexus" hub, in a gold-ringed badge.
// Source of truth: brand/generate-mark.cjs → served as /favicon.svg.
export default function Logo({ size = 36 }) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt="Plume Nexus"
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
