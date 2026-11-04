// Popover focus/inert and Escape handling shared by status-bar popovers.

import * as React from "react";

export function useInertPopover(open: boolean): {
  triggerRef: React.RefObject<HTMLButtonElement>;
  popoverRef: React.RefObject<HTMLDivElement>;
  restoreFocusAfterClose: () => void;
} {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef(false);
  const restoreFocusAfterClose = React.useCallback(() => {
    restoreFocusRef.current = true;
  }, []);

  React.useLayoutEffect(() => {
    popoverRef.current!.inert = !open;
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  return {
    triggerRef,
    popoverRef,
    restoreFocusAfterClose,
  };
}

export function handlePopoverEscape(
  event: KeyboardEvent,
  restoreFocusAfterClose: () => void,
  close: () => void,
): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  restoreFocusAfterClose();
  close();
}
