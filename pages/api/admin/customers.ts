// Mounts handlers/admin/customers.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/customers.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
