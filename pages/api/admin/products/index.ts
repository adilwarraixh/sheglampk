// Mounts handlers/admin/products/index.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../../handlers/admin/products/index.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
