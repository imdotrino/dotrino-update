/**
 * Lanza (`sources-invalid`) si no tiene la forma de un directorio. Devuelve el mismo objeto.
 * @param {unknown} d
 * @returns {import('./types.js').SourcesDirectory}
 */
export function validateSources(d: unknown): import("./types.js").SourcesDirectory;
/**
 * Firma un directorio. Lo que se firma es el texto exacto (`payload`), así nadie tiene que
 * ponerse de acuerdo en cómo se ordena un JSON.
 *
 * @param {import('./types.js').SourcesDirectory} directory
 * @param {{ privateKey: string | crypto.KeyObject, kid: string }} key  la privada en PEM
 * @returns {import('./types.js').SignedSources}
 */
export function signSources(directory: import("./types.js").SourcesDirectory, { privateKey, kid }: {
    privateKey: string | crypto.KeyObject;
    kid: string;
}): import("./types.js").SignedSources;
/**
 * Abre un directorio firmado: firma de una llave de `keys`, forma válida. Lanza con `code`:
 * `sources-unsigned`, `sources-unknown-key`, `sources-bad-signature`, `sources-invalid`.
 *
 * @param {unknown} envelope
 * @param {{ keys?: Readonly<Record<string, string>> }} [options]
 * @returns {import('./types.js').SourcesDirectory}
 */
export function openSources(envelope: unknown, { keys }?: {
    keys?: Readonly<Record<string, string>>;
}): import("./types.js").SourcesDirectory;
/**
 * Un par nuevo para firmar el directorio. La privada va al cajón de la bóveda, nunca a un
 * archivo suelto ni a un repo.
 * @returns {{ kid: string, publicKey: string, privateKey: string }}  pública en SPKI DER base64, privada en PEM
 */
export function generateSourcesKey(): {
    kid: string;
    publicKey: string;
    privateKey: string;
};
/**
 * Dónde se guarda el último directorio firmado que se bajó.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function sourcesPath({ home, env }?: {
    home?: string;
    env?: NodeJS.ProcessEnv;
}): string;
/**
 * EL DIRECTORIO QUE MANDA EN ESTA MÁQUINA. Ver la cabecera para el orden.
 *
 * Lanza si algo que tiene que leerse no se puede leer (`DOTRINO_SOURCES` roto, o un
 * directorio guardado que ya no pasa la firma): eso es un fallo o una manipulación, y seguir
 * con el del código lo taparía.
 *
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, keys?: Readonly<Record<string, string>>, builtin?: import('./types.js').SourcesDirectory }} [options]
 * @returns {{ sources: import('./types.js').SourcesDirectory, from: 'env' | 'cache' | 'builtin', file?: string }}
 */
export function loadSources({ home, env, keys, builtin }?: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    keys?: Readonly<Record<string, string>>;
    builtin?: import("./types.js").SourcesDirectory;
}): {
    sources: import("./types.js").SourcesDirectory;
    from: "env" | "cache" | "builtin";
    file?: string;
};
/**
 * MIRA SI HAY UN DIRECTORIO MÁS NUEVO y, si lo hay y está firmado, lo guarda. Prueba las
 * direcciones de `directory` en orden.
 *
 * Nunca lanza. `{ ok: true, updated }`, o `{ ok: false, reason }` si ninguna dirección dio un
 * directorio válido (que NO es «no hay nada nuevo»: es «no se pudo mirar»).
 *
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, keys?: Readonly<Record<string, string>>,
 *           builtin?: import('./types.js').SourcesDirectory, fetchImpl?: import('./types.js').FetchLike, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, updated: boolean, seq: number, from: string } | { ok: false, reason: string }>}
 */
export function refreshSources({ home, env, keys, builtin, fetchImpl, timeoutMs }?: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    keys?: Readonly<Record<string, string>>;
    builtin?: import("./types.js").SourcesDirectory;
    fetchImpl?: import("./types.js").FetchLike;
    timeoutMs?: number;
}): Promise<{
    ok: true;
    updated: boolean;
    seq: number;
    from: string;
} | {
    ok: false;
    reason: string;
}>;
/**
 * Dónde buscar UNA pieza: lo de `packages[name]` (por paquete y luego por repo) y, lo que no
 * diga, lo de `default`.
 *
 * @param {import('./types.js').SourcesDirectory} sources
 * @param {{ pkg?: string, repo?: string }} who
 * @returns {{ npm: readonly string[], releases: readonly string[] }}
 */
export function sourcesFor(sources: import("./types.js").SourcesDirectory, { pkg, repo }?: {
    pkg?: string;
    repo?: string;
}): {
    npm: readonly string[];
    releases: readonly string[];
};
/**
 * Las direcciones de un archivo de una release, una por plantilla y en orden.
 * @param {readonly string[]} templates
 * @param {{ repo: string, tag: string, file: string }} parts
 */
export function releaseUrls(templates: readonly string[], { repo, tag, file }: {
    repo: string;
    tag: string;
    file: string;
}): string[];
export const SOURCES_FILE: "sources.json";
/**
 * Lo que trae el código. Mientras no exista el directorio estático propio, apunta a donde
 * están hoy las piezas: npm y las releases de GitHub.
 * @type {import('./types.js').SourcesDirectory}
 */
export const BUILTIN_SOURCES: import("./types.js").SourcesDirectory;
/**
 * Llaves públicas (Ed25519, SPKI DER en base64) que pueden firmar el directorio, por `kid`.
 * Vacío = ningún directorio firmado se acepta todavía: manda el que trae el código.
 * @type {Readonly<Record<string, string>>}
 */
export const TRUSTED_KEYS: Readonly<Record<string, string>>;
import crypto from 'node:crypto';
