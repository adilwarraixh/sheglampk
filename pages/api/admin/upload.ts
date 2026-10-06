// Mounts handlers/admin/upload.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/admin/upload.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
