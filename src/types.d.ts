/**
 * Las formas de datos de @dotrino/update, en un solo sitio. Solo tipos: no hay código aquí.
 */

/** Un `fetch` (el global, o el falso de las pruebas). */
export type FetchLike = typeof fetch

/** Lo que llega en un `catch`: casi siempre un `Error`, a veces con `code` o `stderr`. */
export type Thrown = Error & { code?: string, stderr?: string | Buffer }

/** Un proceso hijo síncrono (`execFileSync`, o su doble en las pruebas). */
export type RunFn = (file: string, args: string[], options: {
  encoding: 'utf8', stdio: Array<'ignore' | 'pipe'>, timeout?: number, windowsHide?: boolean
}) => string | Buffer

/** «No se pudo»: un resultado, no una excepción. */
export interface Failure {
  ok: false
  reason: string
  code?: string
}

/**
 * Un JSON pedido por red. `body` es lo que contestó el servidor sin validar: quien lo lee lo
 * comprueba campo a campo, por eso es `any` y no una forma concreta.
 */
export type JsonResult = { ok: true, body: any } | { ok: false, reason: string }

export interface GetJsonOptions {
  fetchImpl?: FetchLike
  timeoutMs?: number
  headers?: Record<string, string>
}

/** Un archivo de una release de GitHub. */
export interface ReleaseAsset {
  name: string
  url: string
  size?: number
}

/** Dónde mirar la última versión. */
export interface LatestOptions {
  /** `'npm'` o `'github'`; otro valor da `{ ok: false }`. */
  source?: string
  /** `owner/repo`, con `source: 'github'`. */
  repo?: string
  /** El nombre del paquete, con `source: 'npm'`. */
  pkg?: string
  /** Con `github`: la release más alta cuyo tag empieza así (`desktop-v`). */
  tagPrefix?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  /** Para el user-agent. */
  product?: string
  /** Para el user-agent: la versión que corre. */
  version?: string
  /** El directorio de fuentes; sin él, `loadSources()` (el que manda en esta máquina). */
  sources?: SourcesDirectory
}

export type LatestOk =
  | { ok: true, version: string, source: 'npm', pkg: string, registry: string }
  | { ok: true, version: string, source: 'github', repo: string, assets: ReleaseAsset[], url: string }

export type LatestResult = LatestOk | Failure

export interface CheckOptions extends LatestOptions {
  /** La versión que corre. */
  current?: string
}

/** Se pudo mirar: hay versión nueva (`newer`) o se está al día. */
export type UpdateFound = LatestOk & { current: string, newer: boolean }

export type CheckResult = UpdateFound | Failure

export interface WatchOptions extends CheckOptions {
  onNewer?: (r: UpdateFound) => void
  everyMs?: number
}

/** Para dejar de mirar. */
export type Stop = () => void

export interface NoticeOptions extends CheckOptions {
  everyMs?: number
  timeoutMs?: number
  now?: number
  env?: NodeJS.ProcessEnv
  /** Qué hacer, detrás del aviso (`npm i -g …`). */
  how?: string
}

export type CheckoutResult =
  | { ok: true, behind: boolean, running: string, latest: string }
  | { ok: false, code: 'not-a-checkout' | 'could-not-check', reason: string }

export interface CheckoutOptions {
  dir?: string
  repo?: string
  branch?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  run?: RunFn
}

/** Una dependencia con la versión instalada en `node_modules`. */
export interface InstalledDep {
  pkg: string
  version: string
}

/** La parte de la librería `sigstore` que se usa (es dependencia opcional). */
export interface SigstoreLib {
  verify (bundle: any, options: { certificateIssuer: string }): Promise<{
    identity?: { subjectAlternativeName?: string, extensions?: { issuer?: string } }
  } | undefined>
}

/** Qué archivo del release le toca a esta máquina, en orden de preferencia. */
export interface AssetMatch {
  kind: string
  re: RegExp
  when?: () => boolean
}

export interface DownloadOptions {
  fetchImpl?: FetchLike
  dir?: string | null
  product?: string
  version?: string
}

export type VerifyResult =
  | { ok: true, out: string }
  | { ok: false, code?: 'NO_VERIFIER' | 'NO_ATTESTATION' | 'BAD_SIGNATURE', reason: string }

/** `npm-integrity.json`. */
export interface IntegrityFile {
  v: 1
  packages: Record<string, { version: string, integrity: string }>
}

/**
 * Cómo está instalada la pieza que corre. Solo la global se actualiza sola, y solo ella tiene
 * raíz y prefijo; las demás dicen por qué no (`reason`).
 */
export type InstallKind =
  | { kind: 'global', selfUpdating: true, entry: string, root: string, prefix: string, npm: string }
  | { kind: 'npx' | 'local' | 'source', selfUpdating: false, entry: string, reason: string }

/** `update-asked.json`: lo último que se preguntó. */
export interface AskedRecord {
  v?: 1
  pkg?: string
  version: string
  askedAt: number
  result: 'pending' | 'denied' | 'approved'
}

/** `update-needs-root.json`. */
export interface NeedsRootRecord {
  v?: 1
  pkg?: string
  version: string
  at?: number
  notified: boolean
}

/** `updated.json`: el marcador de «me acabo de actualizar». */
export interface UpdateMarker {
  v?: 1
  pkg?: string
  from: string
  to: string
  at?: number
}

export interface UpdatePrefs {
  approval: boolean
  notify: boolean
}

export type Lang = 'es' | 'en'

/** El resultado de `selfUpdateNpm`. */
export interface SelfUpdateResult {
  ok: boolean
  code: string
  reason?: string
  version?: string
  from?: string
  kind?: InstallKind['kind']
  why?: string
  askedAt?: number
}

export interface SelfUpdateOptions {
  /** El directorio de fuentes; sin él, se refresca y se carga el de esta máquina. */
  sources?: SourcesDirectory
  pkg?: string
  current?: string
  repo?: string
  tag?: (version: string) => string
  mayUpdate?: ((x: { pkg: string, version: string, from: string }) => Promise<boolean> | boolean) | null
  onInstalled?: ((x: { version: string, from: string, restart: boolean }) => unknown) | null
  onNeedsRoot?: ((x: { version: string, from: string }) => unknown) | null
  log?: (line: string) => void
  dir?: string | null
  entry?: string
  run?: RunFn
  fetchImpl?: FetchLike
  env?: NodeJS.ProcessEnv
  npm?: string
  home?: string
  platform?: NodeJS.Platform
  access?: (path: string, mode?: number) => void
  readFile?: (path: string, encoding: 'utf8') => string
  now?: () => number
}

export interface WatchSelfUpdateOptions extends SelfUpdateOptions {
  everyMs?: number
  retryMs?: number
  onResult?: ((r: SelfUpdateResult) => void) | null
  onUpdated?: ((x: { version: string, from: string }) => unknown) | null
}

/** Dónde buscar una pieza: registros npm y plantillas de release, en orden. */
export interface SourcesEntry {
  npm?: readonly string[]
  releases?: readonly string[]
}

/** El directorio de fuentes (`@dotrino/update/sources`). */
export interface SourcesDirectory {
  v: 1
  /** Sube en cada versión; nunca se acepta uno menor ni igual. */
  seq: number
  issued: string
  default: Required<SourcesEntry>
  /** Por nombre de paquete o `owner/repo`: lo que cambia para esa pieza. */
  packages: Readonly<Record<string, SourcesEntry>>
  /** Dónde leer la versión siguiente de este directorio. */
  directory: readonly string[]
}

/** Un directorio firmado: la firma (Ed25519, base64) es del texto exacto de `payload`. */
export interface SignedSources {
  kid: string
  payload: string
  sig: string
}
