// Mounts handlers/forms.js unchanged; lib/http.js reads and limits the body itself.
export { default } from "../../handlers/forms.js";
export const config = { api: { bodyParser: false, responseLimit: false } };
