// Status-bar reading preferences: the "Aa" font/spacing popover and text size.

import type { CSSProperties, ReactElement, RefObject } from "react";

import {
  clampReaderPct,
  nudgeReaderPct,
  READER_FONTS,
  READER_PERCENT_MAX,
  READER_PERCENT_MIN,
  READER_SPACING_UI_MAX,
  READER_SPACING_UI_MIN,
  snapReaderPct,
} from "../readerPrefs";
import { IconCaret, IconCheck } from "./ReaderStatusBar.icons";

/** A CSS class per font id so each list row renders in its own face. */
function fontClass(id: string): string {
  return `emr-font-${id}`;
}

interface PercentSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  fluid?: boolean;
  min?: number;
  max?: number;
  showDefaultMarker?: boolean;
}

function PercentSlider({
  label,
  value,
  onChange,
  fluid = false,
  min = READER_PERCENT_MIN,
  max = READER_PERCENT_MAX,
  showDefaultMarker = true,
}: Readonly<PercentSliderProps>): ReactElement {
  const displayValue = Math.max(min, Math.min(max, value));
  const progress = ((displayValue - min) / (max - min)) * 100;
  const defaultPosition = ((100 - min) / (max - min)) * 100;
  const nudge = (dir: number) =>
    onChange(nudgeReaderPct(displayValue, dir, min, max));
  const style = {
    "--emr-percent-progress": `${progress}%`,
    "--emr-percent-default-position": `${defaultPosition}%`,
  } as CSSProperties;

  return (
    <div
      className={`emr-percent-slider${fluid ? " is-fluid" : ""}`}
      style={style}
    >
      <button
        className="emr-percent-adjust is-minus"
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={displayValue <= min}
        onClick={() => nudge(-1)}
      />
      <span className="emr-percent-track">
        <input
          type="range"
          aria-label={label}
          aria-valuetext={`${displayValue}%`}
          min={min}
          max={max}
          step="1"
          value={displayValue}
          onChange={(event) =>
            onChange(snapReaderPct(Number(event.currentTarget.value), min, max))
          }
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? -1
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? 1
                  : 0;
            if (delta === 0) return;
            event.preventDefault();
            onChange(clampReaderPct(displayValue + delta, min, max));
          }}
        />
        {showDefaultMarker ? (
          <span className="emr-percent-default-marker" aria-hidden="true" />
        ) : null}
      </span>
      <button
        className="emr-percent-adjust is-plus"
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={displayValue >= max}
        onClick={() => nudge(1)}
      />
      <output className="emr-percent-output">{displayValue}%</output>
    </div>
  );
}

/** The "Aa" reading-preferences popover plus the text-size slider. */
// eslint-disable-next-line max-lines-per-function -- Reading preferences popover: font, size, spacing and width controls bound to one preferences object.
export function ReadingPreferencesControls(
  props: Readonly<{
    rootRef: RefObject<HTMLDivElement>;
    triggerRef: RefObject<HTMLButtonElement>;
    popoverRef: RefObject<HTMLDivElement>;
    open: boolean;
    onToggleOpen: () => void;
    availableFonts: readonly (typeof READER_FONTS)[number][];
    effectiveFontId: string;
    hasAlternativeFonts: boolean;
    onFontChange: (fontId: string) => void;
    sizePct: number;
    onSizeChange: (sizePct: number) => void;
    spacingPct: number;
    onSpacingChange: (spacingPct: number) => void;
  }>,
): ReactElement {
  const {
    rootRef,
    triggerRef,
    popoverRef,
    open,
    onToggleOpen,
    availableFonts,
    effectiveFontId,
    hasAlternativeFonts,
    onFontChange,
    sizePct,
    onSizeChange,
    spacingPct,
    onSpacingChange,
  } = props;
  return (
    <div className="emr-statusbar-control-group">
      <div
        ref={rootRef}
        className={`emr-statusbar-type${open ? " is-open" : ""}`}
      >
        <button
          ref={triggerRef}
          type="button"
          className="emr-statusbar-btn"
          aria-haspopup="true"
          aria-expanded={open}
          title="Reading preferences"
          onClick={onToggleOpen}
        >
          <span className="emr-statusbar-aa">Aa</span>
          <IconCaret />
        </button>
        <div
          ref={popoverRef}
          className="emr-statusbar-pop"
          role="group"
          aria-label="Reading preferences"
          aria-hidden={!open}
        >
          {hasAlternativeFonts ? (
            <>
              <div className="emr-statusbar-pop-label">Reading font</div>
              <div className="emr-statusbar-fontlist">
                {availableFonts.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    className={`emr-statusbar-font ${fontClass(font.id)}`}
                    aria-pressed={font.id === effectiveFontId}
                    onClick={() => onFontChange(font.id)}
                  >
                    <span>{font.name}</span>
                    <IconCheck />
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div
            className={`emr-statusbar-pop-section${
              hasAlternativeFonts ? "" : " is-only"
            }`}
          >
            <div className="emr-statusbar-pop-label">Text spacing</div>
            <PercentSlider
              label="Text spacing"
              value={spacingPct}
              onChange={onSpacingChange}
              fluid
              min={READER_SPACING_UI_MIN}
              max={READER_SPACING_UI_MAX}
              showDefaultMarker={false}
            />
          </div>
        </div>
      </div>

      <PercentSlider
        label="Text size"
        value={sizePct}
        onChange={onSizeChange}
      />
    </div>
  );
}
