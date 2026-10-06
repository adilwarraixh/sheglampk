// Mounts handlers/admin/dashboard.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/dashboard.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
