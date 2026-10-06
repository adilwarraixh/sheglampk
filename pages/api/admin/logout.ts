// Mounts handlers/admin/logout.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/logout.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
