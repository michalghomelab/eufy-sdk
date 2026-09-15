/**
 * P2P command router — the transport-side owner of the ThroughTek PPCS sessions and every wire
 * operation over them: opening sessions, resolving a serial to its session + routing params,
 * mapping a transport-neutral {@link Command} to a concrete frame (encryption level, wire shape),
 * the fire-and-forget control senders, request/reply queries, and the media provider.
 *
 * Layering: this module knows P2P bytes; it does NOT know capabilities. Frame → semantic-event
 * decoding is a model concern, so raw frames are handed back to the client via {@link P2PRouterDeps.onFrame}
 * (the client gates them on device capabilities and emits typed events). This keeps transport free of
 * any `model/` import — the capability↔transport decorrelation invariant.
 */
import type { MegaHttpClient } from "../http/mega-client.js";
import type { EufyDevice } from "../../core/types.js";
import type { Command, AutoLockSnapshot, MediaProvider, SharedSourceHints, AbortableCall } from "../../core/contracts.js";
import { type Logger } from "../../core/logger.js";
import { P2PSession, type P2PFrame } from "./p2p-session.js";
import type { FfmpegLevel } from "../ffmpeg.js";
import { SharedLiveSource } from "./shared-live-source.js";
import { type PowerTier, type SessionManagerOpts } from "./session-manager.js";
import { FragmentRecording } from "./fragment-recording.js";
/**
 * Options accepted when warming a {@link SharedLiveSource} for a device (all optional).
 *
 * {@link SharedSourceHints} are the members any media egress may supply, because any of them may be the
 * call that opens the pull; the rest reach it only from a caller that warms a source directly.
 */
export interface SharedLiveOpts extends SharedSourceHints, AbortableCall {
    eccPrivateKey?: Buffer;
    keepAliveMs?: number;
    lingerMs?: number;
    /** Battery/solar continuous-stream budget in ms (default 45000). */
    batteryBudgetMs?: number;
    /** Grace after the budget notice to `extend()` before auto-stop, in ms (default 10000). */
    budgetGraceMs?: number;
}
/**
 * The facade-side dependencies the router needs. It owns the sessions map and all wire logic, but
 * defers device-list access + lifecycle/frame event fan-out to the client (which owns the typed
 * EventEmitter and the model-coupled frame decode).
 */
export interface P2PRouterDeps {
    mega: MegaHttpClient;
    /** Diagnostics sink, forwarded to every P2P session. Omit for silence. */
    logger?: Logger;
    /** ffmpeg `-loglevel` for the media (snapshot/record) paths. Default `"error"`. */
    ffmpegLogLevel?: FfmpegLevel;
    /** The ffmpeg executable the media paths run. Default: the bare name, looked up on `PATH`. */
    ffmpegPath?: string;
    /** Current (already-loaded) device list. */
    listDevices: () => EufyDevice[];
    /** Load the device list if it isn't loaded yet (delegates to the client's getDevices). */
    ensureDevices: () => Promise<void>;
    onConnect: (stationSn: string) => void;
    onClose: (stationSn: string) => void;
    onError: (err: Error) => void;
    onLevel2Ready: (stationSn: string, cipherId: number) => void;
    /** A raw decoded frame — the client emits the low-level `p2p` event + runs the semantic decode. */
    onFrame: (stationSn: string, frame: P2PFrame) => void;
    /**
     * Power tier per parent-station serial (`"wired"` = persistent session, `"battery"` = on-demand +
     * idle-detach). Injected by the facade from resolved capabilities — plain data, so transport never
     * imports model. Default (absent): every station treated as `"wired"` (today's persistent behaviour).
     */
    poweredFor?: (parentSn: string) => PowerTier;
    /** Idle/keepalive window overrides for the session lifecycle (see {@link SessionManagerOpts}). */
    sessionIdle?: Pick<SessionManagerOpts, "batteryIdleMs">;
    /** LAN address overrides for direct P2P, keyed by parent-station serial (host or host:port). */
    localAddresses?: Record<string, string>;
    /** Suppress the `255.255.255.255` local-lookup broadcast; cloud lookup and a known LAN address still run. */
    noBroadcast?: boolean;
}
export declare class P2PCommandRouter {
    private readonly deps;
    /** Per-station P2P session lifecycle: on-demand open + battery-aware idle-detach + refcount. */
    private readonly manager;
    /** Error objects already forwarded while a station startup awaits the same session signal. */
    private readonly reportedErrors;
    /** One shared live source per `${parentSn}:${channel}` — collapses N live() calls to one pull. */
    private readonly liveSources;
    /** The options each live source was built from, so a later caller's conflicting ones can be reported. */
    private readonly liveSourceOpts;
    /**
     * The open talkback per `${parentSn}:${channel}`, if any. The device plays one audio stream at a
     * time and the session carries one audio sequence, so this path is exclusive where a live pull is
     * shared — see {@link P2PCommandRouter.openTalkback}.
     */
    private readonly talkbacks;
    /** cipher_id → ECC private key (one eufylife get_ciphers call per cipher), shared across (re)opens. */
    private readonly cipherKeyCache;
    constructor(deps: P2PRouterDeps);
    /** Forward one P2P failure once even when both the session listener and startup waiter observe it. */
    private reportError;
    /**
     * Whether this transport stack drives `dev`'s `ff09-*` commands — true when the device has its own
     * usable P2P endpoint (a non-empty `p2p_did`). The command sink asks each stack this to route a
     * transport-neutral command. Keyed on the endpoint, NOT `classifyDevice`'s `realtime` tag: that tag is
     * `"p2p"` for the ENTIRE `eufy_security` category, so it can't tell a P2P lock (T8531, own `p2p_did`)
     * from an MQTT-only lock/garage (T85D0, empty `p2p_did`) — routing the latter to P2P throws
     * `no P2P session`.
     */
    static claimsDevice(dev: EufyDevice): boolean;
    /** Stations with a live P2P session (a snapshot; mutate via the lifecycle methods, not this map). */
    getSessions(): Map<string, P2PSession>;
    /**
     * Speculatively open + briefly hold a station's session (e.g. after a doorbell ring) so a
     * tap-to-view / talkback attaches to a warm session. Transport-neutral: the facade maps the semantic
     * event → station and decides whether this station may be pre-warmed at all; the router never learns
     * event semantics.
     *
     * One hold, taken before the open so a slow connect can't idle-close mid-flight. It expires on its
     * own, which arms the station's idle window rather than closing the session, per {@link PREWARM_MS}.
     * A second hold after the open would buy nothing: {@link openStation} returns once the socket is bound
     * and the lookups are away, not once the peer has answered, so both would expire together.
     *
     * Best-effort — a failed open surfaces via `onError`. A {@link SessionSupersededError} does not: the
     * session was deliberately closed underneath a speculative open, which is not a fault to report.
     */
    prewarm(parentSn: string, ms?: number): Promise<void>;
    /** Close every P2P session and drop them. */
    closeAll(): Promise<void>;
    /** This serial's loaded record, or `undefined` — the one place the cached list is searched by serial. */
    private recordFor;
    /** The parent-station key a device's session lives under (its HomeBase, or itself if standalone). */
    private stationKeyFor;
    /**
     * The parent-station serial a device serial's session lives under — the single source of truth for
     * session keying, used by the facade (e.g. to pre-warm the right station for an event). Returns the
     * serial itself if the device isn't loaded (a standalone device is its own station).
     */
    stationKeyOf(sn: string): string;
    /** Reset only a standalone device's session; an attached device must not close its shared HomeBase. */
    resetStandaloneSession(sn: string): Promise<void>;
    /**
     * Open (or reuse) the P2P session for a station **on demand**, coalescing concurrent cold opens via
     * the {@link SessionManager}. A command / stream / pre-warm opens only the station it targets; idle
     * battery stations auto-close. The station's own record carries the P2P creds — a serial with no
     * record of its own throws, because every value the session carries comes from that one record (the
     * endpoint dialled, its cloud and LAN addresses, the admin user id the cipher lookup quotes) and is
     * keyed under that one serial, so there is no partial answer to give. A per-station DSK key is
     * fetched best-effort (ThroughTek PPCS UDP, LAN broadcast fallback if the key lookup fails). The LAN
     * address for a direct local lookup is a caller-supplied override ({@link P2PRouterDeps.localAddresses})
     * when present, else the freshest private IP in the record ({@link freshestLanIp}) — so P2P works
     * on-LAN even when broadcast is blocked (AP isolation) or the record's `ip_addr` went stale.
     */
    private openStation;
    /**
     * Build + wire a {@link P2PSession} for a station (NOT yet connected — the caller awaits `connect()`).
     *
     * `resolveCipherKey` auto-negotiates the level-2 session key from `CMD_GATEWAYINFO` by resolving the
     * cipher's ECC private key via cloud `get_ciphers`, so signCode 2/8 frames decrypt live; results are
     * cached on the router instance so a lazy re-open (after idle-detach) reuses the lookup. Only a
     * SUCCESSFUL lookup is cached — caching `undefined` after a transient failure would permanently
     * disable level-2 for the session's life.
     *
     * The `close` handler drops the session from the {@link SessionManager} and disposes any shared live
     * source riding this station (consumers get `stop`; a later attach rebuilds via the factory).
     */
    private makeSession;
    /**
     * Open (or reuse) a station's P2P session and await its completed handshake. An optional abort only
     * stops this wait; session ownership remains with {@link SessionManager} and its normal teardown.
     */
    ensureStation(parentSn: string, signal?: AbortSignal): Promise<void>;
    /** Resolve a serial to its loaded device record, opening its station's P2P session on demand. */
    deviceFor(sn: string): Promise<EufyDevice>;
    /**
     * Route a transport-neutral {@link Command} to its wire transport — the command-sink
     * implementation. Capability modules emit intent; this is the one place that knows P2P.
     */
    dispatchCommand(sn: string, cmd: Command): Promise<void>;
    /**
     * Restart a HomeBase. `RESTART_HUB` (1034) is a station-scalar on the broadcast channel 255: a
     * level-2 frame whose body is `[u32 value][account_id padded]` — the same shape as the hub
     * alarm-volume control. ✅ Wire-confirmed byte-exact from a capture of the app's own Restart
     * (2026-08-03) and HW-tested: the captured frame carried value `0` and rebooted the hub. Replays
     * like every other level-2 control, so a single dropped datagram doesn't lose it.
     */
    rebootStation(sn: string): Promise<void>;
    /**
     * A {@link MediaProvider} bound to one serial — resolves the session then calls `p2p/media`.
     *
     * Every live egress here is a consumer of the SAME shared pull, so N `live()` calls collapse to one
     * PPCS session and a live snapshot against a warm, keyframe-primed source costs no extra pull at all; a
     * cold source warms one and waits for a clean keyframe. Each shared egress passes its complete options
     * through because any of them may create the source, whose power and retention hints are fixed for
     * everyone who joins later. The bounded {@link MediaProvider.record} clip is the exception: it opens its
     * own pull, receives its session topology directly, and requires the level-2 key an attached camera's
     * start has no level-1 form for.
     */
    mediaProviderFor(sn: string): MediaProvider;
    /**
     * Open a {@link Talkback} on a device's camera channel.
     *
     * **The camera only plays host audio while its media session is open** — verified live on three
     * cameras: the identical start + audio frames produce silence with no media session and audible
     * playback with one. So this attaches a consumer to the shared live source and holds it for the
     * talkback's lifetime, releasing it on stop. The source is shared and refcounted, so an already-open
     * stream costs nothing extra and a talkback on an otherwise idle camera opens the session it needs
     * instead of playing into silence.
     *
     * The level-2 key is waited for softly: only the HomeBase-attached path requires it, and
     * {@link Talkback.start} reports that failure precisely, so a hard wait here would reject an
     * own-session camera that legitimately never negotiates one.
     *
     * Both of the media consumer's events are forwarded rather than left to default. An unhandled
     * `error` on it would take the host process down, and a warm-up failure is exactly the condition
     * that makes talkback silent, so it reaches the caller when one is listening and the log otherwise.
     * A `budget` notice means a battery camera's session is about to auto-stop and take the audio with
     * it mid-sentence; forwarding it lets a caller extend, while ignoring it stops on schedule and
     * protects the battery. The budget belongs to the shared source rather than to one consumer, so a
     * single `extend()` covers a live stream and a talkback running side by side.
     *
     * `stop` ends the talkback with it. The media session going away is the one condition under which
     * audio cannot be heard no matter how well it is framed, so pacing on into a dead session would be
     * silent failure rather than a shorter clip.
     *
     * **One talkback per camera at a time.** Unlike a live pull, this path cannot be fanned out: both
     * handles would pace onto one session's single audio sequence, interleaving two AAC streams into
     * something unplayable, and whichever stopped first would close the device's path under the other —
     * with no error on either side. The second caller is refused rather than handed the first one's
     * handle, which would silently discard its `encoder` and hand it a clip already in progress.
     *
     * The refusal is decided and RECORDED in one synchronous step, before the shared media source is awaited.
     * Warming that source is a round-trip, so two concurrent callers would otherwise both find the map empty,
     * both build a talkback, and the second would overwrite the first in the map — two paced streams on the one
     * audio sequence, and the orphaned handle no longer reachable by {@link P2PCommandRouter.closeAll}. The
     * entry is therefore claimed by the talkback itself, which the media consumer is wired into once it exists;
     * a failure to warm or to open the audio path releases the claim.
     *
     * The claim is re-checked after the wait for the mirror case: a station close or `closeAll` in that window
     * stops the talkback that is holding it, and starting the pacing tick on a stopped talkback would pace into
     * a session nobody is listening on.
     */
    private openTalkback;
    /**
     * Resolve a serial to its **shared live source** — one underlying pull per `${parentSn}:${channel}`,
     * fanned out to every consumer (see {@link SharedLiveSource}). Lazily warmed on the first consumer;
     * the `makeStream` factory rebuilds a fresh {@link LiveStream} on each (re)warm so a reconnect can
     * recover. Uses `waitLevel2:"soft"` — mirrors `live()`, no hard-fail on a standalone camera. Wires
     * `onActive`/`onIdle` so an attached stream counts as a user of the station's P2P session (cancels
     * the session idle-detach while streaming; its longer idle timer arms when the last consumer leaves).
     *
     * A source that has **stopped** (linger teardown, failed start, budget auto-stop, upstream error) is
     * dropped here rather than re-used, whatever is still attached to it. Its pull is dead, so nothing is
     * being protected by keeping it — and keeping it would leave the options of whichever egress created
     * it first in force for the process lifetime, so a stray `powered` from the day's first snapshot would
     * still be dictating the budget hours later. Dropping it lets the next caller build a fresh source
     * from its own options.
     *
     * Attachment count is deliberately NOT part of that test. A failed start fails its consumers without
     * detaching them, so a caller still holding its handle leaves the count non-zero — and requiring an
     * empty source here would hand one dead source out for the life of the client. A caller must
     * re-acquire through this method after a failure; `attach()` on the dropped source throws, because it
     * has been disposed.
     *
     * Several cameras behind one station each get their own source: the station tags every media frame with the
     * camera it belongs to, and {@link LiveStream} takes only its own.
     *
     * Whether they can be SERVED at the same time is the station's business, not this map's. Where it serves one
     * camera at a time, a pull still lingering for a camera nobody is watching would go on re-issuing its own
     * media start against the one being asked for, so opening a new channel releases those first — see
     * {@link releaseLingeringSiblings}. A pull with consumers is never touched. The release runs before the
     * reuse branch, so a reuse frees the station as a cold start does.
     *
     * The session goes into a {@link HeldSession} cell, so it can be replaced under a source that stays in
     * place.
     */
    sharedLiveSourceFor(sn: string, opts?: SharedLiveOpts): Promise<SharedLiveSource>;
    /**
     * Tear down any pull on this station that is lingering for ANOTHER camera, before starting this one.
     *
     * A lingering pull has no consumers but is still held open, and on an attached camera holding it open means
     * re-sending the full media start every keepalive tick. Two channels doing that at once on a station that
     * serves one camera at a time leaves the new stream receiving nothing but the old camera's frames for as
     * long as the linger lasts.
     *
     * Several cameras genuinely being WATCHED together are never disturbed — the linger exists to make
     * re-opening the SAME camera cheap, and it keeps doing that. What it may not do is keep a camera nobody is
     * looking at competing with one somebody just asked for.
     *
     * A snapshot tile is nobody looking. Opening a live view in the Home app takes that cell fullscreen, so the
     * pulls refreshing the other cells are off screen, yet each goes on re-issuing its own media start every
     * retry tick — measured as four pulls warming together off one HomeBase, a live request landing 1.4 s later,
     * and the live consumer receiving nothing beyond the retained keyframe until its deadline fired. So a live
     * request also takes the channel from a sibling held only by snapshots, while a snapshot request takes
     * nothing from anyone: a home page must not fight itself, and a viewer outranks a thumbnail in one
     * direction only.
     */
    private releaseLingeringSiblings;
    /**
     * The channel a live viewer already holds on this station, if any, ignoring `key` itself.
     *
     * A stopped source is skipped even when consumers are still attached to it. A failed start fails its
     * consumers without detaching them, so a caller still holding a dead handle leaves the count non-zero,
     * and counting that as a viewer would refuse every later stream on the station until the client
     * restarted. Only a source that can still deliver holds a place.
     */
    private occupiedSiblingChannel;
    /**
     * Whether the stream on `key` should re-assert its channel to hold the station.
     *
     * A re-assert on an attached camera is a full media start, so it takes the station from whichever camera
     * it was serving. Three answers, in order:
     *
     *  - Nothing attached: no. There is nobody to take the station for.
     *  - A live viewer attached: yes. That is the picture someone is looking at.
     *  - Held only for stills, while a sibling on this station has a live viewer: no. A still refreshes a
     *    tile that is off screen while the live view is on it, and a station serving one camera at a time
     *    cannot satisfy both. Measured: a still on a sibling halved a live view's frame rate for as long as
     *    it took, and its own capture then took fifteen seconds because it was contending.
     *
     * A still with no live sibling re-asserts, so a tile refreshing on a quiet station is
     * unaffected.
     */
    /**
     * Attach a consumer, unless the caller has already abandoned the call.
     *
     * The acquisition it just waited through can outlast the caller's interest, and a consumer attached for
     * somebody who has gone keeps the pull warm for nobody. Detaching immediately gives the pull back, which
     * lets it linger and fall away if this was the only thing holding it, and leaves it untouched if it was
     * not.
     */
    private attachUnlessAborted;
    /** Dispose one cached live source and forget it, so the next acquisition builds a fresh one. */
    private dropLiveSource;
    /**
     * Drop everything that was riding a station's session, and report the station closed.
     *
     * A live source holds the `P2PSession` it was BUILT with and never re-resolves it, so one left cached
     * past its session is handed back to the next viewer over a dead connection: it answers the retained
     * keyframe, then fails on the warm-up deadline. Talkbacks are the same shape. Both are therefore
     * dropped whenever the session under them goes.
     *
     * Reached two ways, both idempotent: the session's own `close` event, when it died while still the
     * station's registered session, and {@link SessionManagerOpts.onAutoClose}, when the manager closed it
     * unasked. A close a CALLER made is deliberately not routed here — {@link closeAll} disposes its own
     * sources first, and {@link replaceUnreachableSession} keeps its source alive on purpose to rewarm it
     * on the replacement session.
     */
    private tearDownStation;
    /**
     * A live start produced no keyframe. Drop the source, and recycle the device's P2P session when doing so
     * is safe.
     *
     * Rebuilding the stream alone is not enough when it is the session, or the per-device state carried on
     * it, that has stopped serving this camera: every later attach builds another stream over the same
     * cached session and fails identically, which is why only a client restart recovered it.
     *
     * What a recycle actually replaces is the `P2PSession` INSTANCE. `close()` discards the manager's entry
     * first and invalidates that connection's level-2 key and sequence; the next acquisition builds a new
     * instance with a new socket, a new RSA keypair offered as `encryptkey`, and fresh sequence windows.
     *
     * The close is issued BEFORE the source is dropped, because discarding the manager entry is synchronous:
     * from that moment a concurrent acquisition resolves a fresh session rather than the doomed one. It would
     * find the not-yet-dropped source in that window, which is exactly why a stopped source is replaced
     * regardless of what is attached to it.
     *
     * Only a **standalone** device's session is recycled, resolved through {@link stationKeyOf} so this and
     * {@link resetStandaloneSession} cannot disagree about what standalone means. An attached camera shares
     * its HomeBase session with every other camera on it, and closing that to recover one would drop the
     * rest, so an attached camera gets the stream rebuild and nothing more. Unlike
     * {@link resetStandaloneSession} this does not wait for the station to fall idle: the failed source's own
     * session user is still counted, so a deferred reset would never fire.
     */
    private onLiveStartFailed;
    /**
     * Replace the session under a warming source whose media start nothing acknowledged, and warm again on it.
     *
     * Only a STANDALONE device's session is replaced, for the reason {@link onLiveStartFailed} gives: an attached
     * camera shares its HomeBase session with every other camera on it, and closing that to recover one would
     * drop the rest. Such a source keeps the re-issue it always had.
     *
     * The source is left warming throughout, holding the deadline it started, so this either produces a stream
     * within that window or fails exactly as it would have. A replacement that cannot be opened leaves the
     * source to its deadline rather than failing it early — the window is the caller's contract.
     */
    private replaceUnreachableSession;
    /**
     * Warn when a caller asks for a shared source with options that disagree with the ones it was built
     * from. A source is created once per `${parentSn}:${channel}` and every later caller simply joins it,
     * so those options are dropped — the failure mode being a battery camera streaming unbounded because
     * whichever egress opened the source first did not pass `powered`. Nothing can be re-applied to a
     * pull that consumers are already attached to, so this reports the conflict rather than pretending to
     * honour it; a source that has since stopped is dropped instead, in {@link sharedLiveSourceFor}.
     */
    private warnIgnoredLiveOpts;
    /**
     * **Continuous fragmented-MP4 recording** — attach a consumer to the device's shared live source and
     * yield CMAF fragments (init segment first, then a `moof`+`mdat` per keyframe boundary) muxed by the
     * dependency-free internal fMP4 muxer. The returned recording handle exposes battery-budget notices
     * and detaches its consumer on `stop`, iterator return, or iterator throw. No ffmpeg.
     */
    recordFragments(sn: string, opts?: {
        fragmentSeconds?: number;
        eccPrivateKey?: Buffer;
        keepAliveMs?: number;
    } & SharedSourceHints): FragmentRecording;
    /**
     * **Generic P2P request/reply query.** Sends a `SET_PAYLOAD` (1350) wrapper carrying `subCmd` on the
     * device channel, then resolves with the reply frame's `payload` — the `NOTIFY_PAYLOAD` (1351)
     * whose JSON `cmd` echoes `subCmd` — decoded off the session `data` event. Needs the level-2 key.
     */
    p2pQuery(sn: string, subCmd: number, opts?: {
        timeoutMs?: number;
    }): Promise<Record<string, unknown>>;
    /**
     * **Generic control-payload request/reply query.** Sends a `CONTROL_PAYLOAD` (1700) `{commandType,
     * data}` (level chosen by topology, like {@link routeControl}), then resolves with the reply
     * frame's `payload` — the `NOTIFY_PAYLOAD` (1351) whose JSON `cmd` echoes `param` — decoded off the
     * session `data` event. The listener is armed BEFORE the send so a fast reply can't race it (same
     * ordering as {@link p2pQuery}).
     */
    p2pControlQuery(sn: string, param: number, data: Record<string, unknown>, opts?: {
        timeoutMs?: number;
    }): Promise<Record<string, unknown>>;
    /**
     * Resolve a scalar `"set-param"` intent to a concrete P2P frame — the ONE place that maps a
     * capability's *what* (param + value + {@link ScalarForm}) to the *how* (encryption level + wire):
     * `"auto"` defers the level to {@link sendBySessionLevel} — the ONE decision point — while
     * `"int-string"` pins L1 and `"direct-binary"` pins L2.
     */
    private resolveScalarParam;
    /**
     * Read the camera's LIVE authoritative RTSP URL — host, path, and the credentials it enforces
     * RIGHT NOW — by writing the publish switch `CMD_NAS_SWITCH` (idempotent when already on, and never
     * touching the credentials themselves, so a NAS/NVR consuming the stream elsewhere is undisturbed)
     * plus `CMD_NAS_TEST` to start the livestream, then awaiting the `rtspUrl` event `P2PSession` emits
     * for a matching-channel `CMD_NAS_SWITCH` push. This is the only source of the freshly-generated
     * credentials: the vendor app regenerates them on every publish toggle and the cloud record lags.
     *
     * Both provokes go through {@link resolveScalarParam} `"auto"` — the ONE level decision — not a
     * pinned level-1 send: a keyed HomeBase publishes 1145 on its level-2 seal, and the level-1 form is
     * silently ignored there (the likely cause of attached-camera reads never answering). The shared
     * path also repeats the datagram for RF resilience, exactly as the normal publish does.
     *
     * A single channel-filtered listener is armed BEFORE the provokes and torn down on either outcome,
     * so a fast push cannot fall in a re-arm gap and a station that never answers leaks nothing. The
     * station is shared by every channel (a HomeBase multiplexes its attached cameras over one session),
     * so a push for another camera is filtered out rather than resolving this read.
     *
     * Bounded by {@link RTSP_URL_READ_TIMEOUT_MS}: the abort covers `resolveSession`'s connect wait and
     * the URL wait. The device/station resolution ahead of them relies on its own HTTP timeouts.
     *
     * `undefined` on any failure: no route, no account id, or no matching push before the deadline.
     */
    readReportedRtspUrl(sn: string): Promise<string | undefined>;
    /**
     * One channel-filtered wait for the station's `rtspUrl` push: a single persistent listener, attached
     * up front and removed on resolve or abort, so nothing leaks and no push falls in a re-arm gap. The
     * station multiplexes every attached camera's channel over one session, so a push for another camera
     * is ignored rather than resolving the wrong read.
     */
    private awaitRtspUrl;
    /**
     * The single point that turns a session into an encryption **level**: level-2 when the session HOLDS a
     * level-2 key, level-1 otherwise. Both the `"auto"` scalar path and the JSON control path route
     * through here, so the rule is defined exactly once.
     *
     * The discriminator is the key, NOT topology, because that is what the app does. Captured across five
     * peers of four device families and both topologies, every peer used ONE seal for every command family
     * it sent — level-2 for each keyed session including two own-session cameras, level-1 only for the two
     * whose negotiation never completes. Reading attachment instead mispredicts those two own-session
     * cameras, and a level-2-only wire chosen for a session that holds no key cannot be sent at all.
     *
     * The key is waited for softly: a session that will not have one falls through to level-1, which is a
     * working wire here rather than a degraded guess, instead of spending a per-call grace to learn that.
     */
    private sendBySessionLevel;
    /**
     * Resolve a device serial to its P2P session + routing params: the HomeBase/parent session for an
     * attached camera or the device's own, its `device_channel`, and the admin account id. Opens the
     * station's P2P session on demand if needed and waits for it to connect, then holds it warm briefly
     * (a command keepalive, so a burst of commands / a follow-up read reuses it instead of paying a fresh
     * handshake — a no-op for a wired/persistent station).
     *
     * `waitLevel2` states what the caller does about the key:
     *
     *  - `true` — cannot frame without it. Waits the full grace, re-prompts once, and throws if refused.
     *  - `"settle"` — picks its seal once from {@link P2PSession.hasLevel2Key}. Waits {@link LEVEL2_SETTLE_MS}
     *    session-scoped for the negotiation to conclude either way, then proceeds. Never throws.
     *  - `"soft"` — frames per send and is re-issued, so it does not wait at all.
     *  - `false` / absent — no wait; enough to read topology.
     *
     * `requireLevel2ForAttached` promotes a `"soft"` caller to `true` on a HomeBase-attached camera, whose media
     * start has no level-1 form at all.
     *
     * A `"soft"` caller frames per send: an own-session start issued with no key rides level 1, and its own
     * re-issue rides level 2 once the key lands. Nothing bounds an unanswered `CMD_GATEWAYINFO`, so a waiting
     * caller's grace is the bound, charged from connect.
     *
     * Only a caller that REQUIRES the key re-prompts — see {@link P2PSession.repromptLevel2Key}, which explains
     * why one settled negotiation is not the last word.
     *
     * A session whose {@link P2PSession.pathAnswering} is false is closed and re-resolved before it is handed
     * over: the station answers every heartbeat, so a path silent past several of them is gone. A session
     * reporting nothing about its path is not reporting that evidence and is handed over as it is. Replaced at
     * most once per resolution, so a station whose replacement is silent too is returned rather than closed
     * again.
     */
    private resolveSession;
    /**
     * Shared machinery for the fire-and-forget **level-2 control senders** (direct-binary, station
     * scalar, set-payload envelope): resolve the device's HomeBase P2P session (waiting for connect +
     * the level-2 key), then replay the one-shot `send` `DIRECT_CMD_SENDS`× at 200ms spacing for RF
     * resilience. If NONE went out (no key / not connected) we throw, so a fully-dropped command
     * surfaces as an error, not a false success.
     *
     * `resolved` lets a caller that already has a {@link ResolvedSession} (e.g. `sendFf09Autolock`,
     * which resolves once up front to arm its GET-reply listener) skip a redundant re-resolve — cheap
     * once the level-2 key is ready (a Map lookup + already-satisfied waits), but still wasted work the
     * MQTT sibling doesn't do. Omit it to resolve fresh, as every other caller does.
     */
    private replayLevel2Send;
    /**
     * **"Direct" binary control command** (camera on/off `1035`, spotlight brightness `1401` / color-temp
     * `1410` / enable `1403`, audio switches): the 136-byte body ({@link buildDirectBinaryBody} with the
     * resolved device channel) on that channel at signCode 8, `outerCmd` = the param id.
     */
    private sendDirectBinary;
    /**
     * **Station-scoped scalar** (`p2p-station-scalar` intent): the 132-byte channel-less body
     * ({@link buildDirectBinaryBody} with no `channel`) on an EXPLICIT channel, signCode 8. The
     * HomeBase's own controls ride the station broadcast channel 255 (alarm/speaker volume 1235).
     */
    private sendStationScalar;
    /** Send a level-1 int-plus-string frame with authenticated account identity injected by the transport. */
    private sendIntString;
    /**
     * **`set-json-raw` intent** — bare JSON, no envelope: outer P2P cmd = `outerCmd` itself, plaintext
     * exactly `{account_id,...data}` (`session.sendRawLevel2` with no wrapper). Reversed from a live
     * capture of the app's own SET_SNOOZE_TIME (1271) frame — see `param-dictionary.ts`'s `1271` entry
     * (`snoozeTime`); the alarm-delay config (1255, `arming.ts`'s `ARMING_CMD.ALARM_DELAY_CONFIG`) reuses
     * the same bare-JSON shape.
     */
    private sendJsonRaw;
    /**
     * **`set-payload` intent** — a `SET_PAYLOAD` (1350) envelope (`{account_id,cmd,mChannel,mValue3:cmd,
     * payload}`). The intent's `channel` is authoritative (resolveSession supplies only the session +
     * account_id) — so a capability that targets a specific channel isn't overridden. `resolved` — see
     * {@link replayLevel2Send}'s doc — lets a caller that already resolved the session skip a redundant
     * re-resolve.
     *
     * **Level follows topology** when `form` is `"auto"`, as in {@link resolveScalarParam}: a
     * HomeBase-attached device takes the GCM signCode-8 form, a standalone one the level-1 form. A
     * standalone camera never negotiates a level-2 key, so pinning this to level 2 makes the envelope
     * unreachable on exactly the devices that serve their own RTSP stream. Verified live: a standalone
     * camera accepts the level-1 form. With no `form` (default) it stays level-2 only.
     */
    private sendSetPayloadEnvelope;
    /**
     * **`ff09-actuate` intent** — build the `ff09` AES-128-CBC frame ({@link buildFf09Frame}, shared with the
     * MQTT transport — see `transport/ff09.ts`) and dispatch it in the `1940` TRANSFER_PAYLOAD envelope
     * (`{apiCommand, lock_payload, seq_num, time}`) as a `set-payload` (1350), `mValue3=0`, on the lock's
     * device channel. This is the P2P envelope; the capability module only supplies identity, never wire
     * bytes and never the routing channel — that's re-resolved here from the device record.
     */
    private sendFf09Actuate;
    /**
     * How long {@link sendFf09Autolock} waits for the device's settings **GET** reply before
     * giving up. Unlike the MQTT sibling (`MqttCommandRouter.dispatchFf09Autolock`, one TCP publish), the P2P
     * GET is replayed `DIRECT_CMD_SENDS`× over ~800ms by {@link sendSetPayloadEnvelope} for RF
     * resilience before this wait even starts counting down the rest — so the budget only needs to cover
     * the reply's own travel time, not the resend window.
     */
    private static readonly FF09_SETTINGS_GET_TIMEOUT_MS;
    /**
     * **`ff09-autolock` intent over P2P** — read-modify-write the T8531's auto-lock setting. The
     * P2P sibling of `MqttCommandRouter.dispatchFf09Autolock`; same GET-then-SET shape, same `ff09`
     * frame/cipher. ✅ LIVE-VERIFIED end-to-end (2026-07-18): `dev.lock()?.setAutoLock(false)` THEN
     * `setAutoLock(true)` driven through this exact codepath against a real T8531, both directions
     * confirmed via the app UI showing autolock off then on afterward — not just byte-exact against a
     * capture. Differs from the MQTT flow only in the envelope + reply matching:
     *
     * Resolves the session ONCE up front (needed to arm the reply listener before sending) and passes it
     * to both `sendSetPayloadEnvelope` calls (GET + SET) — skips the redundant re-resolve each would
     * otherwise do internally (see {@link replayLevel2Send}'s doc).
     *
     *  1. Build the settings GET frame ({@link buildFf09QueryFrame}) and send it the same way
     *     `sendFf09Actuate` sends a lock/unlock — a `1940` TRANSFER_PAYLOAD `set-payload` (1350) on the
     *     lock's device channel. Arm a `session.on("data", …)` listener BEFORE sending (same
     *     arm-before-send ordering as {@link p2pQuery}), matching the reply by `f.json.cmd ===
     *     CMD_TRANSFER_PAYLOAD` (the device's `/res`-equivalent reply always carries this inner cmd,
     *     same as any other transfer-payload traffic on this channel — so `cmd` alone isn't enough) AND
     *     `f.json.payload.time` equal to the GET's own `time`. **Confirmed live (2026-07-17) against a
     *     real T8531 capture: the P2P reply's `time` field is a HEX STRING** (e.g. `"6A5908BD"`),
     *     identical to the MQTT reply's convention — NOT the decimal the outbound `time` field uses. No
     *     reply within {@link FF09_SETTINGS_GET_TIMEOUT_MS} throws (same rationale as the MQTT side:
     *     guessing A7/A8 would be worse than failing loud).
     *  2+3. Decrypt the reply, preserve the current delay (`a2`) + `A7`/`A8` passthrough values (`a4`/
     *     `a5`), and build the SET frame — the decrypt→read→rebuild shared with the MQTT sibling as
     *     `transport/ff09.ts`'s {@link buildFf09AutolockSetFrame} — then send it the same fire-and-forget
     *     way as `sendFf09Actuate` (no ack wait, matching every other P2P write in this router; there is no
     *     `commandAck` event plumbing at this layer — that's an `EufyMega`-level concern the MQTT
     *     dispatcher happens to have because it owns its own MQTT connection lifecycle).
     */
    private sendFf09Autolock;
    /**
     * Shared GET-and-wait step behind both {@link sendFf09Autolock} (which reads to preserve A7/A8 across
     * a write) and {@link getAutoLockState} (which reads for its own sake) — extracted so the two don't
     * drift on the arm-before-send / listener-leak / keyTime-matching machinery. Arms a
     * `session.on("data", …)` listener BEFORE sending the GET (same ordering as {@link p2pQuery}); the
     * `cleanup`/`onData`/`timer` are hoisted out of the Promise executor so the try/catch can tear the
     * listener down if the send itself throws (without it a send failure would leak `onData` on the
     * long-lived shared session for the full timeout window). Matches the reply by inner
     * `cmd === CMD_TRANSFER_PAYLOAD` AND `payload.time` (a hex string live) equal to the GET's own
     * keyTime. Throws if no matching reply arrives within {@link FF09_SETTINGS_GET_TIMEOUT_MS}.
     */
    private fetchFf09SettingsGetReply;
    /**
     * **Read the T8531's current auto-lock settings over P2P** — the `Ff09SettingsReader` behind
     * `dev.lock()?.getAutoLockState()`. A pure GET, no SET: reuses {@link fetchFf09SettingsGetReply} (the
     * same GET step {@link sendFf09Autolock} runs internally to preserve A7/A8), then decrypts + decodes
     * fields `a1`-`a5` per `transport/ff09.ts`'s response tag map (`a1`=enabled, `a2`=delaySeconds,
     * `a3`=isSchedule, `a4`/`a5`=schedule start/end as raw `[hour,minute]` byte pairs — see
     * {@link readFf09HourMinute}'s doc for why these aren't a packed number). Live-verified only insofar
     * as the underlying GET step already is (`setAutoLock`'s own read) — the standalone read path itself
     * has not been independently exercised against a real device yet.
     */
    getAutoLockState(sn: string, cmd: {
        adminUserId: string;
        deviceSn: string;
    }): Promise<AutoLockSnapshot>;
    /**
     * **`ff09-setting-toggle` intent** — the COMPACT single-setting `SET_SETTINGS` write (currently:
     * T8531 Rain Mode, `settingId` = `ff09.ts`'s `FF09_SETTING_ID.RAIN_MODE`). Unlike
     * {@link sendFf09Autolock}, this is a pure blind write — no GET pass, no reply wait — since the
     * compact frame ({@link buildFf09SettingToggleFrame}) only carries the one field being changed, same
     * fire-and-forget shape as {@link sendFf09Actuate}. ✅ LIVE-VERIFIED end-to-end (2026-07-18):
     * `dev.lock()?.setRainMode()` driven through this exact codepath against a real T8531, both
     * directions confirmed via the app UI showing the new state afterward — not just byte-exact against a
     * capture. See `transport/ff09.ts`'s "Rain Mode" doc section. The routing channel is re-resolved from
     * the device record — the capability never supplies it.
     */
    private sendFf09SettingToggle;
    /**
     * Send a level-1 **int+string** command (floodlight/spotlight switch 1400 on IndoorOutdoor /
     * SoloCam-spotlight / Cam2C-3). No level-2 key needed (standalone level-1 ECB). Fire-and-forget,
     * repeated for RF resilience.
     */
    private sendIntStringCommand;
    /**
     * Play the **privacy-mode multi-frame burst** over P2P (the `p2p-privacy-burst` command). Privacy
     * does NOT engage as one frame — the app sends a MULTI-CHANNEL BURST of level-2 (signCode 8) frames.
     * Reversed from a live capture: 1103 precursor on ch255 → 6250 SET on ch0 ×2 → 6250 SET on the
     * camera channel ×3 → 1103 companion on ch0. Every frame is signCode 8 (a signCode-1 header on a
     * GCM body is silently dropped).
     */
    private sendPrivacyBurst;
    /**
     * Route a control command (`{commandType, data}`) to a device over P2P: HomeBase-attached →
     * level-2 GCM (bare plaintext, channel in the frame header), standalone → level-1 ECB. Waits for
     * the session to connect + (for HomeBase) the level-2 key.
     */
    private routeControl;
}
