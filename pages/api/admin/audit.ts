// Mounts handlers/admin/audit.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/audit.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
