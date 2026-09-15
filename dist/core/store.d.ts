import type { RegionShard } from "../transport/http/mega-client.js";
/**
 * The persisted session record. Internal shape — a host supplies a `SessionStore`, never builds this.
 * @internal
 */
export interface PersistedSession {
    userId: string;
    authToken: string;
    geoKey?: string;
    region: RegionShard;
    openudid: string;
    /** This install's reported device model + media user-agent, generated once and reused. */
    phoneModel?: string;
    mediaUserAgent?: string;
    /** ECDH session: shareKey hex (32 chars) + the bound key-ident. */
    shareKey: string;
    keyIdent: string;
    /** Unix seconds when the auth token expires (0 = unknown). */
    tokenExpiresAt: number;
    savedAt: number;
}
export interface SessionStore {
    load(): PersistedSession | null;
    save(s: PersistedSession): void;
    clear(): void;
}
/** In-memory store (no persistence) — the default. */
export declare class MemorySessionStore implements SessionStore {
    private s;
    load(): PersistedSession | null;
    save(s: PersistedSession): void;
    clear(): void;
}
/** JSON-file store, e.g. new FileSessionStore("./.eufy-session.json"). */
export declare class FileSessionStore implements SessionStore {
    private readonly path;
    constructor(path: string);
    load(): PersistedSession | null;
    save(s: PersistedSession): void;
    clear(): void;
}
/** A persisted session is usable if it has a token that isn't (near-)expired. */
export declare function isSessionValid(s: PersistedSession | null, skewSec?: number): boolean;
