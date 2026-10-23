/** True in the self-contained preview build (no server behind it). */
export const PREVIEW = import.meta.env.VITE_PREVIEW === "1";
export const PREVIEW_MESSAGE = "Not available in this preview. It needs the full app running on a server.";
/** Typing-test-only build: no navigation to server features at all. */
export const TOOL = import.meta.env.VITE_TOOL === "1";
