# Review workflow design

This document embeds Excalidraw drawings as ordinary Markdown images. The
reader fetches each `.excalidraw` scene from the repository and renders it to
an SVG, so authors keep editable source files next to the docs.

## Review flow

![Review flow from author to reviewer](./diagrams/review-flow.excalidraw)

Authors open a pull request and reviewers comment on the rendered document.

## Broken drawing

The next image points at an `.excalidraw` file that is not valid JSON. It
should show the "Image unavailable" frame instead of breaking the page.

![Broken drawing](./diagrams/broken.excalidraw)

## Missing drawing

![Missing drawing](./diagrams/does-not-exist.excalidraw)

## Comment lifecycle

![Comment thread lifecycle](./diagrams/comment-lifecycle.excalidraw)

A thread starts as a draft, becomes active when posted, and can be resolved or
reopened.
