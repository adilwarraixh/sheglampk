// Mounts handlers/media/[id].js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../../handlers/media/[id].js";
export const config = { api: { bodyParser: false, responseLimit: false } };
