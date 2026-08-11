/**
 * WellSim — Clinical label dictionary (EN / TH)
 *
 * The engine emits machine keys (`wheeze_and_crackles`). Every surface
 * that shows a screening result must translate them: the patient portal
 * used to print the raw key, so a patient read "wheeze_and_crackles"
 * where the clinician's dashboard read "Wheeze with crackles". One
 * dictionary, one wording, both screens.
 */

export const LABEL_TEXT = {
  en: {
    normal_breath_sounds: 'Normal breath sounds',
    wheeze: 'Wheeze',
    fine_crackles: 'Fine crackles',
    coarse_crackles: 'Coarse crackles',
    wheeze_and_crackles: 'Wheeze with crackles',
    regular_rhythm: 'Regular rhythm',
    irregular_rhythm: 'Irregular rhythm',
    irregular_rhythm_with_murmur_signal: 'Irregular rhythm with murmur',
    murmur_signal_present: 'Murmur signal present',
    tachycardia_signal: 'Fast rate (tachycardia signal)',
    bradycardia_signal: 'Slow rate (bradycardia signal)',
    dry_cough: 'Dry cough',
    productive_cough: 'Productive cough',
    no_cough_detected: 'No cough detected',
    inconclusive: 'Inconclusive',
  },
  th: {
    normal_breath_sounds: 'เสียงหายใจปกติ',
    wheeze: 'เสียงหวีด (Wheeze)',
    fine_crackles: 'เสียงกรอบแกรบละเอียด (Fine crackles)',
    coarse_crackles: 'เสียงกรอบแกรบหยาบ (Coarse crackles)',
    wheeze_and_crackles: 'เสียงหวีดร่วมกับกรอบแกรบ',
    regular_rhythm: 'จังหวะหัวใจสม่ำเสมอ',
    irregular_rhythm: 'จังหวะหัวใจไม่สม่ำเสมอ',
    irregular_rhythm_with_murmur_signal: 'จังหวะไม่สม่ำเสมอร่วมกับเสียงฟู่',
    murmur_signal_present: 'พบสัญญาณเสียงฟู่ (Murmur)',
    tachycardia_signal: 'อัตราการเต้นเร็ว',
    bradycardia_signal: 'อัตราการเต้นช้า',
    dry_cough: 'ไอแห้ง',
    productive_cough: 'ไอมีเสมหะ',
    no_cough_detected: 'ไม่พบเสียงไอ',
    inconclusive: 'สรุปผลไม่ได้',
  },
};

/** Labels a doctor may choose when overriding, grouped by recording type. */
export const OVERRIDE_OPTIONS = {
  lung: ['normal_breath_sounds', 'wheeze', 'fine_crackles', 'coarse_crackles', 'wheeze_and_crackles', 'inconclusive'],
  heart: ['regular_rhythm', 'irregular_rhythm', 'murmur_signal_present', 'irregular_rhythm_with_murmur_signal', 'tachycardia_signal', 'bradycardia_signal', 'inconclusive'],
  cough: ['no_cough_detected', 'dry_cough', 'productive_cough', 'inconclusive'],
};

/**
 * Resolve an engine key to clinical wording in the active language.
 * Unknown keys degrade to spaced-out words rather than a bare key.
 */
export function clinicalLabel(key, lang = 'en') {
  return LABEL_TEXT[lang]?.[key] || LABEL_TEXT.en[key] || String(key || '').replace(/_/g, ' ');
}
