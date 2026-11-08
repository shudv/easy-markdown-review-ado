// Host handshake retry for `SDK.init()`.
//
// The extension SDK sends the `initialHandshake` to the host but never handles
// its rejection. When the host answers "The registered object
// DevOps.HostControl could not be found." — seen in production 10–550 ms into
// boot, mostly in preloaded / hidden frames, i.e. before the host page has
// registered its control object or while it tears the frame down — that
// rejection escapes as an unhandled rejection and `init()` never settles, so
// boot hangs behind the host's loading spinner.
//
// `initWithHandshakeRetry` owns that rejection: it re-sends the handshake a few
// times, and if every attempt is refused it rejects with a
// `HostHandshakeError`, so boot fails visibly with ONE blocking report instead
// of an unhandled crash plus a silent hang. SDK-free: the real `SDK.init` is
// injected by the entry points.

import { claimUnhandledRejections } from "../telemetry";

/** Waits before each re-sent handshake; one more refusal than this gives up. */
export const HANDSHAKE_RETRY_DELAYS_MS: readonly number[] = [250, 1_000, 3_000];

const HOST_CONTROL_MISSING = /registered object DevOps\.HostControl could not be found/;

/** Is `reason` the host refusing the SDK handshake (no `DevOps.HostControl`)? */
export function isHostHandshakeRejection(reason: unknown): boolean {
    const message =
        typeof reason === "object" && reason !== null
            ? (reason as { message?: unknown }).message
            : reason;

    // Stryker disable next-line ConditionalExpression: `RegExp.test` stringifies a non-string message (a number, undefined, an object), and none of those reads as the host's refusal text
    return typeof message === "string" && HOST_CONTROL_MISSING.test(message);
}

/** Every handshake attempt was refused by the host. */
export class HostHandshakeError extends Error {
    constructor(readonly attempts: number) {
        super(
            `The Azure DevOps host refused the extension handshake ${attempts} times ` +
                "(DevOps.HostControl is not registered).",
        );
        this.name = "HostHandshakeError";
        Object.setPrototypeOf(this, HostHandshakeError.prototype);
    }
}

type RejectionListener = (reason: unknown) => void;

function windowRejections(listener: RejectionListener): () => void {
    const onRejection = (event: PromiseRejectionEvent): void => listener(event.reason);

    window.addEventListener("unhandledrejection", onRejection);

    return () => window.removeEventListener("unhandledrejection", onRejection);
}

export interface HandshakeRetryDeps {
    /** `SDK.init(...)`: resolves on a successful handshake, never on a refusal. */
    init: () => Promise<void>;
    /** Subscribe to the page's unhandled rejections. Default: `window`. */
    subscribeRejections?: (listener: RejectionListener) => () => void;
    /** Keep claimed rejections out of the global handler. Default: telemetry's. */
    claim?: (predicate: (reason: unknown) => boolean) => () => void;
    delaysMs?: readonly number[];
}

/**
 * Run `init`, re-sending it after each host refusal (see the module header).
 * Resolves on the first successful handshake; rejects with a
 * {@link HostHandshakeError} once `delaysMs.length + 1` attempts were refused,
 * or with `init`'s own error should it ever reject.
 */
export function initWithHandshakeRetry(deps: HandshakeRetryDeps): Promise<void> {
    const {
        init,
        subscribeRejections = windowRejections,
        claim = claimUnhandledRejections,
        delaysMs = HANDSHAKE_RETRY_DELAYS_MS,
    } = deps;

    return new Promise<void>((resolve, reject) => {
        let refusals = 0;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const release = claim(isHostHandshakeRejection);

        const settle = (outcome: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            release();
            outcome();
        };

        const attempt = (): void => {
            init().then(
                () => settle(resolve),
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passes init's own rejection through unchanged
                (err: unknown) => settle(() => reject(err)),
            );
        };

        const unsubscribe = subscribeRejections((reason) => {
            if (!isHostHandshakeRejection(reason)) return;
            refusals += 1;

            if (refusals > delaysMs.length) {
                settle(() => reject(new HostHandshakeError(refusals)));

                return;
            }

            timer = setTimeout(attempt, delaysMs[refusals - 1]);
        });

        attempt();
    });
}
