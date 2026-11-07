Real Excalidraw exports. They test the importer against files people actually make; never
edit one to make a test pass. Each file's own `source` field says where it was saved.

- `architecture.excalidraw`, `freehand-frame-image.excalidraw`: saved from https://excalidraw.com
  by the contributor who wrote the importer (PR #97). In `freehand-frame-image`, the picture's
  data was swapped for a 1×1 PNG to keep the file small.
- `db-schema.excalidraw`, `linked-list.excalidraw`: saved from https://www.devtoolsdaily.com's
  Excalidraw editor (`source` is devtoolsdaily.com). The PR doesn't say whether they are the
  contributor's own drawings or that site's examples, so their licence is not stated here.
