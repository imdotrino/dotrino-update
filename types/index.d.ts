/**
 * ¿`a` es más nueva que `b`? Sin dependencias: son tres números y compararlos bien cabe
 * aquí. Un comparador de semver a medias es peor que no tenerlo, porque falla callado.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}  false también si alguna de las dos no es una versión
 */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean;
/**
 * LA ÚLTIMA VERSIÓN PUBLICADA. Dos orígenes, porque el ecosistema se instala de dos formas:
 *
 *   · `github` — la pieza se baja como binario de un release (el vault: `.deb`, tarball).
 *                Con `tagPrefix`, la release más alta cuyo tag empieza así (un repo con
 *                varios productos: `desktop-v`, `agent-v`).
 *   · `npm`    — la pieza se corre desde el registro (el proxio, geo, reputation, los bots).
 *
 * Devuelve `{ ok: false, reason }` cuando no se pudo mirar, que **no** es «estás al día»:
 * quien lo enseñe tiene que poder decir cuál de las dos cosas pasó.
 *
 * @param {LatestOptions} [options]
 * @returns {Promise<LatestResult>}
 */
export function latestVersion({ source, repo, pkg, tagPrefix, fetchImpl, timeoutMs, product, version }?: LatestOptions): Promise<LatestResult>;
/**
 * ¿Hay algo más nuevo que lo que corro? Es lo ÚNICO que una pieza hace sola y sin pedir
 * permiso, porque es una lectura.
 *
 * Tres respuestas y ninguna se confunde con otra: `{ok:true, newer:true}` (hay),
 * `{ok:true, newer:false}` (al día) y `{ok:false, reason}` (no se pudo mirar).
 *
 * @param {CheckOptions} [options]
 * @returns {Promise<CheckResult>}
 */
export function checkForUpdate({ current, ...rest }?: CheckOptions): Promise<CheckResult>;
/**
 * El vigía, para un daemon: mira al arrancar y una vez al día. Devuelve cómo pararlo.
 *
 * No lanza nunca: que no se pueda mirar no es problema del usuario, y llenarle el log de
 * fallos de red tampoco le ayuda. Solo habla cuando hay algo que decir.
 *
 * @param {WatchOptions} [options]
 * @returns {import('./types.js').Stop}
 */
export function watchForUpdate({ onNewer, everyMs, ...rest }?: WatchOptions): import("./types.js").Stop;
/**
 * Cada cuánto mirar. Un día: esto no es una carrera, y una pieza que pregunta cada minuto
 * es una pieza que hace ruido en el registro de otro.
 */
export const CHECK_EVERY_MS: number;
export type LatestOptions = import("./types.js").LatestOptions;
export type LatestResult = import("./types.js").LatestResult;
export type CheckOptions = import("./types.js").CheckOptions;
export type CheckResult = import("./types.js").CheckResult;
export type WatchOptions = import("./types.js").WatchOptions;
export type GetJsonOptions = import("./types.js").GetJsonOptions;
