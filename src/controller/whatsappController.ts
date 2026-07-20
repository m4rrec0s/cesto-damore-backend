import { Request, Response } from "express";
import whatsappService from "../services/whatsappService";
import logger from "../utils/logger";

class WhatsAppController {
  

  async testMessage(req: Request, res: Response) {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          error: "Mensagem não fornecida",
        });
      }

      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente WAHA_API_KEY, WAHA_API_URL, etc.",
        });
      }

      const sent = await whatsappService.sendMessage(message);

      if (sent) {
        return res.json({
          success: true,
          message: "Mensagem enviada com sucesso",
        });
      } else {
        return res.status(500).json({
          success: false,
          error: "Falha ao enviar mensagem",
        });
      }
    } catch (error: any) {
      logger.error("Erro ao testar mensagem WhatsApp:", error);
      return res.status(500).json({
        error: "Erro ao testar mensagem",
        message: "Erro interno do servidor",
      });
    }
  }

  

  async checkStock(req: Request, res: Response) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 5;

      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente para habilitar notificações",
        });
      }

      const result = await whatsappService.checkAndNotifyLowStock(threshold);

      return res.json({
        success: result.checked,
        alerts_sent: result.alerts_sent,
        errors: result.errors,
        message: `Verificação concluída. ${result.alerts_sent} alertas enviados.`,
      });
    } catch (error: any) {
      logger.error("Erro ao verificar estoque:", error);
      return res.status(500).json({
        error: "Erro ao verificar estoque",
        message: "Erro interno do servidor",
      });
    }
  }

  

  async sendStockSummary(req: Request, res: Response) {
    try {
      if (!whatsappService.isConfigured()) {
        return res.status(503).json({
          error: "WhatsApp não configurado",
          message:
            "Configure as variáveis de ambiente para habilitar notificações",
        });
      }

      const sent = await whatsappService.sendStockSummary();

      if (sent) {
        return res.json({
          success: true,
          message: "Resumo de estoque enviado com sucesso",
        });
      } else {
        return res.status(500).json({
          success: false,
          error: "Falha ao enviar resumo",
        });
      }
    } catch (error: any) {
      logger.error("Erro ao enviar resumo:", error);
      return res.status(500).json({
        error: "Erro ao enviar resumo",
        message: "Erro interno do servidor",
      });
    }
  }

  

  async getConfig(req: Request, res: Response) {
    try {
      const isConfigured = whatsappService.isConfigured();

      return res.json({
        configured: isConfigured,
        message: isConfigured
          ? "WhatsApp está configurado e pronto para uso"
          : "WhatsApp não configurado. Adicione as variáveis de ambiente necessárias.",
        required_env_vars: [
          "WAHA_API_KEY",
          "WAHA_API_URL",
          "WAHA_INSTANCE",
          "WHATSAPP_GROUP_ID",
        ],
      });
    } catch (error: any) {
      logger.error("Erro ao verificar configuração:", error);
      return res.status(500).json({
        error: "Erro ao verificar configuração",
        message: "Erro interno do servidor",
      });
    }
  }

  // ── WhatsApp Auth Page (QR Code) ────────────────────────────────────

  authPage(_req: Request, res: Response) {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp Auth — Cesto d'Amore</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0f0f0f;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 4px;
    }

    .subtitle {
      text-align: center;
      color: #a1a1aa;
      font-size: .875rem;
      margin-bottom: 28px;
    }

    label {
      display: block;
      font-size: .8rem;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: .05em;
      margin-bottom: 6px;
    }

    input[type="text"] {
      width: 100%;
      padding: 10px 14px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      color: #e4e4e7;
      font-size: 1rem;
      outline: none;
      transition: border-color .15s;
    }
    input[type="text"]:focus { border-color: #25d366; }

    .btn {
      width: 100%;
      padding: 12px;
      margin-top: 16px;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
    }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .btn-primary { background: #25d366; color: #000; }
    .btn-secondary { background: #3f3f46; color: #e4e4e7; margin-top: 8px; }

    .status {
      margin-top: 20px;
      text-align: center;
      font-size: .875rem;
      min-height: 24px;
    }
    .status.ok   { color: #25d366; }
    .status.err  { color: #ef4444; }
    .status.info { color: #a1a1aa; }

    .qr-box {
      margin-top: 24px;
      text-align: center;
    }
    .qr-box img {
      max-width: 260px;
      border-radius: 12px;
      border: 2px solid #3f3f46;
    }
    .qr-label {
      margin-top: 10px;
      font-size: .8rem;
      color: #a1a1aa;
    }

    .spinner {
      display: inline-block;
      width: 18px; height: 18px;
      border: 2px solid #3f3f46;
      border-top-color: #25d366;
      border-radius: 50%;
      animation: spin .6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .session-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: .75rem;
      font-weight: 600;
      margin-left: 8px;
      vertical-align: middle;
    }
    .badge-connected { background: #052e16; color: #25d366; }
    .badge-qrneeded { background: #422006; color: #f59e0b; }
    .badge-new      { background: #1e1b4b; color: #818cf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WhatsApp Auth</h1>
    <p class="subtitle">Cesto d'Amore — Conectar instância WAHA</p>

    <label for="session">Nome da Instância</label>
    <input type="text" id="session" placeholder="ex: CestoDamore" autocomplete="off" />

    <button class="btn btn-primary" id="btnCheck" onclick="checkSession()">
      Conectar
    </button>

    <div class="status" id="status"></div>
    <div class="qr-box" id="qrBox"></div>
  </div>

<script>
const $status = document.getElementById('status');
const $qrBox  = document.getElementById('qrBox');
const $input  = document.getElementById('session');
const $btn    = document.getElementById('btnCheck');

function setStatus(msg, cls) {
  $status.className = 'status ' + cls;
  $status.innerHTML = msg;
}

async function checkSession() {
  const name = $input.value.trim();
  if (!name) { setStatus('Digite o nome da instância', 'err'); return; }

  $btn.disabled = true;
  $qrBox.innerHTML = '';
  setStatus('<span class="spinner"></span> Verificando instância…', 'info');

  try {
    const res  = await fetch('/whatsapp/auth/check-session?session=' + encodeURIComponent(name));
    const data = await res.json();

    if (data.status === 'connected') {
      showConnectedChoice(name);
      $btn.disabled = false;
      return;
    }

    if (data.status === 'new') {
      setStatus('<span class="spinner"></span> Criando instância…', 'info');
      const createRes = await fetch('/whatsapp/auth/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: name }),
      });
      if (!createRes.ok) throw new Error('Falha ao criar instância');
    }

    setStatus('<span class="spinner"></span> Aguardando QR Code…', 'info');
    await fetchQR(name);

  } catch (e) {
    setStatus('Erro: ' + e.message, 'err');
  }
  $btn.disabled = false;
}

function showConnectedChoice(name) {
  $qrBox.innerHTML =
    '<div style="font-size:2.2rem;margin-bottom:10px">✅</div>' +
    '<div class="qr-label" style="margin-bottom:16px">Já existe um número conectado a esta instância.</div>' +
    '<button class="btn btn-primary" onclick="chooseNew(\'' + name + '\')">Conectar novo número</button>' +
    '<button class="btn btn-secondary" onclick="chooseKeep()">Manter conexão</button>';
  setStatus('Escolha uma opção para continuar.', 'info');
}

function chooseKeep() {
  setStatus('Conexão atual mantida. Nenhuma alteração feita.', 'ok');
  $qrBox.innerHTML = '';
}

async function chooseNew(name) {
  $btn.disabled = true;
  $qrBox.innerHTML = '';
  setStatus('<span class="spinner"></span> Desconectando número atual e aguardando QR Code…', 'info');
  try {
    setStatus('<span class="spinner"></span> Aguardando QR Code…', 'info');
    await fetchQR(name);
  } catch (e) {
    setStatus('Erro: ' + e.message, 'err');
  }
  $btn.disabled = false;
}

async function fetchQR(name) {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('/whatsapp/auth/qr?session=' + encodeURIComponent(name));
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        $qrBox.innerHTML =
          '<img src="' + url + '" alt="QR Code" />' +
          '<div class="qr-label">Escaneie com o WhatsApp</div>';
        setStatus('<span class="spinner"></span> Escaneie o QR Code — aguardando confirmação…', 'info');
        pollConnection(name);
        return;
      }
    } catch (_) { /* ignore */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  setStatus('QR Code não disponível. Tente novamente.', 'err');
}

let pollTimer = null;

async function pollConnection(name) {
  if (pollTimer) clearTimeout(pollTimer);

  const maxPolls = 60; // 60 × 3s = 3 min máximo
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res  = await fetch('/whatsapp/auth/check-session?session=' + encodeURIComponent(name));
      const data = await res.json();

      if (data.status === 'connected') {
        $qrBox.innerHTML =
          '<div style="font-size:3rem;margin-bottom:12px">✅</div>' +
          '<div class="qr-label">WhatsApp conectado com sucesso!</div>';
        setStatus('Instância <strong>' + name + '</strong> conectada!', 'ok');
        $btn.disabled = false;
        return;
      }

      if (data.status === 'new') {
        setStatus('Sessão perdida. Reconecte manualmente.', 'err');
        $btn.disabled = false;
        return;
      }
    } catch (_) { /* ignore — retry */ }
  }

  setStatus('Tempo esgotado. Tente novamente.', 'err');
  $btn.disabled = false;
}
</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  }

  async checkSession(req: Request, res: Response) {
    try {
      const sessionName = (req.query.session as string)?.trim();
      if (!sessionName) {
        return res.status(400).json({ error: "Parâmetro 'session' obrigatório" });
      }

      const session = await whatsappService.getSessionStatus(sessionName);

      if (!session) {
        return res.json({ status: "new", session: sessionName });
      }

      const state = session.status?.toLowerCase?.() || session.state?.toLowerCase?.() || "";

      if (state === "working" || state === "loggedIn") {
        return res.json({ status: "connected", session: sessionName, state });
      }

      return res.json({ status: "disconnected", session: sessionName, state });
    } catch (error: any) {
      logger.error("Erro ao verificar sessão:", error);
      return res.status(500).json({ error: "Erro ao verificar sessão" });
    }
  }

  async createSession(req: Request, res: Response) {
    try {
      const sessionName = req.body?.session?.trim();
      if (!sessionName) {
        return res.status(400).json({ error: "Campo 'session' obrigatório" });
      }

      const existing = await whatsappService.getSessionStatus(sessionName);
      if (existing) {
        const state = existing.status?.toLowerCase?.() || existing.state?.toLowerCase?.() || "";
        if (state === "working" || state === "loggedIn") {
          return res.json({ success: true, session: sessionName, alreadyConnected: true });
        }
      }

      const created = await whatsappService.createSession(sessionName);
      if (!created) {
        return res.status(500).json({ error: "Falha ao criar instância" });
      }

      return res.json({ success: true, session: sessionName });
    } catch (error: any) {
      logger.error("Erro ao criar sessão:", error);
      return res.status(500).json({ error: "Erro ao criar sessão" });
    }
  }

  async getQRCode(req: Request, res: Response) {
    try {
      const sessionName = (req.query.session as string)?.trim();
      if (!sessionName) {
        return res.status(400).json({ error: "Parâmetro 'session' obrigatório" });
      }

      const qrBuffer = await whatsappService.getQRCode(sessionName);
      if (!qrBuffer) {
        return res.status(404).json({ error: "QR code não disponível" });
      }

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.send(qrBuffer);
    } catch (error: any) {
      logger.error("Erro ao obter QR code:", error);
      return res.status(500).json({ error: "Erro ao obter QR code" });
    }
  }
}

export default new WhatsAppController();
