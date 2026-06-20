// Pre-seeded from Meraki Nail Studio's GlossGenius listing.
// Images are self-hosted in /services/ (downloaded from GlossGenius CDN, resized to 600px).
export const SEED_SERVICES = [
  // ── Manicures ───────────────────────────────────────
  {
    category: 'Manicures', name: 'Gel-X', basePrice: 70, priceFrom: true, duration: 60, durationMin: true, active: true, sortOrder: 0,
    description: 'Fully 100% soft gel tip with various shapes and lengths, designed for nail art focus.',
    image: '/services/gel-x.jpg',
  },
  {
    category: 'Manicures', name: 'Structured Gel Manicure', basePrice: 50, priceFrom: true, duration: 60, durationMin: true, active: true, sortOrder: 1,
    description: 'Thicker gel application that reinforces natural nails. Best for short to medium lengths.',
    image: '/services/structured-gel.jpg',
  },
  {
    category: 'Manicures', name: 'Gel Manicure', basePrice: 40, priceFrom: true, duration: 35, durationMin: true, active: true, sortOrder: 2,
    description: 'Includes trimming, shaping, buffing, cuticle care, hand massage, and gel polish.',
    image: '/services/gel-manicure.jpg',
  },
  {
    category: 'Manicures', name: 'Signature Manicure', basePrice: 32, priceFrom: true, duration: 35, durationMin: true, active: true, sortOrder: 3,
    description: 'Steam manicure with soak, exfoliation, cuticle care, nail shaping, and hydrating massage.',
    image: '/services/signature-manicure.jpg',
  },
  {
    category: 'Manicures', name: 'Deluxe Manicure', basePrice: 40, priceFrom: true, duration: 40, durationMin: true, active: true, sortOrder: 4,
    description: 'Luxurious steam treatment: soak, exfoliation, cuticle care, mud mask, massage, hot towels, and paraffin wax.',
    image: '/services/deluxe-manicure.jpg',
  },
  {
    category: 'Manicures', name: 'Spa Manicure', basePrice: 25, priceFrom: false, duration: 30, durationMin: false, active: true, sortOrder: 5,
    description: 'Nail trim, shape, buff, cuticle grooming, lotion massage, and regular polish.',
    image: '/services/spa-manicure.jpg',
  },
  {
    category: 'Manicures', name: 'Gel Polish Change', basePrice: 32, priceFrom: false, duration: 30, durationMin: false, active: true, sortOrder: 6,
    description: 'Polish-only service — not a full manicure.',
    image: '/services/gel-manicure.jpg',
  },
  {
    category: 'Manicures', name: 'Dip Manicure', basePrice: 45, priceFrom: true, duration: 45, durationMin: true, active: true, sortOrder: 7,
    description: 'Full manicure with pigmented dip powder for a long-lasting, durable finish. 9 color options available.',
    image: '/services/dip.jpg',
  },

  // ── Pedicures ───────────────────────────────────────
  {
    category: 'Pedicures', name: 'Spa Pedicure', basePrice: 40, priceFrom: true, duration: 35, durationMin: true, active: true, sortOrder: 0,
    description: 'Includes trimming, shaping, buffing, cuticle care, callus removal, massage, and polish.',
    image: '/services/spa-pedicure.jpg',
  },
  {
    category: 'Pedicures', name: 'Signature Pedicure', basePrice: 52, priceFrom: true, duration: 45, durationMin: true, active: true, sortOrder: 1,
    description: 'Steam pedicure with nail care, callus removal, sugar scrub, mud mask, massage, and hot towels.',
    image: '/services/signature-pedicure.jpg',
  },
  {
    category: 'Pedicures', name: 'Deluxe Pedicure', basePrice: 65, priceFrom: true, duration: 60, durationMin: true, active: true, sortOrder: 2,
    description: 'Ultimate steam treatment: nail care, callus removal, sugar scrub, mud mask, hot stone massage, and hot towels.',
    image: '/services/signature-pedicure.jpg',
  },
  {
    category: 'Pedicures', name: 'Toe Polish Change', basePrice: 20, priceFrom: false, duration: 20, durationMin: false, active: true, sortOrder: 3,
    description: 'Fresh pop of color with trim, shape, buff, and polish application.',
    image: '/services/spa-pedicure.jpg',
  },

  // ── Add-ons ─────────────────────────────────────────
  {
    category: 'Add-ons', name: 'Nail Repair', basePrice: 5, priceFrom: true, duration: 15, durationMin: true, active: true, sortOrder: 1,
    description: 'Professional repair service to fix broken or damaged nails, restoring shape and strength.',
    image: '/services/nail-repair.jpg',
  },
  {
    category: 'Add-ons', name: 'Nail Art', basePrice: 15, priceFrom: true, duration: 10, durationMin: true, active: true, sortOrder: 2,
    description: 'Custom nail art — 9 style options available.',
    image: '/services/nail-art.jpg',
  },
  {
    category: 'Add-ons', name: 'Removal', basePrice: 10, priceFrom: true, duration: 20, durationMin: true, active: true, sortOrder: 3,
    description: 'Gentle removal of nail enhancements, preserving nail health. 6 options available.',
    image: '/services/removal.jpg',
  },
  {
    category: 'Add-ons', name: 'Luxury Paraffin Treatment', basePrice: 15, priceFrom: false, duration: 15, durationMin: false, active: true, sortOrder: 4,
    description: 'Heat therapy for hands or feet providing deep moisturizing and soothing relief.',
    image: '/services/paraffin.jpg',
  },
];

export const CATEGORY_ORDER = ['Manicures', 'Pedicures', 'Add-ons'];
