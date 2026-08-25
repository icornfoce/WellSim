/**
 * WellSim — The three recordings a screening is built from.
 *
 * The literal `['lung', 'heart', 'cough']` appeared eight times across
 * the two screens; adding a fourth site would have meant finding all
 * eight.
 */

export const AUDIO_TYPES = ['lung', 'heart', 'cough'];

/**
 * Resolve a stored recording's URL against the API host.
 *
 * Returns '' when nothing is stored, which is what the playback hook
 * treats as "there is no file here" — never a URL that 404s.
 */
export function resolveAudioUrl(apiUrl, audioLog) {
  const url = audioLog?.url;
  if (!audioLog?.available || !url) return '';
  return url.startsWith('http') ? url : `${apiUrl}${url}`;
}
