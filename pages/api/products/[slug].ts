// Mounts handlers/products/[slug].js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/products/[slug].js";
export const config = { api: { bodyParser: false, responseLimit: false } };
