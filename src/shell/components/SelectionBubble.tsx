// Small floating popover shown right above the user's selection.
// Currently has one button: "Add comment". Extensible if we add quote-reply,
// "suggest edit", etc.

import * as React from "react";

interface SelectionBubbleProps {
  /** Top in px relative to article-wrap. */
  top: number;
  /** Left in px relative to article-wrap. */
  left: number;
  onAddComment: () => void;
}

export function SelectionBubble(
  props: SelectionBubbleProps,
): React.ReactElement {
  const { top, left, onAddComment } = props;
  return (
    <div
      className="emr-selection-bubble"
      style={{ top, left }}
      // Don't let mousedown clear the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" onClick={onAddComment}>
        <span style={{ fontSize: 13 }}>💬</span>
        Add comment
      </button>
    </div>
  );
}
