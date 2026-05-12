import { createProduct, fetchProducts, purgeProduct } from '../lib/firestore';

// picsum.photos/seed/{slug}/200/200 gives a stable deterministic image for each product
function img(slug) {
  return `https://picsum.photos/seed/${slug}/200/200`;
}

const PRODUCTS = [
  // ── Nail Lacquer ──────────────────────────────────────────
  {
    name: 'OPI Nail Lacquer – Big Apple Red',
    brand: 'OPI', category: 'Nail Care', sku: 'OPI-NL-L72',
    price: 12.50, cost: 4.80, stock: 14,
    description: 'Classic true red. One of OPI\'s best-selling shades.',
    image: img('opi-big-apple-red'), active: true, _demo: true,
  },
  {
    name: 'OPI Nail Lacquer – I\'m Not Really a Waitress',
    brand: 'OPI', category: 'Nail Care', sku: 'OPI-NL-H08',
    price: 12.50, cost: 4.80, stock: 11,
    description: 'Deep red with subtle pearl shimmer.',
    image: img('opi-not-a-waitress'), active: true, _demo: true,
  },
  {
    name: 'Essie Nail Polish – Ballet Slippers',
    brand: 'Essie', category: 'Nail Care', sku: 'ESS-NL-162',
    price: 10.99, cost: 4.10, stock: 20,
    description: 'Sheer blush pink. Royal Family favourite.',
    image: img('essie-ballet-slippers'), active: true, _demo: true,
  },
  {
    name: 'Essie Nail Polish – Bordeaux',
    brand: 'Essie', category: 'Nail Care', sku: 'ESS-NL-030',
    price: 10.99, cost: 4.10, stock: 16,
    description: 'Deep burgundy wine. Sophisticated and timeless.',
    image: img('essie-bordeaux'), active: true, _demo: true,
  },
  {
    name: 'Zoya Nail Polish – Purity',
    brand: 'Zoya', category: 'Nail Care', sku: 'ZOY-NL-PUR',
    price: 10.00, cost: 3.75, stock: 9,
    description: 'Clean opaque white. Free from harsh chemicals.',
    image: img('zoya-purity-white'), active: true, _demo: true,
  },
  {
    name: 'Sally Hansen Complete Salon Manicure – Fuchsia Power',
    brand: 'Sally Hansen', category: 'Nail Care', sku: 'SH-CSM-520',
    price: 8.99, cost: 3.20, stock: 22,
    description: 'Vivid hot pink with built-in base & top coat.',
    image: img('sally-hansen-fuchsia'), active: true, _demo: true,
  },

  // ── Gel Polish ────────────────────────────────────────────
  {
    name: 'OPI GelColor – My Chihuahua Bites',
    brand: 'OPI', category: 'Nail Care', sku: 'OPI-GC-M21',
    price: 20.99, cost: 8.50, stock: 8,
    description: 'Bright coral-red gel polish. 3-week wear.',
    image: img('opi-gelcolor-coral'), active: true, _demo: true,
  },
  {
    name: 'Gelish Gel Polish – Forever & Ever',
    brand: 'Gelish', category: 'Nail Care', sku: 'GEL-01083',
    price: 17.99, cost: 6.90, stock: 7,
    description: 'Dusty mauve with neutral undertones.',
    image: img('gelish-forever-ever'), active: true, _demo: true,
  },
  {
    name: 'CND Shellac – Negligee',
    brand: 'CND', category: 'Nail Care', sku: 'CND-SH-NEG',
    price: 19.99, cost: 7.80, stock: 5,
    description: 'Sheer warm pink. Perennial top seller.',
    image: img('cnd-shellac-negligee'), active: true, _demo: true,
  },
  {
    name: 'CND Shellac – Poison Plum',
    brand: 'CND', category: 'Nail Care', sku: 'CND-SH-PPL',
    price: 19.99, cost: 7.80, stock: 3,
    description: 'Deep jewel-toned purple gel.',
    image: img('cnd-shellac-plum'), active: true, _demo: true,
  },
  {
    name: 'SNS Dipping Powder – Radiant Pink',
    brand: 'SNS', category: 'Nail Care', sku: 'SNS-DP-R102',
    price: 18.50, cost: 7.20, stock: 6,
    description: 'Odor-free dipping powder in sheer radiant pink.',
    image: img('sns-dipping-powder-pink'), active: true, _demo: true,
  },

  // ── Nail Treatments & Base/Top ────────────────────────────
  {
    name: 'OPI Nail Envy – Original Formula',
    brand: 'OPI', category: 'Nail Care', sku: 'OPI-NE-T80',
    price: 18.99, cost: 7.50, stock: 12,
    description: 'Strengthening base coat with hydrolyzed wheat protein.',
    image: img('opi-nail-envy'), active: true, _demo: true,
  },
  {
    name: 'Essie Millionails – Strengthening Base Coat',
    brand: 'Essie', category: 'Nail Care', sku: 'ESS-BC-MLN',
    price: 9.99, cost: 3.80, stock: 18,
    description: 'Calcium-enriched base coat for brittle nails.',
    image: img('essie-millionails'), active: true, _demo: true,
  },
  {
    name: 'Seche Vite Dry Fast Top Coat',
    brand: 'Seche Vite', category: 'Nail Care', sku: 'SV-TC-001',
    price: 9.49, cost: 3.50, stock: 24,
    description: 'Industry-standard quick-dry top coat. Crystal clear finish.',
    image: img('seche-vite-top-coat'), active: true, _demo: true,
  },

  // ── Cuticle & Hand Care ───────────────────────────────────
  {
    name: 'CND SolarOil Nail & Cuticle Care',
    brand: 'CND', category: 'Skincare', sku: 'CND-SO-3.7',
    price: 9.99, cost: 3.90, stock: 19,
    description: 'Jojoba & Vitamin E blend. Conditions nails and cuticles.',
    image: img('cnd-solar-oil'), active: true, _demo: true,
  },
  {
    name: 'OPI Avojuice Lotion – Peaches & Cream',
    brand: 'OPI', category: 'Skincare', sku: 'OPI-AJ-PC',
    price: 12.00, cost: 4.60, stock: 10,
    description: 'Lightweight hand & body lotion. Avocado oil infused.',
    image: img('opi-avojuice-peach'), active: true, _demo: true,
  },
  {
    name: 'Burt\'s Bees Lemon Butter Cuticle Cream',
    brand: "Burt's Bees", category: 'Skincare', sku: 'BB-CC-LEM',
    price: 6.99, cost: 2.40, stock: 15,
    description: '100% natural cuticle cream. Lemon & vitamin E.',
    image: img('burts-bees-cuticle'), active: true, _demo: true,
  },
  {
    name: 'Essie Apricot Cuticle Oil',
    brand: 'Essie', category: 'Skincare', sku: 'ESS-CO-APR',
    price: 9.99, cost: 3.80, stock: 13,
    description: 'Lightweight cuticle oil pen. Apricot kernel oil blend.',
    image: img('essie-cuticle-oil'), active: true, _demo: true,
  },

  // ── Tools ─────────────────────────────────────────────────
  {
    name: 'Revlon Professional Nail Clipper Set',
    brand: 'Revlon', category: 'Tools', sku: 'REV-NC-SET',
    price: 8.99, cost: 3.20, stock: 8,
    description: 'Fingernail + toenail clippers with stainless steel blades.',
    image: img('revlon-nail-clipper'), active: true, _demo: true,
  },
  {
    name: 'Born Pretty 4-Way Nail Buffer Block',
    brand: 'Born Pretty', category: 'Tools', sku: 'BP-BUF-4W',
    price: 5.99, cost: 1.80, stock: 30,
    description: 'File, buff, smooth, and shine in one block. 10-pack.',
    image: img('born-pretty-buffer'), active: true, _demo: true,
  },
  {
    name: 'Mia Secret Nail Art Brush Set (5 pcs)',
    brand: 'Mia Secret', category: 'Tools', sku: 'MIA-NB-5PC',
    price: 14.99, cost: 5.50, stock: 4,
    description: 'Liner, striper, fan, dotting, and flat brushes.',
    image: img('nail-art-brush-set'), active: true, _demo: true,
  },
  {
    name: 'OPI ProSpa Foot Mask',
    brand: 'OPI', category: 'Skincare', sku: 'OPI-PS-FM',
    price: 5.99, cost: 2.00, stock: 20,
    description: 'Single-use pedicure booties. Shea butter infused.',
    image: img('opi-foot-mask'), active: true, _demo: true,
  },

  // ── Accessories / Nail Art ────────────────────────────────
  {
    name: 'Glitter Nail Art Set – 12 Colors',
    brand: 'Born Pretty', category: 'Accessories', sku: 'BP-GL-12C',
    price: 12.99, cost: 4.20, stock: 6,
    description: 'Fine glitter in 12 shades. Holographic & metallic.',
    image: img('glitter-nail-art'), active: true, _demo: true,
  },
  {
    name: 'Nail Rhinestone & Gem Assortment',
    brand: 'Beetles', category: 'Accessories', sku: 'BEE-GEM-AS',
    price: 10.99, cost: 3.50, stock: 9,
    description: '1,200 pieces of mixed-size crystal rhinestones.',
    image: img('nail-rhinestones'), active: true, _demo: true,
  },
  {
    name: 'Nail Foil Transfer Kit',
    brand: 'Modelones', category: 'Accessories', sku: 'MDL-FT-KIT',
    price: 9.99, cost: 3.40, stock: 7,
    description: 'Chrome foil strips with adhesive gel. 20 sheets.',
    image: img('nail-foil-kit'), active: true, _demo: true,
  },
];

export async function seedProducts(onProgress) {
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    onProgress?.(`Adding ${i + 1}/${PRODUCTS.length}: ${p.name}`);
    await createProduct(p);
  }
  onProgress?.(`Done! Added ${PRODUCTS.length} products.`);
  return PRODUCTS.length;
}

export async function clearSeedProducts(onProgress) {
  onProgress?.('Fetching products…');
  const all = await fetchProducts();
  const demo = all.filter(p => p._demo === true);
  onProgress?.(`Removing ${demo.length} demo products…`);
  for (const p of demo) {
    await purgeProduct(p.id);
  }
  return demo.length;
}
