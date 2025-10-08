import admin from "firebase-admin";

// Validação das variáveis de ambiente antes de inicializar
if (!process.env.GOOGLE_PROJECT_ID) {
  throw new Error(
    "GOOGLE_PROJECT_ID não está definido. Certifique-se de que o arquivo .env está configurado corretamente."
  );
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

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as any),
  });
}

export const auth = admin.auth();

export async function createCustomToken(uid: string, claims?: any) {
  return admin.auth().createCustomToken(uid, claims);
}

export default admin;
