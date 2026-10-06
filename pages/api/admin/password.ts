// Mounts handlers/admin/password.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/password.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
