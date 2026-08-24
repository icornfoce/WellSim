/**
 * WellSim — Confirmation dialog (UI v3 "Instrument")
 *
 * Replaces `window.confirm()`. The native dialog was wrong here on
 * three counts: it renders in the OS language and ignores the app's
 * TH/EN toggle, it strips every bit of the design system, and it puts
 * "OK" — a neutral word — on the button that permanently deletes a
 * patient record.
 *
 * The promise-based API keeps call sites shaped the way they already
 * were:
 *
 *   if (!(await confirm({ title, body, confirmLabel, tone: 'danger' }))) return;
 *
 * For a destructive action, focus opens on Cancel and the confirm
 * button carries the risk colour and a verb ("Delete"), never "OK".
 */

'use client';

import { createContext, useContext, useCallback, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Dialog from './Dialog';
import { useLang } from '../../i18n/LanguageContext';

const ConfirmContext = createContext({ confirm: async () => false });

export function ConfirmProvider({ children }) {
  const { t } = useLang();
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest(options);
    });
  }, []);

  const settle = useCallback((answer) => {
    setRequest(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(answer);
  }, []);

  const danger = request?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog
        open={!!request}
        onClose={() => settle(false)}
        size="md"
        labelledBy="confirm-dialog-title"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            {danger && (
              <span className="w-7 h-7 rounded shrink-0 flex items-center justify-center
                               bg-risk-high/[0.08] dark:bg-risk-highd/[0.12]">
                <AlertTriangle className="w-3.5 h-3.5 text-risk-high dark:text-risk-highd" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <h2
                id="confirm-dialog-title"
                className="text-base font-medium tracking-tight text-ink dark:text-chalk"
              >
                {request?.title || t('confirm.defaultTitle')}
              </h2>
              {request?.body && <p className="prose-clinical mt-2">{request.body}</p>}
              {request?.detail && <p className="note mt-2">{request.detail}</p>}
            </div>
          </div>

          {/* Stacked on a phone so the destructive button is never the
              one your thumb rests on; confirm sits last on desktop. */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => settle(false)}
              className="btn-line sm:min-w-[6rem]"
              data-autofocus={danger ? '' : undefined}
            >
              {request?.cancelLabel || t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              data-autofocus={danger ? undefined : ''}
              className={
                danger
                  ? `inline-flex items-center justify-center gap-1.5 px-4 py-2 sm:min-w-[6rem]
                     text-xs font-semibold rounded text-white
                     bg-risk-high hover:bg-risk-high/90
                     dark:bg-risk-highd dark:text-coal-950 dark:hover:bg-risk-highd/90
                     transition-colors duration-200 active:translate-y-px`
                  : 'btn-ink sm:min-w-[6rem]'
              }
            >
              {request?.confirmLabel || t('common.confirm')}
            </button>
          </div>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext).confirm;
