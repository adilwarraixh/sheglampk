// Mounts handlers/admin/products/[id].js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../../handlers/admin/products/[id].js";
export const config = { api: { bodyParser: false, responseLimit: false } };
