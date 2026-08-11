export { detectOutputType } from "./detect";
export { compressByType } from "./compress";
export { compressRawText } from "./compressors/raw-text";
export type { OutputType, OutputTypeResult } from "./types";
export type { OutputTypeCompressor } from "./registry";
export { createOutputTypeRegistry } from "./registry";
