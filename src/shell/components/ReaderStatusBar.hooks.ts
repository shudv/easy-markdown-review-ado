// Popover focus/inert and Escape handling shared by status-bar popovers.

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

export function useInertPopover(open: boolean): {
  triggerRef: RefObject<HTMLButtonElement>;
  popoverRef: RefObject<HTMLDivElement>;
  restoreFocusAfterClose: () => void;
} {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const restoreFocusAfterClose = useCallback(() => {
    restoreFocusRef.current = true;
  }, []);

  useLayoutEffect(() => {
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
