/**
 * ¿Lo que corre es lo que hay en la rama? Cuatro respuestas, y ninguna se confunde con otra:
 *
 *   { ok: true,  behind: false, running, latest }   al día (o por delante: una máquina de desarrollo)
 *   { ok: true,  behind: true,  running, latest }   la rama tiene un commit que aquí no está
 *   { ok: false, code: 'not-a-checkout', reason }   no es un clon de git: no se sabe qué corre
 *   { ok: false, code: 'could-not-check', reason }  no se pudo mirar — NO es «al día»
 *
 * @param {import('./types.js').CheckoutOptions} [options]
 * @returns {Promise<import('./types.js').CheckoutResult>}
 */
export function checkCheckout({ dir, repo, branch, fetchImpl, timeoutMs, run }?: import("./types.js").CheckoutOptions): Promise<import("./types.js").CheckoutResult>;
/**
 * El vigía: mira al arrancar y una vez al día. Devuelve cómo pararlo.
 *
 *   watchCheckout({ dir: __dirname, repo: 'imdotrino/dotrino-signer', name: 'signer' })
 *
 * Que no sea un clon se dice UNA vez (no se arregla solo, y repetirlo cada día es ruido).
 * Que no se pueda mirar no se dice: no es problema de quien lee el log.
 *
 * @param {import('./types.js').CheckoutOptions & {
 *   name?: string, log?: (line: string) => void, everyMs?: number,
 *   onBehind?: (r: import('./types.js').CheckoutResult & { ok: true }) => void
 * }} [options]
 * @returns {import('./types.js').Stop}
 */
export function watchCheckout({ name, log, onBehind, everyMs, ...rest }?: import("./types.js").CheckoutOptions & {
    name?: string;
    log?: (line: string) => void;
    everyMs?: number;
    onBehind?: (r: import("./types.js").CheckoutResult & {
        ok: true;
    }) => void;
}): import("./types.js").Stop;
