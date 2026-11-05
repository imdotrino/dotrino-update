/**
 * Donde se recuerda lo último visto. XDG, y si no hay, `~/.cache`.
 * @param {string | undefined} key  el paquete, el repo o el producto
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 */
export function cacheFile(key: string | undefined, { home, env }?: {
    home?: string;
    env?: NodeJS.ProcessEnv;
}): string;
/**
 * ¿Hay que decir algo? Devuelve la línea, o `null`.
 *
 * Lo que se sabe sale de la caché (instantáneo). Si la caché está vieja, SE MIRA aquí —con
 * tope— y se guarda para la próxima. Ese es el único momento en que esto cuesta tiempo, una
 * vez al día.
 *
 * @param {import('./types.js').NoticeOptions} [options]
 * @returns {Promise<string | null>}
 */
export function updateNotice({ current, product, source, pkg, repo, everyMs, timeoutMs, now, env, ...rest }?: import("./types.js").NoticeOptions): Promise<string | null>;
/**
 * Lo mismo, ya impreso y a prueba de todo. Es lo que un comando llama al terminar:
 *
 *     process.on('exit', …)  NO sirve — esto es asíncrono.
 *     await printUpdateNotice({ current: VERSION, source: 'npm', pkg: '@dotrino/env' })
 *
 * @param {import('./types.js').NoticeOptions} [opts]
 * @returns {Promise<boolean>}  si imprimió algo
 */
export function printUpdateNotice(opts?: import("./types.js").NoticeOptions): Promise<boolean>;
