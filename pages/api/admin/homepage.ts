// Mounts handlers/admin/homepage.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/homepage.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
