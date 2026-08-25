/**
 * WellSim — Dialog shell (UI v3 "Instrument")
 *
 * The accessible container every modal in the app sits inside. It is
 * deliberately unstyled beyond the frame: what goes in the panel is
 * the caller's business, what makes the panel behave like a dialog is
 * this file's.
 *
 * What it guarantees, none of which the hand-rolled modals had:
 *   · role="dialog" + aria-modal + a programmatic title
 *   · Escape closes
 *   · Tab is trapped inside the panel instead of walking the page behind
 *   · the page behind does not scroll (the phone bug: you scroll the
 *     modal to its end and the dashboard starts moving underneath)
 *   · focus lands in the panel on open and returns to the control that
 *     opened it on close
 *
 * `dismissible={false}` keeps a backdrop click or Escape from throwing
 * away a half-filled form.
 */

'use client';

import { useEffect, useRef, useId, useState } from 'react';

/**
 * Open dialogs, innermost last.
 *
 * Dialogs nest: the patient form asks a confirm dialog whether to
 * discard the draft. Both listen for Escape on the document, so
 * without this stack one press would answer the confirm *and* re-run
 * the form's close handler, which opens the confirm straight back up.
 * Only the dialog on top of the stack reacts.
 */
const openStack = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  size = 'lg',
  dismissible = true,
  className = '',
  children,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const tokenRef = useRef(null);
  const fallbackId = useId();
  const titleId = labelledBy || (label ? fallbackId : undefined);

  // Re-render on push/pop so `isTop` is current for the key handler.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!open) return;
    const token = {};
    tokenRef.current = token;
    openStack.push(token);
    bump((n) => n + 1);
    return () => {
      const i = openStack.indexOf(token);
      if (i !== -1) openStack.splice(i, 1);
      tokenRef.current = null;
      bump((n) => n + 1);
    };
  }, [open]);

  // Lock the page behind the dialog. Compensating for the scrollbar
  // width keeps the layout from jumping sideways on desktop.
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const gap = window.innerWidth - documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [open]);

  // Move focus in on open, hand it back to the opener on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector('[data-autofocus]') || panel?.querySelector(FOCUSABLE) || panel;
    // Wait a frame: the panel animates in, and Safari drops focus set
    // on a node that is still mid-transition.
    const id = requestAnimationFrame(() => first?.focus?.());
    return () => {
      cancelAnimationFrame(id);
      const back = restoreRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [open]);

  // Escape to close, Tab wrapped inside the panel — top dialog only.
  useEffect(() => {
    if (!open) return;
    const isTop = () =>
      openStack.length === 0 || openStack[openStack.length - 1] === tokenRef.current;
    const onKeyDown = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || [])
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  const width = size === 'sm' ? 'max-w-sm' : size === 'md' ? 'max-w-md' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center
                 sm:p-4 bg-ink/50 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the panel and
        // releases on the backdrop should not count as "clicked away".
        if (dismissible && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // Bottom sheet on a phone, centred card from `sm` up: reaching
        // the top of a centred dialog one-handed is the whole problem.
        className={`card w-full ${width} flex flex-col outline-none
                    max-h-[92dvh] rounded-b-none sm:rounded-md
                    sm:max-h-[90dvh] will-fade-up
                    !bg-surface dark:!bg-coal-900 ${className}`}
      >
        {label && !labelledBy && <span id={titleId} className="sr-only">{label}</span>}
        {children}
      </div>
    </div>
  );
}
