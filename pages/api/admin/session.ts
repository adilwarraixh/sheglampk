// Mounts handlers/admin/session.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/session.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
