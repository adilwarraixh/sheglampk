// Mounts handlers/notifications/retry.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/notifications/retry.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
