// Mounts handlers/track.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../handlers/track.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
