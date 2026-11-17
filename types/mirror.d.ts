/**
 * Comparar versiones semver (con prerelease, que va por debajo de la versión sin él).
 * @param {string} a
 * @param {string} b
 * @returns {number}  <0, 0 o >0
 */
export function compareVersions(a: string, b: string): number;
/**
 * ARMA LO QUE HAY QUE SUBIR. No sube nada: devuelve la lista de archivos, y `uploadMirror` los
 * sube. Así se puede probar sin red de escritura y ver qué va a cambiar.
 *
 * @param {{ tarballs?: string[], releaseFiles?: string[], repo?: string, tag?: string,
 *           lock?: string | null, base?: string, upstream?: string,
 *           fetchImpl?: import('./types.js').FetchLike, log?: (m: string) => void,
 *           readFile?: (p: string) => Buffer, now?: () => Date }} [options]
 *   `tarballs`: los `.tgz` propios (los de `npm pack`). `releaseFiles`: lo que va a
 *   `releases/<repo>/<tag>/`. `lock`: el `package-lock.json` de donde salen las dependencias.
 * @returns {Promise<MirrorFile[]>}
 */
export function buildMirror({ tarballs, releaseFiles, repo, tag, lock, base, upstream, fetchImpl, log, readFile, now }?: {
    tarballs?: string[];
    releaseFiles?: string[];
    repo?: string;
    tag?: string;
    lock?: string | null;
    base?: string;
    upstream?: string;
    fetchImpl?: import("./types.js").FetchLike;
    log?: (m: string) => void;
    readFile?: (p: string) => Buffer;
    now?: () => Date;
}): Promise<MirrorFile[]>;
/**
 * SUBE con la CLI de AWS (`aws s3 cp`), que ya está en los runners de GitHub y toma las
 * credenciales del entorno (el rol OIDC del workflow: ningún token guardado). Los packuments
 * van al FINAL: que un packument nombre una versión cuyo archivo todavía no subió dejaría un
 * `npm install` roto a medias.
 *
 * @param {MirrorFile[]} files
 * @param {{ bucket: string, run?: (cmd: string, args: string[], opts: object) => unknown, log?: (m: string) => void }} options
 *   `bucket`: `s3://nombre`
 */
export function uploadMirror(files: MirrorFile[], { bucket, run, log }: {
    bucket: string;
    run?: (cmd: string, args: string[], opts: object) => unknown;
    log?: (m: string) => void;
}): number;
export const MIRROR_BASE: "https://dotrino-deps.s3.amazonaws.com";
export const UPSTREAM: "https://registry.npmjs.org";
export function tarballName(name: string, version: string): string;
/**
 * `late`: se sube al final (los packuments y sus dist-tags)
 */
export type MirrorFile = {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
    late?: boolean;
};
