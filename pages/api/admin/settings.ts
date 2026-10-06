// Mounts handlers/admin/settings.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/settings.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
