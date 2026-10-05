// Native-bridge core shared by the dev bridge (vite dev) and the Windows agent.
// It holds the device credential and admin capability in this process only; the
// browser gets a fixed set of methods and never a generic "call any function".
const ADMIN_SESSION_FALLBACK_MS = 15 * 60 * 1000;

export function createDeviceBridge({ supabaseUrl, publishableKey, credential, kioskId, packageId }) {
  let admin = { token: '', expiresAt: 0 };
  // passId -> raw code, as returned once by generatePass (memory only).
  const rawCodes = new Map();

  async function callFunction(fn, body, extraHeaders = {}) {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: publishableKey,
        'x-kiosk-credential': credential,
        ...extraHeaders,
      },
      body: JSON.stringify({ kioskId, ...body }),
    });
    return upstream.json().catch(() => ({ error: 'bad_upstream_response' }));
  }

  const adminValid = () => admin.token && admin.expiresAt > Date.now();
  const keepCapability = (result) => {
    if (result?.capabilityToken) {
      const expires = Date.parse(result.expiresAt);
      admin = { token: result.capabilityToken, expiresAt: Number.isFinite(expires) ? expires : Date.now() + ADMIN_SESSION_FALLBACK_MS };
    }
  };
  const withAdmin = (body) => (adminValid()
    ? callFunction('admin-redeem', body, { 'x-admin-capability': admin.token })
    : Promise.resolve({ success: false, error: 'admin_capability_required' }));

  const handlers = {
    listPassOffers: () => callFunction('payment-order', { operation: 'offers' }),
    createPaymentOrder: (a) => callFunction('payment-order', { operation: 'create', packageId: a.packageId, quotaKind: a.quotaKind }),
    getPaymentOrder: (a) => callFunction('payment-order', { operation: 'status', orderId: a.orderId }),
    cancelPaymentOrder: (a) => callFunction('payment-order', { operation: 'cancel', orderId: a.orderId }),
    claimPrintPass: (a) => callFunction('redeem-pass', { operation: 'claim', code: a.code, previousToken: a.previousToken ?? null }),
    touchPrintPass: (a) => callFunction('redeem-pass', { operation: 'touch', passId: a.passId, sessionToken: a.sessionToken }),
    reservePrintPass: (a) => callFunction('redeem-pass', {
      operation: 'reserve', passId: a.passId, sessionToken: a.sessionToken, jobId: a.jobId, assetSha256: a.assetSha256,
    }),
    pausePrintPass: (a) => callFunction('redeem-pass', { operation: 'pause', passId: a.passId, sessionToken: a.sessionToken }),
    issuePhotoUploadTicket: (a) => callFunction('session-photo', {
      operation: 'ticket', sessionId: a.sessionId, mode: a.mode, eventName: a.eventName ?? '', layout: a.layout ?? '',
    }),
    issueGifUploadTicket: (a) => callFunction('session-gif', {
      operation: 'ticket', sessionId: a.sessionId, mode: a.mode, passId: a.passId ?? null,
      sessionToken: a.sessionToken ?? null, packageId: a.packageId ?? null,
    }),

    adminPinStatus: async () => {
      const status = await callFunction('admin-pin', { operation: 'status' });
      return { ...status, authenticated: !!adminValid(), expiresAt: adminValid() ? admin.expiresAt : null };
    },
    adminEnrollPin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'enroll', pin: a.pin });
      keepCapability(result);
      return result.success ? { success: true, expiresAt: admin.expiresAt } : { success: false, error: result.error };
    },
    adminVerifyPin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'verify', pin: a.pin });
      if (!result.valid) return { valid: false, error: result.error, lockedUntil: result.lockedUntil ?? null };
      keepCapability(result);
      return { valid: true, expiresAt: admin.expiresAt };
    },
    adminChangePin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'change', currentPin: a.currentPin, nextPin: a.nextPin });
      if (result.success) admin = { token: '', expiresAt: 0 };
      return result.success ? { success: true } : { success: false, error: result.error };
    },
    adminLogout: async () => {
      admin = { token: '', expiresAt: 0 };
      return { success: true };
    },
    generatePrintPasses: async (a) => {
      const result = await withAdmin({
        operation: 'generatePass', packageId: a.packageId || packageId,
        count: a.count, expiresDays: a.expiresDays, quotaKind: a.quotaKind,
      });
      if (!result.success) return { success: false, codes: [], batchId: null, error: result.error };
      for (const row of result.codes ?? []) rawCodes.set(row.passId, row.code);
      return { success: true, codes: (result.codes ?? []).map((row) => row.code), batchId: null, expiresAt: result.expiresAt };
    },
    // Event photos: admin only (device credential + PIN capability, both held here).
    listEventPhotos: () => (adminValid()
      ? callFunction('event-photos', { operation: 'list' }, { 'x-admin-capability': admin.token })
      : Promise.resolve({ success: false, error: 'admin_capability_required' })),
    deleteEventPhotos: (a) => (adminValid()
      ? callFunction('event-photos', { operation: 'delete', ids: a.ids, reason: a.reason }, { 'x-admin-capability': admin.token })
      : Promise.resolve({ success: false, error: 'admin_capability_required' })),
    listPrintPasses: async () => {
      const result = await withAdmin({ operation: 'listPass' });
      if (!result.success) return { success: false, codes: [], error: result.error };
      return {
        success: true,
        codes: (result.codes ?? []).map((row) => ({
          ...row,
          id: row.pass_id,
          code: rawCodes.get(row.pass_id) ?? null,
          is_used: row.quota_kind !== 'unlimited' && row.print_limit != null && row.used_prints >= row.print_limit,
        })),
      };
    },
  };

  // `start` / `report` are internal: only the printer module may call them.
  const internal = {
    startPrint: (jobId, sessionToken) => callFunction('redeem-pass', { operation: 'start', jobId, sessionToken }),
    reportPrint: (jobId, result) => callFunction('redeem-pass', { operation: 'report', jobId, result }),
  };

  return { handlers, internal };
}

// Browser-side installer. `groups` maps a window global to its method names.
export function clientScript({ endpoint, kioskId, packageId, groups, header, statusEndpoint }) {
  return `(() => {
  const cfg = ${JSON.stringify({ kioskId, packageId })};
  try {
    if (localStorage.getItem('kiosk_id') !== cfg.kioskId) localStorage.setItem('kiosk_id', cfg.kioskId);
    if (cfg.packageId && !localStorage.getItem('kiosk_package_id')) localStorage.setItem('kiosk_package_id', cfg.packageId);
  } catch (_) {}
  const call = async (method, args) => {
    try {
      const res = await fetch(${JSON.stringify(endpoint)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ${JSON.stringify(header)}: '1' },
        body: JSON.stringify({ method, args: args || {} }),
      });
      return await res.json();
    } catch (e) {
      return { error: 'network_error' };
    }
  };
  const groups = ${JSON.stringify(groups)};
  // After a self-update the agent restarts with a new version: reload, but only on the welcome page.
  const statusEndpoint = ${JSON.stringify(statusEndpoint || '')};
  if (statusEndpoint) {
    let known = null;
    setInterval(async () => {
      try {
        const info = await (await fetch(statusEndpoint, { cache: 'no-store' })).json();
        if (!info.version) return;
        if (known && info.version !== known && /\\/(home\\.html)?$/.test(location.pathname)) location.reload();
        known = info.version;
      } catch (_) { /* agent restarting */ }
    }, 30000);
  }
  for (const [name, methods] of Object.entries(groups)) {
    const bridge = {};
    for (const m of methods) bridge[m] = (args) => call(m, args);
    window[name] = Object.freeze(bridge);
  }
})();`;
}
