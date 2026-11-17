/**
 * `{ name, version }` del `package/package.json` de un `.tgz` de `npm pack`.
 * @param {Buffer | Uint8Array} bytes
 * @returns {{ name: string, version: string }}
 */
export function packageOfTarball(bytes: Buffer | Uint8Array): {
    name: string;
    version: string;
};
/**
 * El `package/package.json` ENTERO de un `.tgz` (lo que un registro sirve como manifiesto de
 * esa versión: dependencias, `bin`, `engines`…).
 * @param {Buffer | Uint8Array} bytes
 * @returns {Record<string, any> & { name: string, version: string }}
 */
export function manifestOfTarball(bytes: Buffer | Uint8Array): Record<string, any> & {
    name: string;
    version: string;
};
/**
 * El contenido de `npm-integrity.json` para esos `.tgz`:
 * `{ v: 1, packages: { "<nombre>": { version, integrity } } }`. Un repo puede publicar varios
 * paquetes; dos tarballs del MISMO paquete es un error, no «gana el último».
 *
 * @param {string[]} files
 * @param {{ readFile?: (file: string) => Buffer }} [options]
 * @returns {import('./types.js').IntegrityFile}
 */
export function buildIntegrity(files: string[], { readFile }?: {
    readFile?: (file: string) => Buffer;
}): import("./types.js").IntegrityFile;
export const INTEGRITY_FILE: "npm-integrity.json";
export function integrityOf(bytes: Buffer | Uint8Array): string;
