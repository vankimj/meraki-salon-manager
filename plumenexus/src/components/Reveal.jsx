import { useEffect, useRef, useState } from 'react';
import { EASE, DUR } from '../theme.js';

// Choreographed scroll-reveal wrapper. First time the element enters the
// viewport it fades up from 24px below, slow editorial easing. Respects
// `prefers-reduced-motion` (handled globally in index.html, but we also
// snap to in-state instantly if it ever fires synchronously).
//
// Usage: <Reveal><Section ... /></Reveal>
//        <Reveal delay={120}>...</Reveal>     // optional stagger
//        <Reveal once={false}>...</Reveal>    // re-reveal each entry
export default function Reveal({ children, delay = 0, once = true, threshold = 0.12, className }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return undefined; }

    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setShown(true);
          if (once) obs.unobserve(el);
        } else if (!once) {
          setShown(false);
        }
      }
    }, { threshold, rootMargin: '0px 0px -8% 0px' });

    obs.observe(el);
    return () => obs.disconnect();
  }, [once, threshold]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translate3d(0,0,0)' : 'translate3d(0,24px,0)',
        transition: `opacity ${DUR.base} ${EASE} ${delay}ms, transform ${DUR.base} ${EASE} ${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}
