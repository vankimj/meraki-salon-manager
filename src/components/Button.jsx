// One button to rule them all. Replaces the per-module local `Btn`
// components (which become thin wrappers over this) so the whole app shares
// a single, consistent button look instead of ~733 ad-hoc inline styles.
//
// Two ways to call it:
//
//   New code — semantic variant:
//     <Button variant="primary">Save</Button>
//     <Button variant="secondary" size="md">Cancel</Button>
//     <Button variant="danger">Delete</Button>
//     <Button variant="ghost">⋯</Button>
//
//   Legacy/compat — color-driven pill (exactly what the old local Btns did):
//     <Button color="#2D7A5F">…</Button>   // filled with `color` + white text
//     <Button>…</Button>                    // muted surface + muted text
//
// `style` merges last so a caller can fine-tune; all other props
// (type, title, aria-*, onMouseEnter, …) pass through to the <button>.

const SIZES = {
  sm: { fontSize: 11, padding: '4px 10px', borderRadius: 6 },
  md: { fontSize: 13, padding: '8px 14px', borderRadius: 8 },
};

// Brand tokens: green #2D7A5F, blue #3D95CE, teal #3D9E8A.
const VARIANTS = {
  primary:   { background: '#2D7A5F',                color: '#fff',                 border: 'none' },
  secondary: { background: 'var(--pn-surface)',      color: 'var(--pn-text)',       border: '1px solid var(--pn-border-strong)' },
  danger:    { background: '#ef4444',                color: '#fff',                 border: 'none' },
  success:   { background: '#10B981',                color: '#fff',                 border: 'none' },
  ghost:     { background: 'transparent',            color: 'var(--pn-text-muted)', border: 'none' },
  muted:     { background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', border: 'none' },
};

export default function Button({
  variant, size = 'sm', color, disabled = false,
  style, children, type = 'button', onClick, ...rest
}) {
  const palette = variant
    ? (VARIANTS[variant] || VARIANTS.secondary)
    : (color
        ? { background: color, color: '#fff', border: 'none' }   // legacy color-driven fill
        : VARIANTS.muted);                                       // legacy "no color" muted pill

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...rest}
      style={{
        ...(SIZES[size] || SIZES.sm),
        ...palette,
        fontFamily: 'inherit',
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .2s ease',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
