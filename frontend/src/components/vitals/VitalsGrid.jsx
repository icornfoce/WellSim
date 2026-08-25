/**
 * WellSim — The vitals table.
 *
 * One source of truth for the reference bands and for which direction
 * counts as abnormal. Those thresholds used to be written out three
 * times: once per cell in the clinician dashboard, again in the
 * dashboard's "N abnormal" chip, and a third time in the patient
 * portal's `vitalRows`. Three copies of a clinical threshold is a
 * standing invitation for the doctor's screen and the patient's screen
 * to disagree about whether a reading is normal.
 *
 * The grid renders read-only by default and becomes a form when
 * `isEditing` is set — the portal only ever needs the former.
 */

'use client';

import TickBar from '../ui/TickBar';

/** A reading is "measured" only if it actually holds a value. */
export const hasValue = (x) => x !== null && x !== undefined && x !== '';

export const VITAL_SPECS = [
  {
    key: 'spo2', labelKey: 'vitals.spo2', unit: '%', ref: '95–100',
    band: { min: 85, max: 100, okMin: 95, okMax: 100 },
    abnormal: (x) => x < 95, dir: 'low', tone: 'bad',
  },
  {
    key: 'heartRate', labelKey: 'vitals.hr', unit: 'bpm', ref: '60–100',
    band: { min: 40, max: 140, okMin: 60, okMax: 100 },
    abnormal: (x) => x > 100, dir: 'high', tone: 'bad',
  },
  {
    key: 'systolicBP', pairKey: 'diastolicBP', labelKey: 'vitals.bp', unit: 'mmHg', ref: '<120/80',
    band: { min: 80, max: 180, okMin: 90, okMax: 120 },
    abnormal: (x) => x > 140, dir: 'high', tone: 'warn',
  },
  {
    key: 'wbc', labelKey: 'vitals.wbc', unit: '/mcL', ref: '4,500–11,000',
    band: { min: 2000, max: 20000, okMin: 4500, okMax: 11000 },
    abnormal: (x) => x > 11000, dir: 'high', tone: 'warn',
    format: (x) => x.toLocaleString(),
  },
  {
    key: 'hemoglobin', labelKey: 'vitals.hgb', unit: 'g/dL', ref: '12.0–17.5',
    band: { min: 8, max: 20, okMin: 12, okMax: 17.5 },
    abnormal: (x) => x < 12, dir: 'low', tone: 'warn',
    decimal: true,
  },
];

/** Is this one reading outside its reference band? */
export function isAbnormal(spec, vitals) {
  const value = vitals?.[spec.key];
  return hasValue(value) && spec.abnormal(Number(value));
}

/**
 * How many readings exist, and how many of them are out of range.
 * Both screens summarise this above the table; they should never
 * arrive at different totals for the same patient.
 */
export function summariseVitals(vitals) {
  let measured = 0;
  let abnormal = 0;
  for (const spec of VITAL_SPECS) {
    if (!hasValue(vitals?.[spec.key])) continue;
    measured += 1;
    if (isAbnormal(spec, vitals)) abnormal += 1;
  }
  return { measured, abnormal };
}

export function VitalCell({
  spec,
  vitals,
  isEditing = false,
  edited,
  onEdit,
  t,
  idPrefix = 'vitals',
}) {
  const value = vitals?.[spec.key];
  const pairValue = spec.pairKey ? vitals?.[spec.pairKey] : undefined;
  const out = isAbnormal(spec, vitals);
  const toneText = spec.tone === 'bad'
    ? 'text-risk-high dark:text-risk-highd'
    : 'text-risk-mod dark:text-risk-modd';
  const toneBar = spec.tone === 'bad'
    ? 'bg-risk-high dark:bg-risk-highd'
    : 'bg-risk-mod dark:bg-risk-modd';
  const inputId = `${idPrefix}-${spec.key}`;
  const pairId = spec.pairKey ? `${idPrefix}-${spec.pairKey}` : undefined;

  // Keep what the user typed as typed. Coercing every keystroke to a
  // number meant an emptied field became 0 — and a saved SpO2 of 0 is
  // not a blank, it is a reading that says the patient is not
  // breathing. The caller drops empty fields before sending.
  const onType = (key) => (e) => {
    const raw = e.target.value.replace(/[-eE]/g, '');
    onEdit((prev) => ({ ...prev, [key]: raw }));
  };
  const blockNegative = (e) => {
    if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };

  const numberInput = (key, id) => (
    <input
      id={id}
      name={key}
      type="number"
      inputMode={spec.decimal ? 'decimal' : 'numeric'}
      step={spec.decimal ? '0.1' : undefined}
      min="0"
      onKeyDown={blockNegative}
      value={edited?.[key] ?? ''}
      onChange={onType(key)}
      className="field !text-lg !font-light tabular-nums"
    />
  );

  return (
    <div className="relative bg-surface dark:bg-coal-900 p-4">
      {/* A rule across the top of any cell that is out of range: the
          table is scanned before it is read, and colour alone is not a
          reliable signal on a clinic monitor. */}
      {out && <span className={`absolute top-0 left-0 right-0 h-[2px] ${toneBar}`} aria-hidden="true" />}

      <div className="flex justify-between items-baseline gap-2">
        <label htmlFor={inputId} className="microlabel">{t(spec.labelKey)}</label>
        {out && (
          <span className={`font-mono text-[11px] font-medium ${toneText}`}>
            {spec.dir === 'low' ? '▼' : '▲'} {t(spec.dir === 'low' ? 'tag.low' : 'tag.high')}
          </span>
        )}
      </div>

      {isEditing ? (
        spec.pairKey ? (
          <div className="flex items-center gap-1.5 mt-2">
            {numberInput(spec.key, inputId)}
            <span className="text-muted" aria-hidden="true">/</span>
            <label htmlFor={pairId} className="sr-only">{t(spec.labelKey)}</label>
            {numberInput(spec.pairKey, pairId)}
          </div>
        ) : (
          <div className="mt-2">{numberInput(spec.key, inputId)}</div>
        )
      ) : (
        <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
          out ? toneText : 'text-ink dark:text-chalk'
        }`}>
          {hasValue(value) ? (spec.format ? spec.format(Number(value)) : value) : '—'}
          {spec.pairKey && <>/{hasValue(pairValue) ? pairValue : '—'}</>}
          {hasValue(value) && (
            <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">{spec.unit}</span>
          )}
        </p>
      )}

      {hasValue(value) && <TickBar value={value} {...spec.band} tone={out ? spec.tone : 'ok'} />}
      <p className="datum mt-2.5">{t('vitals.ref')} {spec.ref}</p>
    </div>
  );
}

/**
 * The six readings as a ruled table. `children` fills the sixth cell
 * of the 3-column grid — each screen puts something different there.
 */
export default function VitalsGrid({
  vitals,
  isEditing = false,
  edited,
  onEdit,
  t,
  idPrefix = 'vitals',
  children,
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-3">
      {VITAL_SPECS.map((spec) => (
        <VitalCell
          key={spec.key}
          spec={spec}
          vitals={vitals}
          isEditing={isEditing}
          edited={edited}
          onEdit={onEdit}
          t={t}
          idPrefix={idPrefix}
        />
      ))}
      {children}
    </div>
  );
}
