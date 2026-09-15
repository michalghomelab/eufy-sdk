import type { Logger } from "../core/logger.js";
/** In-memory state for push thumbnails acquired before a caller passively reads them. */
export declare class StoredImageCache {
    private readonly downloader;
    private readonly logger;
    private readonly clock;
    private readonly isLifecycleError;
    private readonly devices;
    private readonly activeDevices;
    private activeDownloads;
    private generation;
    constructor(downloader: (url: string, deviceKey: string) => Promise<Buffer>, logger: Logger, clock?: () => number, isLifecycleError?: (error: unknown) => boolean);
    /** Observe a normalized thumbnail URL and start acquisition eagerly. */
    observe(deviceKey: string, url: string): void;
    /** Return retained bytes without starting or awaiting network work. */
    snapshotStored(deviceKey: string): Promise<Buffer>;
    /** Invalidate all retained and candidate state. */
    clear(): void;
    private pump;
    private complete;
    private isValidJpeg;
    private diagnose;
}
