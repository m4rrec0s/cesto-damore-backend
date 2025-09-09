"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromDrive = exports.uploadToDrive = void 0;
const googleapis_1 = require("googleapis");
const stream_1 = require("stream");
const credentials = {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};
// Retorna uma instância do Drive usando OAuth2 (se houver refresh token configurado)
// ou a Service Account (GoogleAuth) como fallback.
async function getDriveClient() {
    // Se o usuário fornecer credenciais OAuth (client id/secret + refresh token), usa OAuth2
    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
        const oAuth2Client = new googleapis_1.google.auth.OAuth2(oauthClientId, oauthClientSecret, process.env.GOOGLE_OAUTH_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob");
        oAuth2Client.setCredentials({ refresh_token: oauthRefreshToken });
        return googleapis_1.google.drive({ version: "v3", auth: oAuth2Client });
    }
    // Fallback: service account
    const auth = new googleapis_1.google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
    });
    return googleapis_1.google.drive({ version: "v3", auth });
}
// envia um buffer para a pasta configurada e torna o arquivo acessível via uma URL pública simples
const uploadToDrive = async (buffer, originalName, mimeType) => {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "1nOpUiLTz9WYx2wwNTsTUwapXnPnGhu_R";
    const drive = await getDriveClient();
    // Verifica acesso à pasta antes de tentar criar arquivo
    try {
        await drive.files.get({
            fileId: folderId,
            fields: "id,name,driveId",
            supportsAllDrives: true,
        });
    }
    catch (err) {
        throw new Error(`Não foi possível acessar a pasta do Drive (ID=${folderId}). Certifique-se de que: ` +
            `1) É um Shared Drive OU a pasta foi compartilhada com o e-mail da service account (${process.env.GOOGLE_CLIENT_EMAIL}); ` +
            `2) A service account tem permissão de 'Editor'; ` +
            `3) Se não usar Shared Drive, considere usar OAuth (definir GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN). Erro original: ${err.message}`);
    }
    const fileMetadata = {
        name: `${Date.now().toString()}-${originalName}`,
        parents: [folderId],
    };
    const media = {
        mimeType,
        body: stream_1.Readable.from(buffer),
    };
    // drive já obtido acima
    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id,mimeType,name",
        supportsAllDrives: true,
    });
    const fileId = response.data.id;
    // torna o arquivo legível publicamente
    await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
    });
    // retorna URL direta para uso em <img>
    return `https://drive.google.com/uc?id=${fileId}`;
};
exports.uploadToDrive = uploadToDrive;
const deleteFromDrive = async (fileId) => {
    const drive = await getDriveClient();
    await drive.files.delete({ fileId, supportsAllDrives: true });
};
exports.deleteFromDrive = deleteFromDrive;
