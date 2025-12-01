import { Request, Response } from "express";
import googleDriveService from "../services/googleDriveService";

class OAuthController {
  /**
   * GET /oauth/authorize
   * Gera URL de autenticação e redireciona o usuário
   */
  async authorize(req: Request, res: Response) {
    try {
      const authUrl = googleDriveService.getAuthUrl();

      // verify if force OAuth requested (kept for backward compatibility)
      const forceOAuth = req.query.force === "oauth";

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Autenticação Google Drive</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
              color: #4285f4;
              margin-bottom: 20px;
            }
            .btn {
              display: inline-block;
              background: #4285f4;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 4px;
              font-size: 16px;
              margin-top: 20px;
            }
            .btn:hover {
              background: #357ae8;
            }
            .info {
              background: #e8f0fe;
              padding: 15px;
              border-radius: 4px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔐 Autenticação Google Drive</h1>
            <p>Clique no botão abaixo para autorizar o aplicativo a acessar seu Google Drive.</p>
            
            <div class="info">
              <strong>⚠️ Importante:</strong>
              <ul>
                <li>Escolha a conta do Google que você quer usar</li>
                <li>Conceda as permissões solicitadas</li>
                <li>Você será redirecionado de volta automaticamente</li>
              </ul>
            </div>

            ${""}

            <a href="${authUrl}" class="btn">🚀 Autorizar com Google</a>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Erro ao gerar URL de autenticação:", error);
      res.status(500).json({
        error: "Erro ao gerar URL de autenticação",
        details: error.message,
      });
    }
  }

  /**
   * GET /oauth/callback
   * Recebe código de autorização e troca por tokens
   */
  async callback(req: Request, res: Response) {
    try {
      const { code } = req.query;

      if (!code || typeof code !== "string") {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Erro na Autenticação</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .error {
                color: #d32f2f;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="error">❌ Erro na Autenticação</h1>
              <p>Código de autorização não fornecido.</p>
              <p><a href="/oauth/authorize">Tentar novamente</a></p>
            </div>
          </body>
          </html>
        `);
      }

      // Trocar código por tokens
      const tokens = await googleDriveService.getTokensFromCode(code);

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Autenticação Concluída</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
              color: #0f9d58;
            }
            .success {
              background: #e6f4ea;
              padding: 15px;
              border-radius: 4px;
              margin: 20px 0;
            }
            .token-info {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 4px;
              font-family: monospace;
              font-size: 12px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Autenticação Concluída!</h1>
            
            <div class="success">
              <strong>🎉 Sucesso!</strong>
              <p>O Google Drive foi autenticado com sucesso.</p>
              <p>O sistema agora pode fazer upload de customizações de pedidos automaticamente.</p>
            </div>

            <div class="token-info">
              <strong>📝 Informações dos Tokens:</strong><br>
              Access Token: ${
                tokens.access_token ? "✅ Obtido" : "❌ Não obtido"
              }<br>
              Refresh Token: ${
                tokens.refresh_token ? "✅ Obtido" : "❌ Não obtido"
              }<br>
              Expira em: ${
                tokens.expiry_date
                  ? new Date(tokens.expiry_date).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })
                  : "N/A"
              }
            </div>

            <p><strong>Próximos passos:</strong></p>
            <ul>
              <li>Os tokens foram salvos em <code>google-drive-token.json</code></li>
              <li>O sistema renovará automaticamente o access token quando necessário</li>
              <li>Você pode fechar esta janela</li>
            </ul>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Erro no callback OAuth:", error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Erro na Autenticação</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .error {
              color: #d32f2f;
              background: #fdecea;
              padding: 15px;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Erro na Autenticação</h1>
            <div class="error">
              <strong>Detalhes do erro:</strong><br>
              ${error.message}
            </div>
            <p><a href="/oauth/authorize">Tentar novamente</a></p>
          </div>
        </body>
        </html>
      `);
    }
  }

  /**
   * GET /oauth/status
   * Verifica status da autenticação
   */
  async status(req: Request, res: Response) {
    try {
      const status = googleDriveService.getStatus();

      res.json({
        success: true,
        status: {
          configured: status.configured,
          hasAccessToken: status.hasAccessToken,
          hasRefreshToken: status.hasRefreshToken,
          tokenExpiry: status.tokenExpiry,
          isServiceAccount: status.isServiceAccount,
          serviceAccountEmail: status.serviceAccountEmail,
          isExpired: status.tokenExpiry
            ? status.tokenExpiry < new Date()
            : null,
        },
        message: status.configured
          ? "Google Drive configurado e autenticado"
          : "Google Drive NÃO configurado. Execute /oauth/authorize",
      });
    } catch (error: any) {
      console.error("Erro ao verificar status:", error);
      res.status(500).json({
        success: false,
        error: "Erro ao verificar status",
        details: error.message,
      });
    }
  }

  async clear(req: Request, res: Response) {
    try {
      await googleDriveService.clearTokens();
      res.json({
        success: true,
        message: "Tokens limpos. Execute /oauth/authorize para reautenticar.",
      });
    } catch (err: any) {
      console.error("Erro ao limpar tokens:", err);
      res
        .status(500)
        .json({ success: false, message: "Falha ao limpar tokens" });
    }
  }

  /**
   * GET /oauth/debug
   * Retorna informações de debug sobre a autenticação
   */
  async debug(req: Request, res: Response) {
    try {
      const debugInfo = await googleDriveService.debugServiceAccount();

      // Adicionar informações sobre OAuth
      const oauthDebug = {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID
          ? "definido"
          : "NÃO DEFINIDO",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET
          ? "definido"
          : "NÃO DEFINIDO",
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || "NÃO DEFINIDO",
        hasOAuthClient: !!googleDriveService["oauth2Client"],
      };

      res.json({
        serviceAccount: { enabled: false, email: null },
        oauth: oauthDebug,
        debug: debugInfo,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Erro no debug:", err);
      res.status(500).json({
        error: "Erro ao obter informações de debug",
        details: err.message,
      });
    }
  }
}

export default new OAuthController();
