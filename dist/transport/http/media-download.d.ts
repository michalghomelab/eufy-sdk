type ResolveHost = (hostname: string) => Promise<readonly {
    address: string;
    family: number;
}[]>;
/** Signals rejection of the active Eufy session without exposing response content. @internal */
export declare class MediaDownloadAuthenticationError extends Error {
}
/**
 * Download one bounded push-media resource, following at most one allowlisted object-store redirect.
 * Authentication headers are sent only to the original Eufy media host.
 * @internal
 */
export declare function downloadMediaResource(url: string, authenticatedHeaders: RequestInit["headers"], fetchImpl?: typeof fetch, resolver?: ResolveHost): Promise<Buffer>;
export {};
