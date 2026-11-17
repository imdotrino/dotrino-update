/**
 * @typedef {import('./types.js').ReleaseAsset} ReleaseAsset
 * @typedef {import('./types.js').AssetMatch} AssetMatch
 * @typedef {import('./types.js').DownloadOptions} DownloadOptions
 * @typedef {import('./types.js').VerifyResult} VerifyResult
 * @typedef {import('./types.js').SigstoreLib} SigstoreLib
 * @typedef {import('./types.js').FetchLike} FetchLike
 */
/**
 * Qué archivo del release le toca a ESTA máquina. `match` es cosa de cada producto —el
 * vault emite `.deb` y tarball; otro emitirá otra cosa—, así que se pasa.
 *
 * @param {ReleaseAsset[] | null | undefined} assets
 * @param {AssetMatch[]} match  en orden de preferencia
 * @returns {{ ok: true, asset: ReleaseAsset, kind: string } | { ok: false, reason: string }}
 */
export function pickAsset(assets: ReleaseAsset[] | null | undefined, match: AssetMatch[]): {
    ok: true;
    asset: ReleaseAsset;
    kind: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Baja a un directorio temporal propio y devuelve dónde quedó.
 * @param {ReleaseAsset} asset
 * @param {DownloadOptions} [options]
 * @returns {Promise<string>}  la ruta del archivo
 */
export function download(asset: ReleaseAsset, { fetchImpl, dir, product, version }?: DownloadOptions): Promise<string>;
/**
 * La librería de sigstore, si la pieza la instaló.
 * @returns {Promise<SigstoreLib | null>}
 */
export function loadSigstore(): Promise<SigstoreLib | null>;
/**
 * @param {string} file
 * @param {{ repo?: string, fetchImpl?: FetchLike, sigstore?: SigstoreLib | null }} [options]
 *   `sigstore`: la librería ya cargada (`null` = no hay); sin pasarla se carga sola.
 * @returns {Promise<VerifyResult>}
 */
export function verifyArtifact(file: string, { repo, fetchImpl, sigstore }?: {
    repo?: string;
    fetchImpl?: FetchLike;
    sigstore?: SigstoreLib | null;
}): Promise<VerifyResult>;
/**
 * ¿Alguno de estos bundles de sigstore es una procedencia de compilación de ESE sha256, firmada
 * por un workflow de ESE repo? No mira de dónde salió el bundle: la firma vale venga de donde
 * venga, y por eso sirve para verificar lo que se baja de un espejo.
 *
 * @param {any[]} bundles
 * @param {{ sha256: string, repo: string, lib: SigstoreLib }} options
 * @returns {Promise<VerifyResult>}
 */
export function verifyBundles(bundles: any[], { sha256, repo, lib }: {
    sha256: string;
    repo: string;
    lib: SigstoreLib;
}): Promise<VerifyResult>;
/**
 * Bajar y verificar, que es lo que casi siempre se quiere junto. No instala: eso es del producto.
 * @param {ReleaseAsset} asset
 * @param {DownloadOptions & { repo?: string, sigstore?: SigstoreLib | null }} [options]
 * @returns {Promise<VerifyResult & { file?: string }>}  `file` siempre que se bajó
 */
export function fetchVerified(asset: ReleaseAsset, { repo, ...rest }?: DownloadOptions & {
    repo?: string;
    sigstore?: SigstoreLib | null;
}): Promise<VerifyResult & {
    file?: string;
}>;
export type ReleaseAsset = import("./types.js").ReleaseAsset;
export type AssetMatch = import("./types.js").AssetMatch;
export type DownloadOptions = import("./types.js").DownloadOptions;
export type VerifyResult = import("./types.js").VerifyResult;
export type SigstoreLib = import("./types.js").SigstoreLib;
export type FetchLike = import("./types.js").FetchLike;
