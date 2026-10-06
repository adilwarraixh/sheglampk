// Mounts handlers/orders.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../handlers/orders.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
