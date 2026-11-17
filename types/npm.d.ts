/**
 * El `npm` DEL MISMO NODE QUE CORRE LA PIEZA. Con nvm o con un Node de usuario hay varios
 * prefijos globales en la máquina, y el `npm` del PATH de un servicio puede ser otro: se
 * instalaría bien… en un sitio del que este proceso no arranca.
 *
 * @param {{ execPath?: string, platform?: NodeJS.Platform, exists?: (p: string) => boolean }} [options]
 * @returns {string}  la ruta del `npm` junto a este Node, o `'npm'` (el del PATH)
 */
export function findNpm({ execPath, platform, exists }?: {
    execPath?: string;
    platform?: NodeJS.Platform;
    exists?: (p: string) => boolean;
}): string;
/**
 * CÓMO ESTÁ INSTALADA LA PIEZA QUE CORRE. Solo `global` se actualiza sola; para lo demás se
 * dice por qué y qué hacer, y no se intenta nada (igual que la bóveda con el `.deb`).
 *
 * Global es: cuelga del `node_modules` más alto de su ruta, Y ese es el que npm dice que es
 * su raíz global. La carpeta sale de la ruta real del archivo (resolviendo enlaces), no de
 * lo que imprime npm: npm solo confirma.
 *
 * @param {{ entry?: string, run?: RunFn, npm?: string }} [options]
 * @returns {InstallKind}
 */
export function installKind({ entry, run, npm }?: {
    entry?: string;
    run?: RunFn;
    npm?: string;
}): InstallKind;
/**
 * ¿Hay quien lo levante si sale? systemd, pm2, o que lo diga quien lo lanza.
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
export function supervised({ env }?: {
    env?: NodeJS.ProcessEnv;
}): boolean;
/**
 * BAJA ESA VERSIÓN Y LA COMPRUEBA CONTRA LA RELEASE DE SU REPO. Ver la cabecera para lo que
 * garantiza y lo que no.
 *
 * Con `ok: true` devuelve `file` (el tarball comprobado, que es lo que hay que instalar) y
 * `dir` (su carpeta, que BORRA quien llama cuando termine). Con `ok: false` no queda nada
 * en el disco.
 *
 * @param {{ pkg?: string, version?: string, repo?: string, tag?: (version: string) => string,
 *           fetchImpl?: FetchLike, home?: string, env?: NodeJS.ProcessEnv,
 *           sources?: import('./types.js').SourcesDirectory }} [o]
 *   `pkg`, `version` y `repo` hacen falta (sin ellos, `BAD_ARGS`). `repo` como
 *   `imdotrino/dotrino-update`; `tag` da el tag de la release de una versión (por defecto
 *   `v<versión>`).
 *   `sources`: el directorio de fuentes (sin él, el que manda en esta máquina).
 * @returns {Promise<{ ok: true, file: string, dir: string, integrity: string, registry: string } |
 *                   { ok: false, code: string, reason: string }>}
 *   códigos: `BAD_ARGS`, `NO_INTEGRITY_FILE` (la release no lo trae), `INTEGRITY_UNREACHABLE`,
 *   `WRONG_PACKAGE` (el JSON no nombra ese paquete en esa versión), `REGISTRY_UNREACHABLE`,
 *   `DOWNLOAD_FAILED`, `INTEGRITY_MISMATCH` (lo que da npm no es lo que midió el release),
 *   `SOURCES_UNREADABLE` (el directorio de fuentes no se puede leer).
 */
export function verifyNpmPackage({ pkg, version, repo, tag, fetchImpl, home, env, sources }?: {
    pkg?: string;
    version?: string;
    repo?: string;
    tag?: (version: string) => string;
    fetchImpl?: FetchLike;
    home?: string;
    env?: NodeJS.ProcessEnv;
    sources?: import("./types.js").SourcesDirectory;
}): Promise<{
    ok: true;
    file: string;
    dir: string;
    integrity: string;
    registry: string;
} | {
    ok: false;
    code: string;
    reason: string;
}>;
/**
 * INSTALA EN EL PREFIJO GLOBAL, sin lifecycle scripts, y comprueba que quedó la versión
 * pedida. Con `file` instala ESE tarball (el que ya se verificó); sin él, `pkg@version` del
 * registro — que es instalar sin haber comprobado nada: solo para quien verifica por otro lado.
 *
 * @param {{ pkg?: string, version?: string, file?: string | null, registry?: string | null, run?: RunFn, npm?: string,
 *           entry?: string, kind?: InstallKind | null, timeoutMs?: number,
 *           platform?: NodeJS.Platform, access?: (p: string, mode?: number) => void,
 *           readFile?: (p: string, encoding: 'utf8') => string }} [options]
 *   `kind`: lo que ya dijo `installKind` (si no, se mira aquí).
 * @returns {{ ok: true, version: string } | Failed}
 *   códigos: `BAD_ARGS`, `not-self-updating`, `needs-root`, `install-failed`.
 */
export function installNpmGlobal({ pkg, version, file, registry, run, npm, entry, kind, timeoutMs, platform, access, readFile }?: {
    pkg?: string;
    version?: string;
    file?: string | null;
    registry?: string | null;
    run?: RunFn;
    npm?: string;
    entry?: string;
    kind?: InstallKind | null;
    timeoutMs?: number;
    platform?: NodeJS.Platform;
    access?: (p: string, mode?: number) => void;
    readFile?: (p: string, encoding: "utf8") => string;
}): {
    ok: true;
    version: string;
} | Failed;
/**
 * LAS PREFERENCIAS DE ACTUALIZACIÓN DE ESTA INSTANCIA, que son dos y son de cada agente
 * (dueño, 2026-10-08: «lo de pedir aprobación es por agente, igual que las notificaciones;
 * son independientes al del vault»):
 *
 *   · `approval` — pedir aprobación antes de actualizarse. Por defecto NO: se actualiza sola.
 *   · `notify`   — avisar cuando se actualizó. Por defecto SÍ.
 *
 * Sin archivo valen los valores por defecto. Un archivo que existe y no se puede leer NO es
 * «los valores por defecto» —el de `approval` es no preguntar, y suponerlo saltaría la
 * aprobación que el dueño encendió—: se lanza (`prefs-unreadable`). No es secreto: va en claro.
 * @param {string | null | undefined} dir  la carpeta de datos de la instancia (sin ella, lanza `bad-dir`)
 * @returns {UpdatePrefs}
 */
export function readUpdatePrefs(dir: string | null | undefined): UpdatePrefs;
/**
 * Cambia SOLO lo que se le pasa (`{ approval }`, `{ notify }` o las dos); lo demás queda como estaba.
 * @param {string | null | undefined} dir
 * @param {Partial<UpdatePrefs>} [change]  cada clave, true o false (otra cosa lanza `bad-pref`)
 * @returns {UpdatePrefs}  cómo quedaron
 */
export function writeUpdatePrefs(dir: string | null | undefined, change?: Partial<UpdatePrefs>): UpdatePrefs;
/**
 * ¿ME ACABO DE ACTUALIZAR? Lo dice el marcador que `selfUpdateNpm` deja al instalar, y solo
 * cuenta si la versión que corre (`current`) ES la que se instaló: así el aviso lo da la
 * versión nueva ya en marcha, que es la prueba de que ocurrió.
 *
 * Devuelve `{ from, to }` y BORRA el marcador; `null` si no hay, o si todavía corre la
 * vieja (el marcador se queda para el próximo arranque). Uno de una versión anterior a la
 * que corre ya no dice nada y se borra. Ilegible → lanza (`marker-unreadable`).
 * @param {{ dir?: string | null, current?: string }} [options]
 * @returns {{ from: string, to: string } | null}
 */
export function takeUpdateMarker({ dir, current }?: {
    dir?: string | null;
    current?: string;
}): {
    from: string;
    to: string;
} | null;
/**
 * LO QUE EL `info`/ESTADO DE CADA AGENTE TIENE QUE DECIR de una versión más nueva que la que
 * corre y que no se instaló sola: que se pidió permiso y no se dio, o que la instalación
 * necesita root. Con cómo instalarla a mano. Cadena vacía si no hay nada que decir. No
 * lanza: si un apunte no se puede leer, eso es lo que dice.
 * @param {{ dir?: string | null, current?: string, lang?: string, now?: () => number }} [options]
 *   `lang`: `es` o `en` (otro, español)
 * @returns {string}
 */
export function updateStatusText({ dir, current, lang, now }?: {
    dir?: string | null;
    current?: string;
    lang?: string;
    now?: () => number;
}): string;
/**
 * `--approval [on|off]` Y `--notify [on|off]` PARA LA CLI DE CADA AGENTE, para no
 * escribirlo cuatro veces. Con valor lo guarda; sin valor dice cómo está; sin argumentos
 * enseña las dos líneas. Las dos banderas pueden ir juntas. No imprime: devuelve qué imprimir.
 *
 * @param {string[]} args  los argumentos del subcomando (p. ej. `['--approval', 'on']`)
 * @param {{ dir?: string | null, lang?: string }} [options]
 * @returns {{ handled: boolean, ok: boolean, text: string, prefs?: { approval: boolean, notify: boolean } }}
 *   `handled: false` solo si `args` trae algo y ninguna de las dos banderas (no era para
 *   esto). `ok: false` con `text` listo para stderr si un valor no vale o las preferencias
 *   no se pueden leer; en ese caso no se guarda nada.
 */
export function updatePrefsCommand(args?: string[], { dir, lang }?: {
    dir?: string | null;
    lang?: string;
}): {
    handled: boolean;
    ok: boolean;
    text: string;
    prefs?: {
        approval: boolean;
        notify: boolean;
    };
};
/**
 * EL FLUJO ENTERO, y lo único que llama un daemon: mirar, preguntar si puede, comprobar,
 * instalar y avisar de que hay que reiniciar.
 *
 * POR DEFECTO SE ACTUALIZA SIN PREGUNTAR. Pedir aprobación es una preferencia de CADA
 * instancia (`readUpdatePrefs(dir).approval`, la enciende `--approval on`):
 *
 *   · apagada (el valor por defecto) — NO se llama a `mayUpdate`: se verifica y se instala.
 *   · encendida — se llama a `mayUpdate({ pkg, version, from })`, que es donde quien llama
 *     se lo pide a los aprobadores de su bóveda, UNA VEZ POR VERSIÓN. El contrato:
 *       - devuelve `true`  → sí: se instala.
 *       - devuelve `false` → no, o pasó un día sin respuesta (vencido es no). Queda apuntado
 *         y ESA versión no se vuelve a preguntar (`not-approved`, y `already-declined` en
 *         las pasadas siguientes). Solo una versión más nueva dispara otro pedido.
 *       - LANZA → no se pudo preguntar (la bóveda no contesta, no hay red). No es una
 *         negativa: no se apunta nada y se reintenta en la próxima pasada (`could-not-ask`).
 *     Si no se pasó `mayUpdate` no hay a quién preguntar y no se instala (`no-approver`).
 *   · preferencias ilegibles — no se instala (`prefs-unreadable`).
 *
 * Sin `dir` no hay preferencias: entonces se pregunta si, y solo si, se pasó `mayUpdate`.
 *
 * `onNeedsRoot({ version, from })` se llama cuando hay versión nueva y el prefijo global no
 * es de este usuario (`needs-root`): UNA vez por versión, solo con `dir` y con `notify`
 * encendida. Es donde el daemon se lo dice a los aprobadores. Si lanza, se reintenta en la
 * próxima pasada. No se intenta instalar nada.
 *
 * `dir` es la carpeta de datos de la instancia: de ahí salen las preferencias, y ahí queda el marcador `{ from, to, at }` que
 * la versión nueva lee al arrancar para avisar de que se actualizó (`takeUpdateMarker`).
 *
 * `onInstalled({ version, from, restart })` se llama con la versión nueva ya en el disco.
 * `restart: true` solo si hay quien levante el proceso (`supervised`): ahí el daemon cierra
 * lo suyo y sale. Con `false` no debe salir: se quedaría apagado.
 *
 * Nunca lanza. Devuelve `{ ok, code, version?, from?, reason? }`; `ok` es true en
 * `up-to-date`, `installed` e `installed-restart`, y false en `could-not-check`,
 * `not-self-updating`, `needs-root`, `prefs-unreadable`, `asked-unreadable`, `no-approver`,
 * `could-not-ask`, `not-approved`, `already-declined`, `unverified` (con `why`: el código de
 * `verifyNpmPackage`) e `install-failed`.
 *
 * @param {SelfUpdateOptions} [options]
 * @returns {Promise<SelfUpdateResult>}
 */
export function selfUpdateNpm({ pkg, current, repo, tag, mayUpdate, onInstalled, onNeedsRoot, log, dir, entry, run, fetchImpl, env, npm, home, platform, access, readFile, now, sources }?: SelfUpdateOptions): Promise<SelfUpdateResult>;
/**
 * EL VIGÍA DE UN DAEMON: `selfUpdateNpm` al arrancar y una vez al día. Si no se pudo mirar
 * (la red todavía no está, el registro no contesta) se reintenta en una hora en vez de
 * esperar al día siguiente, y solo se dice cuando el motivo cambia. Devuelve cómo pararlo.
 *
 * `onResult(r)` recibe cada resultado: es lo que una pantalla de estado necesita para decir
 * «al día», «no se pudo mirar» o «pide permiso», que son tres cosas distintas. *
 * `onUpdated({ version, from })` se llama UNA vez, al arrancar, si esta es la versión que se
 * acaba de instalar (hace falta `dir`) y la instancia no apagó los avisos
 * (`readUpdatePrefs(dir).notify`). Es donde el daemon se lo dice a su bóveda. Si lanza, el
 * marcador no se pierde: se reintenta en el próximo arranque.
 *
 * @param {import('./types.js').WatchSelfUpdateOptions} [options]
 * @returns {import('./types.js').Stop}
 */
export function watchSelfUpdateNpm({ everyMs, retryMs, onResult, onUpdated, log, ...opts }?: import("./types.js").WatchSelfUpdateOptions): import("./types.js").Stop;
export const UPDATE_PREFS_FILE: "update-prefs.json";
export const UPDATE_MARKER_FILE: "updated.json";
export const UPDATE_ASKED_FILE: "update-asked.json";
/** Cuánto vale un pedido sin respuesta antes de darse por negado. */
export const ASK_TTL_MS: number;
export const UPDATE_NEEDS_ROOT_FILE: "update-needs-root.json";
export type Thrown = import("./types.js").Thrown;
export type RunFn = import("./types.js").RunFn;
export type FetchLike = import("./types.js").FetchLike;
export type InstallKind = import("./types.js").InstallKind;
export type UpdatePrefs = import("./types.js").UpdatePrefs;
export type UpdateMarker = import("./types.js").UpdateMarker;
export type AskedRecord = import("./types.js").AskedRecord;
export type NeedsRootRecord = import("./types.js").NeedsRootRecord;
export type Lang = import("./types.js").Lang;
export type SelfUpdateOptions = import("./types.js").SelfUpdateOptions;
export type SelfUpdateResult = import("./types.js").SelfUpdateResult;
export type Failed = {
    ok: false;
    code: string;
    reason: string;
};
