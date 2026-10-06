// Mounts handlers/cron/refresh.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/cron/refresh.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
