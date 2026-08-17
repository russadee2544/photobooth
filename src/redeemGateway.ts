import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { KioskConfig, RedeemClaim } from './domain/models';

export interface RedeemGateway {
  claim(code: string, config: KioskConfig): Promise<RedeemClaim>;
}

interface ClaimResponse {
  claim_id: string;
  code_hint: string;
  kiosk_id: string;
  package_id: string;
  claimed_at: string;
}

class EdgeFunctionRedeemGateway implements RedeemGateway {
  constructor(private readonly client: SupabaseClient) {}

  async claim(code: string, config: KioskConfig): Promise<RedeemClaim> {
    const deviceToken = await window.PhotoboothDevice?.getCredential();
    if (!deviceToken) throw new Error('ตู้นี้ยังไม่ได้ลงทะเบียนอุปกรณ์');
    const { data, error } = await this.client.functions.invoke<ClaimResponse>('redeem-claim', {
      body: { code, kioskId: config.kioskId, packageId: config.package.id, configVersion: 1 },
      headers: { 'x-kiosk-credential': deviceToken },
    });
    if (error) throw new Error('ไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาเรียกพนักงาน');
    if (!data?.claim_id || data.kiosk_id !== config.kioskId || data.package_id !== config.package.id) {
      throw new Error('ข้อมูลสิทธิ์ไม่ตรงกับตู้นี้');
    }
    return {
      claimId: data.claim_id,
      codeHint: data.code_hint,
      kioskId: data.kiosk_id,
      packageId: data.package_id,
      claimedAt: data.claimed_at,
    };
  }
}

declare global {
  interface Window {
    PhotoboothDevice?: { getCredential(): Promise<string | null> };
  }
}

class DemoRedeemGateway implements RedeemGateway {
  async claim(code: string, config: KioskConfig): Promise<RedeemClaim> {
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    if (code !== 'DE1010') throw new Error('โค้ดไม่ถูกต้องหรือถูกใช้งานแล้ว');
    return {
      claimId: crypto.randomUUID(),
      codeHint: 'DE••10',
      kioskId: config.kioskId,
      packageId: config.package.id,
      claimedAt: new Date().toISOString(),
    };
  }
}

class MissingConfigRedeemGateway implements RedeemGateway {
  async claim(): Promise<RedeemClaim> {
    throw new Error('ตู้นี้ยังไม่ได้เชื่อมต่อระบบ Redeem');
  }
}

export function createRedeemGateway(): RedeemGateway {
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && params.get('demo') === '1') return new DemoRedeemGateway();

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return new MissingConfigRedeemGateway();

  return new EdgeFunctionRedeemGateway(
    createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  );
}
