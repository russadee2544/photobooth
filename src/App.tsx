import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CameraCapture } from './CameraCapture';
import { t } from './copy';
import { INITIAL_KIOSK_STATE, kioskReducer, type KioskStep } from './domain/kioskMachine';
import type { FramePreset, KioskConfig, Locale, PrintJob } from './domain/models';
import { loadKioskConfig } from './kioskConfig';
import { createPrinterGateway } from './printerGateway';
import { createRedeemGateway } from './redeemGateway';

function useIdleSession(
  active: boolean,
  config: KioskConfig,
  onExpired: () => void,
): [boolean, () => void] {
  const [warning, setWarning] = useState(false);
  const warningTimer = useRef<number | undefined>(undefined);
  const expiryTimer = useRef<number | undefined>(undefined);

  const reset = useCallback(() => {
    window.clearTimeout(warningTimer.current);
    window.clearTimeout(expiryTimer.current);
    setWarning(false);
    if (!active) return;
    warningTimer.current = window.setTimeout(
      () => setWarning(true),
      Math.max(0, config.idleTimeoutMs - config.idleWarningMs),
    );
    expiryTimer.current = window.setTimeout(onExpired, config.idleTimeoutMs);
  }, [active, config.idleTimeoutMs, config.idleWarningMs, onExpired]);

  useEffect(() => {
    const activity = () => reset();
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown'];
    events.forEach((event) => document.addEventListener(event, activity, { passive: true }));
    reset();
    return () => {
      events.forEach((event) => document.removeEventListener(event, activity));
      window.clearTimeout(warningTimer.current);
      window.clearTimeout(expiryTimer.current);
    };
  }, [reset]);

  return [warning, reset];
}

function ReceiptPreview({ state, compact = false }: { state: ReturnType<typeof kioskReducer>; compact?: boolean }) {
  const accent = state.frame?.accent ?? '#f2efe8';
  return (
    <div className={`receipt-preview ${compact ? 'receipt-preview--compact' : ''}`} style={{ '--frame-accent': accent } as React.CSSProperties}>
      <div className="receipt-brand">MEMORIES</div>
      <div className={`photo-grid photo-grid--${state.photos.length || 1} ${state.filter === 'mono' ? 'is-mono' : ''}`}>
        {state.photos.map((photo, index) => (
          <img key={photo.id} src={photo.dataUrl} alt={`Captured ${index + 1}`} />
        ))}
      </div>
      <div className="receipt-meta">
        <span>{state.frame?.nameEn ?? 'FRAME'}</span>
        <span>{new Date().toLocaleDateString('th-TH')}</span>
      </div>
      <div className="receipt-tear" aria-hidden="true" />
    </div>
  );
}

function Header({ config, locale, onLocale }: { config: KioskConfig; locale: Locale; onLocale: (locale: Locale) => void }) {
  return (
    <header className="kiosk-header">
      <div>
        <div className="eyebrow">RECEIPT BOOTH</div>
        <strong>{config.kioskName}</strong>
      </div>
      <div className="language-switch" aria-label="Language">
        <button className={locale === 'th' ? 'active' : ''} onClick={() => onLocale('th')} type="button">TH</button>
        <button className={locale === 'en' ? 'active' : ''} onClick={() => onLocale('en')} type="button">EN</button>
      </div>
    </header>
  );
}

export default function App() {
  const config = useMemo(loadKioskConfig, []);
  const [locale, setLocale] = useState<Locale>(config.locale);
  const [state, dispatch] = useReducer(kioskReducer, INITIAL_KIOSK_STATE);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const redeemGateway = useMemo(createRedeemGateway, []);
  const printerGateway = useMemo(createPrinterGateway, []);

  const resetSession = useCallback(() => {
    setRedeemCode('');
    setRedeemError(null);
    dispatch({ type: 'RESET' });
  }, []);
  const idleActive = !['attract', 'printing', 'complete'].includes(state.step);
  const [idleWarning, keepAlive] = useIdleSession(idleActive, config, resetSession);

  const submitRedeem = async (event: FormEvent) => {
    event.preventDefault();
    const code = redeemCode.trim().toUpperCase();
    if (!/^[A-Z]{2}[0-9]{4}$/.test(code)) {
      setRedeemError(t(locale, 'codeHint'));
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    try {
      const claim = await redeemGateway.claim(code, config);
      dispatch({ type: 'CODE_ACCEPTED', claim });
    } catch (error) {
      setRedeemError(error instanceof Error ? error.message : 'Redeem failed');
    } finally {
      setRedeeming(false);
    }
  };

  const confirmPrint = async () => {
    const job: PrintJob = {
      id: crypto.randomUUID(), copiesRequested: 2, copiesCompleted: 0, status: 'queued',
    };
    dispatch({ type: 'CONFIRM_PRINT', job });
    try {
      await printerGateway.printSet(job, (copiesCompleted) => {
        dispatch({ type: 'PRINT_PROGRESS', copiesCompleted });
      });
      dispatch({ type: 'PRINT_COMPLETED' });
    } catch (error) {
      dispatch({
        type: 'PRINT_FAILED',
        error: error instanceof Error ? error.message : 'Printer failed',
        ambiguous: true,
      });
    }
  };

  return (
    <main className="kiosk-app">
      <Header config={config} locale={locale} onLocale={setLocale} />
      <section className="screen" aria-live="polite">
        {state.step === 'attract' && (
          <div className="attract-view">
            <div className="ticket-mark" aria-hidden="true">M</div>
            <div className="eyebrow">{config.mode === 'event' ? t(locale, 'eventReady') : t(locale, 'redeemReady')}</div>
            <h1>Keep the moment.<br />Print the feeling.</h1>
            <p>{config.package.priceThb} THB · 1 SET · {config.package.copiesPerSet} PRINTS</p>
            <button className="primary-action" type="button" onClick={() => dispatch({ type: 'START', config })}>
              {t(locale, 'start')} <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {state.step === 'redeem' && (
          <div className="narrow-view">
            <div className="step-number">01</div>
            <h1>{t(locale, 'codeLabel')}</h1>
            <p>{t(locale, 'codeHint')}</p>
            <form className="redeem-form" onSubmit={submitRedeem}>
              <input
                autoFocus value={redeemCode} maxLength={6} inputMode="text" autoComplete="off"
                onChange={(event) => setRedeemCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="AB1234" aria-label={t(locale, 'codeLabel')}
              />
              {redeemError && <div className="form-error">{redeemError}</div>}
              <button className="primary-action" disabled={redeeming || redeemCode.length !== 6}>
                {redeeming ? '…' : t(locale, 'continue')}
              </button>
            </form>
          </div>
        )}

        {state.step === 'layout' && (
          <div className="selection-view">
            <div className="step-number">02</div>
            <h1>{t(locale, 'chooseLayout')}</h1>
            <div className="layout-list">
              {config.layouts.filter((layout) => layout.enabled).map((layout) => (
                <button key={layout.id} type="button" className="layout-card" onClick={() => dispatch({ type: 'SELECT_LAYOUT', layout })}>
                  <div className={`layout-icon layout-icon--${layout.slots}`}>
                    {Array.from({ length: layout.slots }, (_, index) => <span key={index} />)}
                  </div>
                  <strong>{locale === 'th' ? layout.nameTh : layout.nameEn}</strong>
                  <small>{layout.slots} SHOT{layout.slots > 1 ? 'S' : ''}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {state.step === 'capture' && state.layout && (
          <div className="capture-view">
            <div className="screen-title"><span className="step-number">03</span><h1>{t(locale, 'capture')}</h1></div>
            <CameraCapture
              capturedCount={state.photos.length}
              requiredCount={state.layout.slots}
              captureLabel={state.photos.length + 1 === state.layout.slots ? t(locale, 'capture') : t(locale, 'nextShot')}
              onCapture={(photo) => dispatch({ type: 'ADD_PHOTO', photo })}
            />
          </div>
        )}

        {state.step === 'customize' && (
          <div className="customize-view">
            <div className="screen-title"><span className="step-number">04</span><h1>{t(locale, 'chooseFrame')}</h1></div>
            <div className="customize-grid">
              <ReceiptPreview state={state} compact />
              <div className="customize-controls">
                <div className="frame-list">
                  {config.frames.filter((frame) => frame.enabled).map((frame) => (
                    <FrameButton key={frame.id} frame={frame} locale={locale} selected={state.frame?.id === frame.id} onSelect={() => dispatch({ type: 'SELECT_FRAME', frame })} />
                  ))}
                </div>
                <div className="segmented-control">
                  <button className={state.filter === 'color' ? 'active' : ''} onClick={() => dispatch({ type: 'SELECT_FILTER', filter: 'color' })}>{t(locale, 'color')}</button>
                  <button className={state.filter === 'mono' ? 'active' : ''} onClick={() => dispatch({ type: 'SELECT_FILTER', filter: 'mono' })}>{t(locale, 'mono')}</button>
                </div>
                <button className="primary-action" type="button" disabled={!state.frame} onClick={() => dispatch({ type: 'REVIEW' })}>{t(locale, 'continue')} →</button>
                <button className="text-action" type="button" onClick={() => dispatch({ type: 'RETAKE_ALL' })}>{t(locale, 'retake')}</button>
              </div>
            </div>
          </div>
        )}

        {state.step === 'review' && (
          <div className="review-view">
            <div><div className="step-number">05</div><h1>{t(locale, 'review')}</h1><p>1 SET · 2 PRINTS · {config.package.priceThb} THB</p></div>
            <ReceiptPreview state={state} />
            <div className="review-actions">
              <button className="primary-action" type="button" onClick={() => void confirmPrint()}>{t(locale, 'confirmPrint')}</button>
              <button className="text-action" type="button" onClick={() => dispatch({ type: 'RETAKE_ALL' })}>{t(locale, 'retake')}</button>
            </div>
          </div>
        )}

        {state.step === 'printing' && (
          <div className="status-view">
            <div className="print-animation" aria-hidden="true"><div className="paper" /></div>
            <h1>{t(locale, 'printing')} {state.printJob?.copiesCompleted ?? 0}/2</h1>
            <p>กรุณารอจนกว่ากระดาษจะออกครบทั้งสองใบ</p>
            <div className="progress"><span style={{ width: `${((state.printJob?.copiesCompleted ?? 0) / 2) * 100}%` }} /></div>
            {state.printJob?.status === 'ambiguous' && <div className="operator-alert">ไม่สามารถยืนยันผลการพิมพ์ได้ กรุณาเรียก Admin — ระบบจะไม่พิมพ์ซ้ำอัตโนมัติ</div>}
          </div>
        )}

        {state.step === 'complete' && (
          <div className="status-view">
            <div className="success-mark">✓</div>
            <h1>{t(locale, 'complete')}</h1>
            <p>รับภาพจากช่องเครื่องพิมพ์ได้เลย</p>
            <button className="primary-action" type="button" onClick={resetSession}>{t(locale, 'finish')}</button>
          </div>
        )}
      </section>

      <footer className="kiosk-footer">
        <span>{config.mode.toUpperCase()} MODE</span><span>·</span><span>RECEIPT / 80MM</span>
      </footer>

      {idleWarning && <button className="idle-overlay" type="button" onClick={keepAlive}><span><strong>{t(locale, 'idleTitle')}</strong><small>{t(locale, 'idleBody')}</small></span></button>}
    </main>
  );
}

function FrameButton({ frame, locale, selected, onSelect }: { frame: FramePreset; locale: Locale; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`frame-button ${selected ? 'active' : ''}`} onClick={onSelect}>
      <span style={{ background: frame.accent }} /><strong>{locale === 'th' ? frame.nameTh : frame.nameEn}</strong>
    </button>
  );
}

export function isCustomerSessionStep(step: KioskStep): boolean {
  return !['attract', 'complete'].includes(step);
}
