/**
 * Browser-only file download.
 *
 * Kept out of `fileParser.ts` so that module stays free of DOM globals: the
 * server compiles `logic/` and `types/` directly (see server/tsconfig.json), so
 * the vendor-file parsing and the import pipeline are literally the same code on
 * both sides. Anything touching `document` or `Blob` has to live here instead.
 */
export function saveFile(fileName: string, bytes: Uint8Array): void {
  saveBlob(fileName, new Blob([bytes as unknown as BlobPart]));
}

/** Save an already-built Blob (e.g. a server-streamed .xlsx export). */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
