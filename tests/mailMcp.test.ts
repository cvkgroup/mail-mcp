import { describe, expect, it } from 'vitest';
import { MailMcp } from '../src/mailMcp.js';

describe('MailMcp', () => {
  it('registers root and child agents', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    expect(mail.pollInbox('root')).toEqual([]);
    expect(mail.pollInbox('child')).toEqual([]);
  });

  it('rejects duplicate agents', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');

    expect(() => mail.registerAgent('root')).toThrow('Agent already exists: root');
  });

  it('rejects unknown parent agent', () => {
    const mail = new MailMcp();

    expect(() => mail.registerAgent('child', 'missing')).toThrow('Parent agent does not exist: missing');
  });

  it('delivers messages within one hierarchy', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    const messageId = mail.sendMessage('root', 'child', 'hello child');
    const inbox = mail.pollInbox('child');

    expect(messageId).toBe('msg-1');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      id: 'msg-1',
      from: 'root',
      to: 'child',
      body: 'hello child',
      attempts: 1,
      requiresAck: true,
      acknowledged: false
    });
  });

  it('rejects cross-hierarchy messages', () => {
    const mail = new MailMcp();
    mail.registerAgent('root-a');
    mail.registerAgent('root-b');

    expect(() => mail.sendMessage('root-a', 'root-b', 'forbidden')).toThrow(
      'Cross-hierarchy delivery is not allowed: root-a -> root-b'
    );
  });

  it('tracks pending acknowledgements and clears them on ack', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    const messageId = mail.sendMessage('root', 'child', 'ack me');
    expect(mail.getPendingAcknowledgements('root')).toHaveLength(1);

    mail.acknowledge('child', messageId);
    expect(mail.getPendingAcknowledgements('root')).toEqual([]);
  });

  it('only allows the recipient to acknowledge a message', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    const messageId = mail.sendMessage('root', 'child', 'ack me');

    expect(() => mail.acknowledge('root', messageId)).toThrow('Only recipient child can acknowledge msg-1');
  });

  it('retries unacknowledged messages and increments attempt count', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    mail.sendMessage('root', 'child', 'ack me');
    const retried = mail.retryUnacknowledged('root');

    expect(retried).toBe(1);
    const inbox = mail.pollInbox('child');
    expect(inbox).toHaveLength(2);
    expect(inbox[1].attempts).toBe(2);
  });

  it('does not track non-ack messages as pending', () => {
    const mail = new MailMcp();
    mail.registerAgent('root');
    mail.registerAgent('child', 'root');

    mail.sendMessage('root', 'child', 'fire and forget', false);
    expect(mail.getPendingAcknowledgements('root')).toEqual([]);
  });
});
