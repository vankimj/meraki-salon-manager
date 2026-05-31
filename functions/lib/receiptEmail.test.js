import { describe, it, expect } from 'vitest';
import { buildRatingEmailBlock } from './receiptEmail.js';

const TOKEN  = 'AbcDef123456789012';
const BASE   = 'https://meraki.plumenexus.com';
const TECH   = 'Yasmin';

describe('buildRatingEmailBlock', () => {
  describe('fallback path (missing viewToken or baseUrl)', () => {
    it('renders Google CTA when fallbackGoogleUrl is present', () => {
      const html = buildRatingEmailBlock({
        viewToken: null, baseUrl: BASE,
        fallbackGoogleUrl: 'https://g.page/r/abc/review',
      });
      expect(html).toContain('Leave us a Google Review');
      expect(html).toContain('https://g.page/r/abc/review');
    });

    it('strips dangerous URLs in fallback (javascript: only http(s) allowed)', () => {
      const html = buildRatingEmailBlock({
        viewToken: null, baseUrl: BASE,
        fallbackGoogleUrl: 'javascript:alert(1)',
      });
      expect(html).not.toContain('javascript:');
      expect(html).toContain('We loved having you');
    });

    it('renders friendly thank-you when no fallback URL either', () => {
      const html = buildRatingEmailBlock({ viewToken: null, baseUrl: null });
      expect(html).toContain('We loved having you');
      expect(html).not.toContain('Leave us');
    });
  });

  describe('inline_stars style', () => {
    it('emits one 5-star row per tech with prefilled rating URLs', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'Gel', techName: 'Yasmin' }, { name: 'Pedi', techName: 'Tess' }],
        style: 'inline_stars',
      });
      // Per-tech section
      expect(html).toContain('How was Yasmin?');
      expect(html).toContain('How was Tess?');
      // 5 prefilled links per tech = 10 total
      const linkMatches = html.match(/href="[^"]*rate=\d+/g) || [];
      expect(linkMatches.length).toBe(10);
      // Each star has src=email + correct token (URLs are HTML-escaped in the attr).
      expect(html).toContain(`/r/${TOKEN}?rate=1&amp;tech=Yasmin&amp;src=email`);
      expect(html).toContain(`/r/${TOKEN}?rate=5&amp;tech=Tess&amp;src=email`);
    });

    it('does not emit the standalone button', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE, services: [{ name: 'X', techName: TECH }],
        style: 'inline_stars',
      });
      expect(html).not.toContain('Rate your visit');
    });

    it('falls back to techName string when services have no techName', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X' }],
        techName: 'Yasmin, Audriana',
        style: 'inline_stars',
      });
      expect(html).toContain('How was Yasmin?');
      expect(html).toContain('How was Audriana?');
    });

    it('falls back to "Your technician" when no tech info at all', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE, services: [], techName: '',
        style: 'inline_stars',
      });
      expect(html).toContain('How was Your technician?');
    });
  });

  describe('single_button style', () => {
    it('emits one Rate-your-visit button, no per-tech rows', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X', techName: TECH }],
        style: 'single_button',
      });
      expect(html).toContain('Rate your visit');
      expect(html).not.toContain('How was');
      // No prefilled-rating links
      expect(html).not.toContain('rate=');
    });
  });

  describe('both style (default)', () => {
    it('emits stars AND button', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X', techName: TECH }],
        style: 'both',
      });
      expect(html).toContain('How was Yasmin?');
      expect(html).toContain('Rate your visit');
    });

    it('is the default when style is undefined or unknown', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X', techName: TECH }],
      });
      expect(html).toContain('How was Yasmin?');
      expect(html).toContain('Rate your visit');
    });
  });

  describe('XSS hardening', () => {
    it('escapes tech names that contain quote/angle characters', () => {
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X', techName: '<script>alert(1)</script>' }],
        style: 'inline_stars',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('safely embeds tech names with apostrophes in URLs (HTML-escaped)', () => {
      // encodeURIComponent leaves "'" untouched (it's an unreserved RFC 3986 char),
      // but the HTML attribute escaper still HTML-encodes it to &#39; so the URL
      // is safe to embed in href="…". Browsers normalize it back to "'" on click.
      const html = buildRatingEmailBlock({
        viewToken: TOKEN, baseUrl: BASE,
        services: [{ name: 'X', techName: 'O\'Brien' }],
        style: 'inline_stars',
      });
      expect(html).toContain('tech=O&#39;Brien');
      // And the visible label is also HTML-escaped (not raw apostrophe in markup).
      expect(html).toContain('How was O&#39;Brien?');
    });
  });
});
