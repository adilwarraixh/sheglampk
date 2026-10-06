// Mounts handlers/admin/inventory.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/inventory.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
