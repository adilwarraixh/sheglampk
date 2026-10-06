// Mounts handlers/admin/rebuild.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/rebuild.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
