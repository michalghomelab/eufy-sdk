import { type Logger } from "../../core/logger.js";
import { type ParamSets } from "./annexb.js";
import type { LiveAudioFrame, LiveStreamConsumer, LiveStreamHandle, LiveVideoConfig, LiveVideoFrame } from "../../core/contracts.js";
/** Lifecycle state of a {@link SharedLiveSource}. */
export type SharedLiveState = "idle" | "warming" | "live" | "lingering" | "stopped";
export interface SharedLiveSourceOptions {
    /**
     * Factory that builds a fresh, **un-started** {@link LiveStreamHandle}. Called on every (re)warm so
     * a reconnect rebuilds the stream rather than reusing a dead one. `SharedLiveSource` calls
     * `.start()` itself.
     *
     * `ctx.reassertWanted` answers whether this pull still has anyone attached. A stream that re-asserts a
     * channel to hold it open should consult it, so a pull nothing is watching stops competing for a station
     * that serves one camera at a time.
     */
    makeStream: (ctx: {
        reassertWanted: () => boolean;
    }) => LiveStreamHandle;
    /** No-consumer grace before teardown (default 8000ms). Distinct from the stream's keepalive. */
    lingerMs?: number;
    /** Per-consumer bounded queue depth; overflow → drop-to-keyframe (default 900 ≈ 30s @ 30fps). */
    maxQueue?: number;
    /** Rolling prebuffer window in seconds, 0 = off (default 0). */
    preBufferSeconds?: number;
    /**
     * Warm-up start retry interval (default 2000ms). After warming, if no keyframe has arrived, the source
     * re-issues the start ({@link LiveStreamHandle.nudge}) every interval — self-healing a start that
     * raced the level-2 key negotiation, independent of any caller keepalive.
     */
    warmRetryMs?: number;
    /**
     * Warm-up deadline (default 20000ms). If no keyframe arrives within it, the source emits `error` to
     * consumers ("failed to start") and tears down, so `live()` never hangs silently on a dead start.
     */
    warmTimeoutMs?: number;
    /**
     * Power source, a runtime device fact (`"battery"` incl. solar, or `"wired"`) — NOT a device family
     * trait; the model derives it from the resolved capability set and passes it through. `"wired"`
     * (default) streams unbounded; `"battery"` bounds a continuous stream to {@link batteryBudgetMs}.
     */
    powered?: "wired" | "battery";
    /** Battery/solar continuous-stream budget before the `budget` notice fires (default 45000ms). */
    batteryBudgetMs?: number;
    /** Grace after the budget notice to call `extend()` before the source auto-stops (default 10000ms). */
    budgetGraceMs?: number;
    /** Diagnostics sink. Omit for silence. */
    logger?: Logger;
    /** Prefix label for log lines (e.g. the `parentSn:channel` key), for multi-source disambiguation. */
    label?: string;
    /**
     * Called when the FIRST consumer attaches (0→1). The router uses this to register the source as a
     * "user" of the station's P2P session (so an active stream cancels the session's idle-detach). Paired
     * with {@link onIdle}. Optional — omit if the caller doesn't manage session lifecycle.
     */
    onActive?: () => void;
    /** Called when the LAST consumer detaches (1→0) — the router releases its session user. See {@link onActive}. */
    onIdle?: () => void;
    /**
     * Called when a stream is torn down having **never delivered a keyframe**, AFTER consumers have been told.
     *
     * A source can only rebuild its stream; it holds a factory, not the session that stream rides on. When
     * the session — or the per-device state carried on it — is what has stopped serving this device, every
     * rebuild starts another stream over the same session and dies the same way, so the owner of the session
     * has to hear about it to do anything else.
     *
     * The condition is deliberately "no keyframe ever arrived", not "the warm-up deadline fired". A start can
     * fail without that deadline being reached — an upstream error or stop can arrive first, the battery
     * budget can stop the pull, and a caller that gives up before the deadline cancels it on the way out
     * (`clearWarmWatch`) — and all of those are the same dead start. Enumerating the ways instead of naming
     * the condition is how the case that actually happens gets left out.
     *
     * Not called by {@link SharedLiveSource.dispose}: the owner asked for that one, and it is the very thing
     * an owner does in response to this callback.
     */
    onStartFailed?: () => void;
    /**
     * A media start was abandoned unacknowledged before anything was delivered, so this session is not being
     * heard. The owner is asked for a replacement and calls {@link SharedLiveSource.rewarm} once it has one.
     *
     * Asked at most once per warm-up: further abandonments are the same session saying the same thing.
     */
    onSessionUnreachable?: () => void;
}
/**
 * A single consumer of a {@link SharedLiveSource}. A {@link LiveStreamConsumer} (so `live()` can hand it
 * back directly), plus the listener removal and arrival-timed feed the recording and readable egresses use.
 */
export interface Consumer extends LiveStreamConsumer {
    /** What this consumer holds the pull for. */
    /** Detach a previously registered listener (mirrors {@link LiveStreamHandle.on}). */
    off(event: "video", listener: (frame: LiveVideoFrame) => void): this;
    off(event: "audio", listener: (frame: LiveAudioFrame) => void): this;
    off(event: "start" | "stop", listener: () => void): this;
    off(event: "error", listener: (err: Error) => void): this;
    /** Subscribe to frames carrying the source-captured arrival time used by the prebuffer. */
    onMedia(listener: (item: TimedMediaFrame) => void): this;
    /** True once the source has replayed a cached keyframe to this consumer (no GOP wait on join). */
    readonly primed: boolean;
    /** Leave the source (refcount--). Idempotent. `stop()` is an alias (LiveStreamHandle). */
    detach(): void;
}
/**
 * One media frame retained with its transport-arrival time for prebuffer continuity.
 *
 * A video frame carries the coded configuration in force when it ARRIVED, because the item outlives that
 * moment: it is the unit a keyframe-prime replays to a consumer that joined later and the unit a prebuffer
 * drain hands over, and both have to announce the configuration their media was coded under rather than
 * whichever one is current by the time they are delivered.
 */
export type TimedMediaFrame = {
    kind: "video";
    frame: LiveVideoFrame;
    timestampMs: number;
    config: LiveVideoConfig;
} | {
    kind: "audio";
    frame: LiveAudioFrame;
    timestampMs: number;
};
export declare class SharedLiveSource {
    private readonly opts;
    private stream?;
    private readonly consumers;
    /** No-consumer teardown grace (arm/cancel on the last-detach / re-attach transition). */
    private readonly lingerTimer;
    private _state;
    private disposed;
    /**
     * What the CURRENT stream generation has delivered — replaced wholesale by every {@link warm}, so a new
     * generation cannot inherit a previous one's evidence and no field can be forgotten in the reset.
     *
     * All three are read together to stage a start failure: `keyframe` is what makes a stream live at all,
     * while `video` and `audio` are what separate a source that produced nothing from one whose units were
     * never decodable and one that is answering with sound and no picture — the three stages of
     * {@link LiveStreamStartError}.
     */
    private delivered;
    /** Last keyframe access unit seen — replayed to a joining consumer (keyframe-prime). */
    private lastKeyframe?;
    /** Last parameter sets the stream announced — see {@link parameterSets}. */
    private lastParamSets?;
    /**
     * The geometry the parameter sets in force state, and the sets it was read from.
     *
     * Holding the sets it came from is what keeps the read to one per announcement: `updatedParamSets`
     * returns the SAME object when a frame announces nothing, so identity says the geometry cannot have
     * moved without comparing any bytes.
     */
    private declaredGeometry?;
    private configuredFrom?;
    /** Rolling prebuffer, keyframe-alignable on drain. */
    private ring;
    /** Warm-up start-retry ticker (interval) + single-shot deadline; cleared once the first keyframe arrives. */
    private warmRetryTimer?;
    /** Whether this warm-up has already asked its owner to replace the session. */
    private sessionReplacementAsked;
    /**
     * Whether the pending watch is a REUSE watch, which any frame settles.
     *
     * A cold warm-up needs a keyframe: nothing can be decoded without one. A join already holds the retained
     * keyframe, so what its watch is missing is evidence the stream is still being served — and a delta frame is
     * that evidence. Requiring a keyframe there let the deadline outlive an actively delivering stream whose
     * group of pictures is longer than the window, and the timeout fails EVERY consumer.
     */
    private reuseWatch;
    /** This source's opaque handle for tracing — see {@link SharedLiveSource.trace}. */
    private readonly traceId;
    /**
     * How many re-issues this watch has spent with nothing arriving since it was armed.
     *
     * What a stream delivered BEFORE the current watch is no evidence about now — a reused stream's upstream may
     * have served plenty and since been dropped by the station, and the retained keyframe replayed to a joining
     * consumer says nothing either. Only a frame arriving after the watch was armed does, and {@link delivered}
     * is reset to track exactly that.
     *
     * The first re-issue is therefore a keepalive: a reuse cannot yet know which case it is in, and a keepalive
     * is right where the station is still serving and harmless where it is not. A second one due with nothing
     * arrived is the answer — no bound of its own, the retry's own cadence.
     */
    private fruitlessReissues;
    private readonly warmDeadlineTimer;
    private warmAttempts;
    /** Battery budget timer + post-notice grace timer (battery/solar sources only). */
    private readonly budgetTimer;
    private readonly budgetGraceTimer;
    private readonly lingerMs;
    private readonly maxQueue;
    private readonly preBufferMs;
    private readonly warmRetryMs;
    private readonly warmTimeoutMs;
    private readonly powered;
    private readonly batteryBudgetMs;
    private readonly budgetGraceMs;
    private readonly logger;
    private readonly tag;
    constructor(opts: SharedLiveSourceOptions);
    get state(): SharedLiveState;
    get consumerCount(): number;
    /**
     * The parameter sets (SPS/PPS, plus VPS for H.265) most recently announced on this stream, or
     * `undefined` before any have been seen.
     *
     * A camera commonly sends them ONCE, with the first keyframe of a stream. Every later access unit is
     * then undecodable in isolation, so a consumer that collects a burst — and cannot see frames from
     * before it joined — has no way to recover them. This source watches every frame from stream start,
     * which makes it the only holder of the answer. A caller re-emits them ahead of its collected burst.
     *
     * Cleared when the stream is torn down, so a rebuilt stream never primes a burst with a dead stream's sets.
     */
    get parameterSets(): ParamSets | undefined;
    /**
     * Attach a new consumer. Warms the stream on the first attach (or cancels a pending linger teardown
     * and reuses the warm stream), then replays the cached keyframe so the consumer can decode at once.
     */
    attach(): Consumer;
    /**
     * Attach at the same instant a keyframe-aligned prebuffer snapshot is taken. The returned consumer
     * is not separately keyframe-primed, so replaying `buffered` followed by its live events neither
     * duplicates the newest IDR nor leaves a gap at the handoff.
     */
    attachWithPrebuffer(seconds: number): {
        consumer: Consumer;
        buffered: TimedMediaFrame[];
    };
    private attachConsumer;
    /**
     * Emit a live trace under this source's opaque handle — `pull-N` by order of construction in this process.
     *
     * Not {@link SharedLiveSourceOptions.label}, which is the router's `stationSn:channel` key: that is a serial,
     * and a serial in a retained record survives every redaction a host applies.
     */
    private trace;
    /**
     * Build the underlying stream, wire its frames into the fan-out, and start it.
     *
     * Every warm goes through here, so a source that is rebuilt on a replacement session listens on exactly
     * the events the first attempt did.
     */
    private openStream;
    /**
     * Build + start the underlying stream, wire its frames into the fan-out, and watch the warm-up.
     */
    private warm;
    /**
     * A start was abandoned unacknowledged. Ask for a replacement session where nothing has been delivered yet.
     *
     * The abandonment is roughly twenty byte-identical sends with no reply, against acknowledgement latencies of
     * 4–37 ms awake and 238 ms waking, so it is the session that is not being heard rather than a slow device —
     * `P2PSession` says as much: the camera was never told to stream, so this warm-up can only time out. Where
     * media has already flowed the abandonment means something else and this does nothing.
     *
     * The retry ticker is stopped while a replacement is awaited, because every tick it issues goes to the same
     * unheard session. The DEADLINE is left running: the window belongs to the attempt, not to the session it
     * started on.
     */
    private onStartUnacknowledged;
    /**
     * Warm again on a session the owner has replaced, inside the deadline the first attempt started.
     *
     * The previous stream is dropped rather than stopped through the state machine: it speaks to a session that
     * is gone, and its `stop` would be read as an upstream end. Only a warm-up that asked for a replacement
     * rewarms, so this is inert on a source that is streaming or has already failed.
     */
    rewarm(): void;
    /**
     * Arm the deadline a stream must deliver within, and the ticker that re-issues its start until it does.
     *
     * The deadline is armed before the ticker so that a retry falling on the same instant as the deadline is
     * never issued, which keeps `attempts` on {@link LiveStreamStartError} equal to the number of media starts
     * actually sent. A stream with no `nudge` cannot be retried, so its watch stays at one attempt however long
     * the deadline is.
     */
    private armWarmWatch;
    /**
     * Re-issue this stream's media start, asking for a REAL start while nothing has arrived.
     *
     * On an own-session camera a re-issue is a keepalive once the session believes the channel is started, and
     * that belief outlives a station which acknowledged a start and then served nothing: every later re-issue is
     * then a keepalive holding a stream that was never started. Nothing arriving since this watch was armed, across
     * more than one re-issue, is this source's own evidence that the channel is not being served — see
     * {@link fruitlessReissues} for why one is not enough and why what the stream delivered earlier is not
     * evidence. Once media arrives the keepalive is what is wanted, and an attached camera re-sends a full start
     * either way.
     */
    private reissueStart;
    /**
     * Watch a stream this consumer joined rather than warmed, so a dead one cannot pass for a live one.
     *
     * A reused stream hands a joining consumer the retained keyframe at once, which is evidence about the past:
     * it says the stream WAS being served, not that it still is. A caller commits to media on that frame — a
     * process, a negotiated session — so a stream the station has quietly stopped serving strands it with no
     * deadline, because warming is what arms one and a reuse skips warming by definition.
     *
     * The watch is the warm-up's own, deadline and retry alike, and the first frame to arrive AFTER the join
     * clears it, that being the only frame which says the stream is still being served. A stream still serving
     * clears it long before the deadline fires; one that is not fails its consumers exactly as a cold start that
     * never delivered would.
     *
     * The start is re-issued at once and then on the retry's cadence, because a station that stopped serving a
     * channel when its last consumer left is the very case the retry recovers: waiting the whole window to
     * report what one re-issued start can fix is a timeout where a stream was available.
     *
     * Nothing is armed while a watch is already pending, so several consumers joining one reused stream share the
     * watch the first of them started.
     */
    private watchReusedStream;
    /** Arm the battery budget timer (battery/solar sources) — replaces any pending budget/grace. */
    private armBudget;
    private clearBudget;
    /**
     * Battery budget elapsed: notify consumers (with an {@link StreamBudgetNotice.extend} handle) and arm
     * the grace timer. If no one extends within the grace, auto-stop the pull to protect the battery.
     */
    private onBudgetExpire;
    /** Re-push the battery budget (host called `extend()` from the notice), cancelling the auto-stop. */
    private extendBudget;
    /** Settle a reuse watch on any frame — the join already holds a decodable picture. */
    private settleReuseWatch;
    /** Stop the warm-up retry + deadline (the stream is confirmed live). */
    private clearWarmWatch;
    /**
     * No keyframe within the warm-up window — surface a start failure to consumers, tear down, and report the
     * failed start to the owner (see {@link SharedLiveSourceOptions.onStartFailed}) so it can recycle what
     * this source cannot reach.
     */
    private onWarmTimeout;
    /**
     * The typed failure for a start that produced no keyframe, staged by what the source did deliver: nothing
     * at all, audio without a single video frame, or access units a decoder cannot begin at.
     *
     * Video takes precedence when both arrived: audio alongside video says nothing a caller needs, while video
     * without a keyframe does.
     */
    private startFailure;
    private onVideo;
    /**
     * The coded configuration this frame belongs to: what the parameter sets state, or the frame header's own
     * report where they state nothing readable.
     *
     * The parameter sets are preferred because they define the size a decoder produces while the header only
     * reports it. The fMP4 muxer prefers them for the same reason, though it answers from the sets ONE unit
     * carried rather than from the sets in force, so the two can differ on a keyframe that re-states only a
     * PPS — a muxer is handed frames, not this source's fold.
     *
     * Falling back rather than staying silent is what lets a consumer act on the announcement alone. A set
     * whose geometry cannot be read would otherwise leave it with nothing to rebuild on, which is worse than
     * the header it would have had to diff for itself.
     *
     * Only a keyframe carries parameter sets, so the read costs one parse per announcement: `updatedParamSets`
     * answers with the same object when a frame announces none, and identity settles it from there.
     */
    private configOf;
    private onAudio;
    /**
     * Retain the rolling window, trimmed to the same run a full-window drain asks for.
     *
     * Retention and drain obey one rule, because a ring trimmed tighter than the drain's rule cannot
     * answer it — the media would already be gone. That rule is {@link windowStart}.
     *
     * A keyframe is the only place a run may begin, so it is also the only anchor a time-based trim has. A
     * stream that stops coding them keeps its last decodable run until another keyframe gives the trim
     * somewhere safe to move to: a separate frame-count ceiling would override the configured window, and
     * cutting mid-group would leave retained media no decoder can start from.
     */
    private pushRing;
    /**
     * Drain the rolling prebuffer: a decodable run covering the last `seconds` of retained media, capped
     * at the configured `preBufferSeconds`. Asking for none hands over none. The host decides when to
     * drain (e.g. on a motion event) and where to send it.
     *
     * The run opens on the newest keyframe at or before the window starts, so it covers the whole request
     * and over-delivers by however far back that keyframe sits — one keyframe interval on a steady stream,
     * more where delivery stalled, since retention is timed on arrival and a frame carries no device clock.
     * Beginning inside the window instead would under-deliver by that same distance, which on a short window
     * is most of it, and a decoder allows no third option.
     */
    ringBuffer(seconds: number): LiveVideoFrame[];
    private bufferedMedia;
    /**
     * Where a decodable run covering everything from `cutoff` onwards begins in the ring.
     *
     * The newest keyframe at or before `cutoff` is that place: it is the latest point a decoder can start
     * from and still produce every frame in the window. When the ring reaches no further back than the
     * cutoff, its oldest keyframe is the most of the window that exists. When it holds no keyframe at all,
     * nothing in it is decodable and index `0` reports that to the caller, which checks.
     */
    private windowStart;
    private isKeyframe;
    /**
     * Handle a consumer leaving. When the last one detaches (1→0), release the station-session user via
     * {@link SharedLiveSourceOptions.onIdle} (its own longer idle timer then arms) and arm the stream's
     * linger teardown.
     */
    private onDetach;
    /** Refcount hit zero — arm the linger teardown. A new attach in the window cancels it. */
    private arm;
    /**
     * Stop + drop the underlying stream and clear the prime/ring caches. Rebuildable via attach().
     *
     * The stream reference is dropped BEFORE stopping it, because `stop()` emits `"stop"` synchronously and
     * this source listens for that — so stopping re-enters `teardown` through {@link onUpstreamEnd}. Clearing
     * first makes that re-entry hit the `!this.stream` guard and return, which is what keeps a single
     * teardown from reporting a failed start twice (and, before that report existed, from tearing down twice).
     *
     * `report` is false only for {@link dispose}: the owner asked for that one.
     */
    private teardown;
    /**
     * Underlying stream ended unexpectedly (station max-duration / reconnect): tell consumers.
     *
     * An end before the first keyframe is also a failed start, so those consumers get the typed `error`
     * explaining why nothing played and then the `stop` that closes them — a bare `stop` would look like a
     * normal end of stream to a caller still waiting for its first frame.
     *
     * Teardown runs even if notifying a consumer throws, because what it releases — the upstream stream, the
     * warm-up timers, the ring — belongs to this source and not to the caller whose listener raised. The throw
     * itself still propagates: a listener that raises is the caller's defect to see, not this source's to
     * swallow.
     */
    private onUpstreamEnd;
    /** Underlying stream failed: tell consumers, then tear down regardless (see {@link onUpstreamEnd}). */
    private onUpstreamError;
    /**
     * Permanent shutdown (session close / router closeAll). Consumers get `stop`; no rebuild.
     *
     * Releases the session user when consumers were still attached: {@link SharedLiveSourceOptions.onActive}
     * fired on the 0→1 transition, and this is the 1→0 one, so skipping it would leave the station pinned
     * open for a source that can never serve anyone again.
     */
    dispose(): void;
}
