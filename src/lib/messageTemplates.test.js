import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEMPLATES as WEB_DEFAULTS, TEMPLATE_GROUPS, renderMessage, segmentInfo,
  sampleVarsFor, PREVIEW_BRAND,
} from './messageTemplates.js';
import { DEFAULT_TEMPLATES as SERVER_DEFAULTS } from '../../functions/lib/messageTemplates.js';

describe('web mirror', () => {
  it('shares the SAME defaults the server renders from (no drift)', () => {
    expect(WEB_DEFAULTS).toBe(SERVER_DEFAULTS);
    expect(Object.keys(WEB_DEFAULTS).length).toBeGreaterThan(10);
  });

  it('renders every template with sample data for the editor preview', () => {
    for (const key of Object.keys(WEB_DEFAULTS)) {
      const def = WEB_DEFAULTS[key];
      const out = renderMessage(key, sampleVarsFor(def), PREVIEW_BRAND);
      if (def.channel === 'email') {
        expect(out.html).toContain('<!DOCTYPE html>');
        expect(out.subject.length).toBeGreaterThan(0);
        // sample data should not leak raw {placeholders} into the preview
        expect(out.html).not.toMatch(/\{[a-z][a-zA-Z]+\}/);
      } else {
        expect(out.body.length).toBeGreaterThan(0);
        expect(out.body).not.toMatch(/\{[a-z][a-zA-Z]+\}/);
      }
    }
  });

  it('every group has at least one template', () => {
    for (const g of TEMPLATE_GROUPS) {
      expect(Object.values(WEB_DEFAULTS).some(d => d.group === g.key)).toBe(true);
    }
  });

  it('segmentInfo is callable from the web side', () => {
    expect(segmentInfo('hello').segments).toBe(1);
  });
});
