// Mounts handlers/admin/orders/index.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../../handlers/admin/orders/index.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
