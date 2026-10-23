/** True in the self-contained preview build (no server behind it). */
export const PREVIEW = import.meta.env.VITE_PREVIEW === "1";
export const PREVIEW_MESSAGE = "Not available in this preview. It needs the full app running on a server.";
