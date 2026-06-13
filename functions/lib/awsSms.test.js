import { describe, it, expect, vi } from 'vitest';
import { sendViaAwsSms } from './awsSms.js';

// A fake AWS client that records the command it was sent and returns a
// canned MessageId — lets us assert the request shape + response mapping
// without touching the network or needing real credentials.
function fakeClient(messageId = 'mid-abc123') {
  const sent = [];
  return {
    sent,
    send: vi.fn(async (cmd) => {
      sent.push(cmd);
      return { MessageId: messageId };
    }),
  };
}

describe('sendViaAwsSms', () => {
  it('maps a successful send to { ok, messageId }', async () => {
    const client = fakeClient('mid-xyz');
    const res = await sendViaAwsSms({
      to: '+16145551234',
      body: 'Meraki: see you tomorrow at 2pm. Reply STOP to opt out.',
      originationNumber: '+18885550000',
      client,
    });
    expect(res).toEqual({ ok: true, messageId: 'mid-xyz' });
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('passes the right fields to SendTextMessageCommand', async () => {
    const client = fakeClient();
    await sendViaAwsSms({
      to: '+16145551234',
      body: 'hello',
      originationNumber: '+18885550000',
      client,
    });
    const input = client.sent[0].input;
    expect(input.DestinationPhoneNumber).toBe('+16145551234');
    expect(input.OriginationIdentity).toBe('+18885550000');
    expect(input.MessageBody).toBe('hello');
    expect(input.MessageType).toBe('TRANSACTIONAL');
  });

  it('marks marketing sends PROMOTIONAL', async () => {
    const client = fakeClient();
    await sendViaAwsSms({
      to: '+16145551234', body: 'sale', originationNumber: '+18885550000',
      messageType: 'PROMOTIONAL', client,
    });
    expect(client.sent[0].input.MessageType).toBe('PROMOTIONAL');
  });

  it('rejects missing to/body without calling the client', async () => {
    const client = fakeClient();
    expect(await sendViaAwsSms({ body: 'x', originationNumber: '+1', client })).toEqual({ ok: false, error: 'missing_to_or_body' });
    expect(await sendViaAwsSms({ to: '+1', originationNumber: '+1', client })).toEqual({ ok: false, error: 'missing_to_or_body' });
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects a missing origination number', async () => {
    const res = await sendViaAwsSms({ to: '+16145551234', body: 'hi', client: fakeClient() });
    expect(res).toEqual({ ok: false, error: 'aws_sms_no_origination' });
  });

  it('fails closed when no client and no creds are supplied', async () => {
    const res = await sendViaAwsSms({ to: '+16145551234', body: 'hi', originationNumber: '+18885550000' });
    expect(res).toEqual({ ok: false, error: 'aws_sms_not_configured' });
  });

  it('returns a tagged error instead of throwing when the send fails', async () => {
    const client = { send: vi.fn(async () => { throw new Error('Throttled'); }) };
    const res = await sendViaAwsSms({
      to: '+16145551234', body: 'hi', originationNumber: '+18885550000', client,
    });
    expect(res).toEqual({ ok: false, error: 'Throttled' });
  });
});
