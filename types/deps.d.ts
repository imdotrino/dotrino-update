/**
 * Las dependencias de `dir/package.json` que cumplen `match`, con la versión INSTALADA
 * (la de `node_modules`, que es la que corre), no la que pide el `package.json`.
 *
 * Lanza si no puede leer algo: una dependencia declarada y sin instalar es un despliegue a
 * medias, y callarlo sería decir «al día» sin haber mirado.
 *
 * @param {{ dir?: string, match?: RegExp }} [options]
 * @returns {import('./types.js').InstalledDep[]}
 */
export function installedDeps({ dir, match }?: {
    dir?: string;
    match?: RegExp;
}): import("./types.js").InstalledDep[];
/**
 * El vigía de las dependencias de un servicio: uno por cada pilar que usa. Devuelve cómo
 * pararlos todos. `log` recibe una línea, en inglés, cuando hay algo más nuevo.
 *
 *   watchDependencies({ dir: __dirname, name: 'geo' })
 *
 * @param {Omit<import('./types.js').WatchOptions, 'onNewer' | 'current' | 'source' | 'pkg'> & {
 *   dir?: string, match?: RegExp, name?: string, log?: (line: string) => void,
 *   onNewer?: (r: import('./types.js').UpdateFound & { pkg: string }) => void
 * }} [options]
 * @returns {import('./types.js').Stop}
 */
export function watchDependencies({ dir, match, name, log, onNewer, ...rest }?: Omit<import("./types.js").WatchOptions, "onNewer" | "current" | "source" | "pkg"> & {
    dir?: string;
    match?: RegExp;
    name?: string;
    log?: (line: string) => void;
    onNewer?: (r: import("./types.js").UpdateFound & {
        pkg: string;
    }) => void;
}): import("./types.js").Stop;
/**
 * Lo mismo para un COMANDO que corre desde un checkout (un bot de cron, una CLI que no está
 * en npm): al terminar la orden, una línea por stderr por cada pilar que quedó atrás. Con la
 * caché de un día y el tope de `printUpdateNotice`, así que no hace lenta la orden.
 *
 * Devuelve cuántos avisos imprimió. Lanza lo mismo que `installedDeps`.
 *
 * @param {Omit<import('./types.js').NoticeOptions, 'current' | 'source' | 'pkg' | 'product'> & {
 *   dir?: string, match?: RegExp
 * }} [options]
 * @returns {Promise<number>}
 */
export function printDependencyNotices({ dir, match, how, ...rest }?: Omit<import("./types.js").NoticeOptions, "current" | "source" | "pkg" | "product"> & {
    dir?: string;
    match?: RegExp;
}): Promise<number>;
