// Mounts handlers/admin/import.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/import.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
