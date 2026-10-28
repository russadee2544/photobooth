// Certificates for the iPad screen (agent/remote-screen.mjs): a CA made on this PC, which the
// iPad trusts once, and an HTTPS certificate for this PC's names/IPs signed by it. Built with
// node:crypto only (the agent ships without npm packages): ECDSA P-256 + SHA-256, the server
// certificate valid for 800 days with serverAuth and subjectAltName, as iPadOS requires.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
export const SERVER_DAYS = 800;   // Apple: at most 825 days for TLS server certificates

// ---- minimal DER writer ------------------------------------------------------------------
function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, content) => tlv(0xa0 + n, content);   // [n] EXPLICIT
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octets = (buf) => tlv(0x04, buf);
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
function integer(buf) {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}
// BIT STRING with the minimal "unused bits" count (DER) for a one-byte flag set.
function flags(byte) {
  let unused = 0;
  while (unused < 7 && !(byte & (1 << unused))) unused++;
  return tlv(0x03, Buffer.from([unused, byte]));
}
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
function oid(text) {
  const [a, b, ...rest] = text.split('.').map(Number);
  const out = [40 * a + b];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let v = arc >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(date) {
  const p = (n) => String(n).padStart(2, '0');
  const t = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(t, 'ascii'));   // UTCTime (dates before 2050)
}

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2', commonName: '2.5.4.3', organization: '2.5.4.10',
  basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', subjectAltName: '2.5.29.17',
  subjectKeyId: '2.5.29.14', authorityKeyId: '2.5.29.35', serverAuth: '1.3.6.1.5.5.7.3.1',
};
const caName = (label) => `${label} (Photobooth CA)`;
const name = (cn) => seq(set(seq(oid(OID.organization), utf8('MEMORIES Photobooth'))), set(seq(oid(OID.commonName), utf8(cn))));
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const keyId = (spki) => createHash('sha1').update(spki).digest();

function certificate({ subject, issuer, spki, signingKey, days, extensions }) {
  const now = Date.now();
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),                       // v3
    integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
    seq(oid(OID.ecdsaSha256)),
    issuer, seq(time(new Date(now - DAY)), time(new Date(now + days * DAY))), subject,
    spki,
    ctx(3, seq(...extensions)),
  );
  const signature = sign('sha256', tbs, signingKey);           // DER ECDSA signature
  const der = seq(tbs, seq(oid(OID.ecdsaSha256)), bits(signature));
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

const newKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = (key) => key.export({ type: 'pkcs8', format: 'pem' });
const spkiOf = (publicKey) => publicKey.export({ type: 'spki', format: 'der' });

// The PC's own CA (10 years). Returns PEM strings.
export function createCa(label) {
  const { publicKey, privateKey } = newKey();
  const spki = spkiOf(publicKey);
  const subject = name(caName(label));
  const cert = certificate({
    subject, issuer: subject, spki, signingKey: privateKey, days: 3650,
    extensions: [
      extension(OID.basicConstraints, true, seq(bool(true))),
      extension(OID.keyUsage, true, flags(0x86)),               // digitalSignature, keyCertSign, cRLSign
      extension(OID.subjectKeyId, false, octets(keyId(spki))),
    ],
  });
  return { certPem: cert, keyPem: pem(privateKey) };
}

// HTTPS certificate for `dnsNames` / `ips`, signed by the CA made by createCa(caLabel).
export function issueServerCert({ caKeyPem, caLabel, dnsNames, ips }) {
  const { publicKey, privateKey } = newKey();
  const spki = spkiOf(publicKey);
  const caSpki = spkiOf(createPublicKey(createPrivateKey(caKeyPem)));
  const san = seq(
    ...dnsNames.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  );
  const cert = certificate({
    subject: name(dnsNames[0] || ips[0]), issuer: name(caName(caLabel)), spki, signingKey: caKeyPem, days: SERVER_DAYS,
    extensions: [
      extension(OID.basicConstraints, true, seq()),
      extension(OID.keyUsage, true, flags(0x80)),               // digitalSignature
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, san),
      extension(OID.subjectKeyId, false, octets(keyId(spki))),
      extension(OID.authorityKeyId, false, seq(tlv(0x80, keyId(caSpki)))),
    ],
  });
  return { certPem: cert, keyPem: pem(privateKey) };
}

// DER bytes of a PEM certificate (what the iPad downloads as ca.cer).
export const derOf = (certPem) => Buffer.from(certPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
