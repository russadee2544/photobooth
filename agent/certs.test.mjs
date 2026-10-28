import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCa, derOf, issueServerCert, SERVER_DAYS } from './certs.mjs';

describe('certificates for the iPad screen', () => {
  const ca = createCa('booth-pc');
  const server = issueServerCert({ caKeyPem: ca.keyPem, caLabel: 'booth-pc', dnsNames: ['booth-pc.local', 'booth-pc'], ips: ['192.168.1.20'] });
  const caCert = new X509Certificate(ca.certPem);
  const cert = new X509Certificate(server.certPem);

  it('makes a self-signed CA', () => {
    expect(caCert.ca).toBe(true);
    expect(caCert.verify(caCert.publicKey)).toBe(true);
    expect(caCert.subject).toContain('CN=booth-pc (Photobooth CA)');
  });

  it('signs an HTTPS certificate for the PC name and IP', () => {
    expect(cert.ca).toBe(false);
    expect(cert.verify(caCert.publicKey)).toBe(true);
    expect(cert.checkIssued(caCert)).toBe(true);
    expect(cert.checkHost('booth-pc.local')).toBe('booth-pc.local');
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(cert.checkHost('evil.example')).toBeUndefined();
    expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
  });

  it('stays within the 825 days iPadOS accepts', () => {
    const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86400000;
    expect(days).toBeLessThanOrEqual(825);
    expect(days).toBeGreaterThanOrEqual(SERVER_DAYS);
  });

  it('pairs the private key with the certificate', () => {
    const pub = createPublicKey(createPrivateKey(server.keyPem)).export({ type: 'spki', format: 'der' });
    expect(cert.publicKey.export({ type: 'spki', format: 'der' }).equals(pub)).toBe(true);
  });

  it('exports the CA as DER for the iPad download', () => {
    expect(new X509Certificate(derOf(ca.certPem)).fingerprint256).toBe(caCert.fingerprint256);
  });
});
