// Workers Static Assets limits for one media release
// (docs/integration.md, "Assets and cost boundaries"): a safety margin below
// the Workers Free file count, and the per-file size limit. The host ignores
// HTTP Range, so every file is downloaded whole.
export const MEDIA_MAX_FILES=19000;
export const MEDIA_MAX_FILE_BYTES=25*1024*1024;

/** Throws when a release of these files (plus its manifest.json) would not fit. */
export function checkMediaLimits(files){
  if(files.length+1>MEDIA_MAX_FILES)throw Error(`Static Assets free file budget exceeded: ${files.length+1} files with manifest.json (${MEDIA_MAX_FILES.toLocaleString('en')} safety limit)`);
  const large=files.find(file=>file.bytes>MEDIA_MAX_FILE_BYTES);
  if(large)throw Error(`Static Assets file exceeds 25 MiB: ${large.path}`);
}
