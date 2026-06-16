import { describe, it, expect } from 'vitest';
import {
  feedbackIssueTitle, feedbackIssueLabels, feedbackIssueBody,
  issueStateForTicketStatus, ticketStatusForIssueState,
} from './feedback.js';

describe('feedbackIssueTitle', () => {
  it('uses the subject, capped at 120 chars', () => {
    expect(feedbackIssueTitle({ feedbackType: 'bug', subject: '🐛 Bug: Save does nothing' }))
      .toBe('🐛 Bug: Save does nothing');
    const long = 'x'.repeat(200);
    expect(feedbackIssueTitle({ feedbackType: 'idea', subject: long }).length).toBe(120);
  });
  it('falls back when subject is empty', () => {
    expect(feedbackIssueTitle({ feedbackType: 'bug', subject: '' })).toMatch(/Bug/);
    expect(feedbackIssueTitle({ feedbackType: 'idea', subject: null })).toMatch(/Idea/);
  });
});

describe('feedbackIssueLabels', () => {
  it('bug → bug+feedback, idea → feature+feedback', () => {
    expect(feedbackIssueLabels('bug')).toEqual(['bug', 'feedback']);
    expect(feedbackIssueLabels('idea')).toEqual(['feature', 'feedback']);
  });
});

describe('feedbackIssueBody', () => {
  it('includes the text, tenant, author, and ticket backlink', () => {
    const body = feedbackIssueBody({
      tenantName: 'Meraki Nail Studio', tenantId: 'merakinailstudio',
      authorEmail: 'tech@meraki.test', text: 'It would be great if...',
      ticketUrl: 'https://admin.plumenexus.com/t/merakinailstudio',
    });
    expect(body).toContain('It would be great if...');
    expect(body).toContain('Meraki Nail Studio');
    expect(body).toContain('tech@meraki.test');
    expect(body).toContain('`merakinailstudio`');
    expect(body).toContain('https://admin.plumenexus.com/t/merakinailstudio');
  });
  it('omits the ticket line when no url', () => {
    const body = feedbackIssueBody({ tenantName: 'X', tenantId: 'x', text: 'hi' });
    expect(body).not.toContain('**Ticket:**');
  });
});

describe('issueStateForTicketStatus', () => {
  it('maps ticket status → issue state', () => {
    expect(issueStateForTicketStatus('resolved')).toEqual({ state: 'closed', stateReason: 'completed' });
    expect(issueStateForTicketStatus('closed')).toEqual({ state: 'closed', stateReason: 'not_planned' });
    expect(issueStateForTicketStatus('open')).toEqual({ state: 'open', stateReason: null });
    expect(issueStateForTicketStatus('pending_owner')).toEqual({ state: 'open', stateReason: null });
    expect(issueStateForTicketStatus('weird')).toBeNull();
  });
});

describe('ticketStatusForIssueState', () => {
  it('closed completed → resolved, closed not_planned → closed', () => {
    expect(ticketStatusForIssueState({ state: 'closed', stateReason: 'completed' })).toBe('resolved');
    expect(ticketStatusForIssueState({ state: 'closed', stateReason: 'not_planned' })).toBe('closed');
    expect(ticketStatusForIssueState({ state: 'closed', stateReason: null })).toBe('resolved');
  });
  it('open issue → null (do not override the ticket)', () => {
    expect(ticketStatusForIssueState({ state: 'open', stateReason: null })).toBeNull();
  });
});

// Round-trip sanity: a ticket marked resolved closes the issue, and reading that
// closed issue back maps to resolved (idempotent — no status flapping).
describe('round-trip', () => {
  it('resolved → closed/completed → resolved', () => {
    const toIssue = issueStateForTicketStatus('resolved');
    expect(toIssue).toEqual({ state: 'closed', stateReason: 'completed' });
    expect(ticketStatusForIssueState(toIssue)).toBe('resolved');
  });
  it('closed → closed/not_planned → closed', () => {
    const toIssue = issueStateForTicketStatus('closed');
    expect(ticketStatusForIssueState(toIssue)).toBe('closed');
  });
});
