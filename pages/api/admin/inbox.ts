// Mounts handlers/admin/inbox.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/inbox.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
