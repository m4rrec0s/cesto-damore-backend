"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
exports.createCustomToken = createCustomToken;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// Validação das variáveis de ambiente antes de inicializar
if (!process.env.GOOGLE_PROJECT_ID) {
    throw new Error("GOOGLE_PROJECT_ID não está definido. Certifique-se de que o arquivo .env está configurado corretamente.");
}
const serviceAccount = {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID, // Client ID do Service Account, não do OAuth
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};
if (!firebase_admin_1.default.apps.length) {
    firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert(serviceAccount),
    });
}
exports.auth = firebase_admin_1.default.auth();
async function createCustomToken(uid, claims) {
    return firebase_admin_1.default.auth().createCustomToken(uid, claims);
}
exports.default = firebase_admin_1.default;
