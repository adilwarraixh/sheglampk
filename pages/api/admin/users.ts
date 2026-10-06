// Mounts handlers/admin/users.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/users.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
