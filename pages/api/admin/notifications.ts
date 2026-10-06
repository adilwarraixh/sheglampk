// Mounts handlers/admin/notifications.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/notifications.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
