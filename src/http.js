/**
 * Pedir un JSON con tope de tiempo. Devuelve `{ ok: true, body }` o `{ ok: false, reason }`
 * —«no se pudo mirar» es un resultado, no una excepción—, y cada quien decide qué hacer.
 *
 * @param {string} url
 * @param {import('./types.js').GetJsonOptions} options
 * @returns {Promise<import('./types.js').JsonResult>}
 */
export async function getJson (url, { fetchImpl = fetch, timeoutMs, headers = {} }) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetchImpl(url, { signal: ac.signal, headers })
    if (!r.ok) return { ok: false, reason: `${new URL(url).host} answered ${r.status}` }
    return { ok: true, body: await r.json() }
  } catch (err) {
    const e = /** @type {Error} */ (err)
    return { ok: false, reason: e.name === 'AbortError' ? 'timed out' : e.message }
  } finally { clearTimeout(t) }
}
