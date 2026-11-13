// Shell: persisted reader preferences and their setters.

import {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { events, track } from "../../telemetry";
import type { DraftScope } from "../draftStorage";
import {
    readReaderPrefs,
    writeReaderPrefs,
    DEFAULT_NAV_WIDTH_PCT,
    DEFAULT_COMMENT_WIDTH_PCT,
    type ReaderPrefs,
} from "../readerPrefs";

type PrefSetting = "font" | "size" | "spacing";

/** Quiet period that folds a slider drag into one `reader.prefChanged`. */
export const PREF_EVENT_COOLDOWN_MS = 3_000;

/**
 * Reader preferences, restored from + persisted to localStorage. Typography
 * (font + size) lives in a shared key so it follows the reader across every
 * surface; panel visibility + nav width are scoped to THIS surface (PR tab vs
 * Documents hub) so their different navigation needs don't bleed into each
 * other.
 */
export function useReaderPrefs(draftScope: DraftScope | undefined) {
    const prefsScope: DraftScope = draftScope ?? "pr";

    const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() => readReaderPrefs(prefsScope));

    useEffect(() => {
        writeReaderPrefs(prefsScope, readerPrefs);
    }, [prefsScope, readerPrefs]);

    const reportPrefChange = usePrefChangeReporter();
    const panels = usePanelToggles(readerPrefs, setReaderPrefs);

    const setReaderFont = useCallback(
        (fontId: string) => {
            reportPrefChange("font");
            setReaderPrefs((p) => ({ ...p, fontId }));
        },
        [reportPrefChange],
    );

    const setReaderSize = useCallback(
        (sizePct: number) => {
            reportPrefChange("size");
            setReaderPrefs((p) => ({ ...p, sizePct }));
        },
        [reportPrefChange],
    );

    const setReaderSpacing = useCallback(
        (spacingPct: number) => {
            reportPrefChange("spacing");
            setReaderPrefs((p) => ({
                ...p,
                lineSpacingPct: spacingPct,
                paragraphSpacingPct: spacingPct,
                letterSpacingPct: spacingPct,
                wordSpacingPct: spacingPct,
            }));
        },
        [reportPrefChange],
    );

    const resetNavWidth = useCallback(
        () =>
            setReaderPrefs((p) => ({
                ...p,
                navWidthPct: DEFAULT_NAV_WIDTH_PCT,
            })),
        [],
    );

    const resetCommentWidth = useCallback(
        () =>
            setReaderPrefs((p) => ({
                ...p,
                commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
            })),
        [],
    );

    // Reveal the comments pane if it's hidden — called when the reader starts (or
    // restores) a comment/reply draft, whose composer lives in the rail, so the
    // pane always shows the moment there is something to write.
    const revealComments = useCallback(
        () => setReaderPrefs((p) => (p.showComments ? p : { ...p, showComments: true })),
        [],
    );

    return {
        readerPrefs,
        setReaderPrefs,
        ...panels,
        setReaderFont,
        setReaderSize,
        setReaderSpacing,
        resetNavWidth,
        resetCommentWidth,
        revealComments,
    };
}

/**
 * Reports a reading-preference change. A slider reports every step it passes,
 * so changes to one setting within {@link PREF_EVENT_COOLDOWN_MS} of each other
 * count once.
 */
function usePrefChangeReporter(): (setting: PrefSetting) => void {
    const lastPrefEventAtRef = useRef(new Map<PrefSetting, number>());

    return useCallback((setting: PrefSetting) => {
        const now = Date.now();
        const last = lastPrefEventAtRef.current.get(setting);
        lastPrefEventAtRef.current.set(setting, now);
        if (last !== undefined && now - last < PREF_EVENT_COOLDOWN_MS) return;
        track(events.readerPrefChanged({ setting }));
    }, []);
}

/** Show/hide the file list, outline and comments panes, reporting each toggle. */
function usePanelToggles(
    readerPrefs: ReaderPrefs,
    setReaderPrefs: Dispatch<SetStateAction<ReaderPrefs>>,
) {
    const { showNav, showOutline, showComments } = readerPrefs;

    const toggleReaderNav = useCallback(() => {
        track(events.panelToggled({ panel: "nav", visible: !showNav }));
        setReaderPrefs((p) => ({ ...p, showNav: !p.showNav }));
    }, [showNav, setReaderPrefs]);

    const toggleReaderOutline = useCallback(() => {
        track(events.panelToggled({ panel: "outline", visible: !showOutline }));
        setReaderPrefs((p) => ({ ...p, showOutline: !p.showOutline }));
    }, [showOutline, setReaderPrefs]);

    const toggleReaderComments = useCallback(() => {
        track(events.panelToggled({ panel: "comments", visible: !showComments }));
        setReaderPrefs((p) => ({ ...p, showComments: !p.showComments }));
    }, [showComments, setReaderPrefs]);

    return { toggleReaderNav, toggleReaderOutline, toggleReaderComments };
}
