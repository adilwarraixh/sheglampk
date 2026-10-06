// Mounts handlers/products/index.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/products/index.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
