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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Painel de Conexões — m4rrec0s</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg-0: #0a0d12;
    --bg-1: #11151d;
    --bg-2: #171d27;
    --bg-3: #1d2430;
    --border: #232b38;
    --border-strong: #313c4d;
    --text: #e6ebf2;
    --text-dim: #93a0b3;
    --text-mute: #5b6577;
    --accent: #7c8cff;
    --accent-strong: #97a4ff;
    --accent-bg: #1b1f3a;
    --ok: #35d6a0;
    --warn: #f2b451;
    --err: #f2585f;
    --mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
    --sans: 'Inter', 'Segoe UI', system-ui, sans-serif;
  }

  html {
    background: var(--bg-0);
  }

  body {
    background: var(--bg-0);
    color: var(--text);
    font-family: var(--sans);
    min-height: 100vh;
    width: 100%;
    position: relative;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding: 28px 16px 48px;
  }

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(var(--border) 1px, transparent 1px),
      linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 34px 34px;
    opacity: .12;
    pointer-events: none;
    z-index: 0;
  }

  .wrap {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
  }

  /* ---------- brand ---------- */
  .brandbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 22px;
  }

  .brand-mark {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--accent);
    color: #05060a;
    font-family: var(--mono);
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .brand-copy h1 {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: .01em;
  }

  .brand-copy p {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    letter-spacing: .02em;
  }

  /* ---------- service tabs ---------- */
  .tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin-bottom: 16px;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }

  .tab {
    flex: 0 0 auto;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text-mute);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition: border-color .15s, color .15s, background .15s;
  }

  .tab:hover:not(.disabled) {
    border-color: var(--border-strong);
    color: var(--text-dim);
  }

  .tab.active {
    color: var(--accent-strong);
    background: var(--accent-bg);
    border-color: var(--accent);
  }

  .tab.disabled {
    cursor: not-allowed;
    opacity: .5;
  }

  .tab .soon {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--text-mute);
  }

  /* ---------- terminal panel ---------- */
  .term {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .term-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
  }

  .term-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .term-dot.r { background: #f2585f; }
  .term-dot.y { background: #f2b451; }
  .term-dot.g { background: #35d6a0; }

  .term-path {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-mute);
    margin-left: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .term-path b { color: var(--text-dim); font-weight: 500; }

  .term-tag {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ok);
    letter-spacing: .05em;
    flex-shrink: 0;
  }

  .term-body {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
  }

  @media (max-width: 760px) {
    .term-body {
      grid-template-columns: 1fr;
    }
    .col-connect { order: 1; }
    .col-steps   { order: 2; }
  }

  .col-steps {
    padding: 26px 28px;
    border-right: 1px solid var(--border);
  }
  @media (max-width: 760px) {
    .col-steps { border-right: none; border-top: 1px solid var(--border); }
  }

  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: .08em;
    margin-bottom: 14px;
  }

  ol.steps { list-style: none; counter-reset: step; }

  ol.steps li {
    counter-increment: step;
    display: flex;
    gap: 12px;
    font-size: 13.5px;
    color: var(--text-dim);
    padding: 8px 0;
    line-height: 1.5;
  }

  ol.steps li::before {
    content: counter(step, decimal-leading-zero);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
    flex-shrink: 0;
    padding-top: 1px;
  }

  ol.steps li strong { color: var(--text); font-weight: 600; }

  .steps-note {
    margin-top: 18px;
    font-size: 12px;
    color: var(--text-mute);
    line-height: 1.5;
    border-left: 2px solid var(--border-strong);
    padding-left: 10px;
  }

  details.steps-toggle summary {
    display: none;
  }

  /* ---------- connect column ---------- */
  .col-connect {
    padding: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .field {
    width: 100%;
    max-width: 300px;
  }

  .field label {
    display: block;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: .06em;
    margin-bottom: 7px;
  }

  input[type="text"] {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 13.5px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="text"]::placeholder { color: var(--text-mute); }
  input[type="text"]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }

  .btn {
    width: 100%;
    max-width: 300px;
    padding: 11px;
    border-radius: 7px;
    font-size: 13.5px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
    transition: opacity .15s, background .15s, border-color .15s;
  }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #05060a; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-strong); }
  .btn-ghost {
    background: transparent;
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--text); }

  .statusline {
    width: 100%;
    max-width: 300px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-mute);
    min-height: 18px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .statusline.ok  { color: var(--ok); }
  .statusline.err { color: var(--err); }
  .statusline .prompt { color: var(--accent); flex-shrink: 0; }

  .cursor {
    display: inline-block;
    width: 6px;
    height: 12px;
    background: var(--accent);
    animation: blink 1s step-start infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  /* ---------- QR ---------- */
  .qr-frame {
    position: relative;
    width: min(78vw, 264px);
    height: min(78vw, 264px);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 4px 0;
  }

  .qr-frame img {
    width: 88%;
    height: 88%;
    border-radius: 4px;
  }

  .corner {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 2.5px solid var(--accent);
  }
  .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; border-radius: 5px 0 0 0; }
  .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; border-radius: 0 5px 0 0; }
  .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; border-radius: 0 0 0 5px; }
  .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; border-radius: 0 0 5px 0; }

  .placeholder-qr {
    width: 88%;
    height: 88%;
    border-radius: 4px;
    background:
      repeating-linear-gradient(45deg, var(--bg-2), var(--bg-2) 8px, var(--bg-3) 8px, var(--bg-3) 16px);
  }

  .spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin .6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .connected-check {
    font-family: var(--mono);
    font-size: 2.4rem;
    color: var(--ok);
  }

  footer {
    margin-top: 22px;
    text-align: center;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-mute);
  }
  footer a { color: var(--text-dim); text-decoration: none; }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">

  <div class="brandbar">
    <div class="brand-mark">m4</div>
    <div class="brand-copy">
      <h1>m4rrec0s</h1>
      <p>automatizando processos</p>
    </div>
  </div>

  <div class="tabs" id="tabs">
    <div class="tab active" data-service="whatsapp" data-path="whatsapp">#whatsapp</div>
    <div class="tab disabled" data-service="telegram" data-path="telegram">#telegram <span class="soon">em breve</span></div>
    <div class="tab disabled" data-service="instagram" data-path="instagram">#instagram <span class="soon">em breve</span></div>
    <div class="tab disabled" data-service="email" data-path="email">#email <span class="soon">em breve</span></div>
  </div>

  <div class="term">
    <div class="term-bar">
      <span class="term-dot r"></span>
      <span class="term-dot y"></span>
      <span class="term-dot g"></span>
      <span class="term-path">m4rrec0s@conexoes<b id="pathService">:~/whatsapp$</b></span>
      <span class="term-tag">TLS</span>
    </div>

    <div class="term-body">
      <div class="col-connect">
        <div class="field">
          <label for="session">Nome da instância</label>
          <input type="text" id="session" placeholder="ex: cesto-damore" autocomplete="off" />
        </div>

        <button class="btn btn-primary" id="btnCheck">Conectar</button>

        <div class="statusline" id="status"></div>

        <div id="qrArea"></div>
      </div>

      <div class="col-steps">
        <p class="eyebrow">Como conectar</p>
        <ol class="steps">
          <li><span>Abra o WhatsApp no celular que deseja conectar</span></li>
          <li><span>Toque em <strong>Mais opções</strong> ou <strong>Configurações</strong> e selecione <strong>Aparelhos conectados</strong></span></li>
          <li><span>Toque em <strong>Conectar um aparelho</strong></span></li>
          <li><span>Aponte a câmera para o QR Code ao lado</span></li>
        </ol>
        <p class="steps-note">Conexão ponta a ponta. Cada instância criada fica disponível para reuso em automações futuras.</p>
      </div>
    </div>
  </div>

  <footer>painel de conexões · <a href="#">m4rrec0s</a> — automatizando processos</footer>

</div>

<script>
const $status  = document.getElementById('status');
const $qrArea  = document.getElementById('qrArea');
const $input   = document.getElementById('session');
const $btn     = document.getElementById('btnCheck');

function setStatus(text, cls, spin) {
  $status.className = 'statusline ' + (cls || '');
  $status.innerHTML =
    (spin ? '<span class="spinner"></span>' : '<span class="prompt">$</span>') +
    '<span>' + text + '</span><span class="cursor"></span>';
}

function clearStatus() {
  $status.className = 'statusline';
  $status.innerHTML = '';
}

async function checkSession() {
  const name = $input.value.trim();
  if (!name) { setStatus('digite o nome da instância', 'err'); return; }

  $btn.disabled = true;
  $qrArea.innerHTML = '';
  setStatus('verificando instância…', '', true);

  try {
    const res  = await fetch('/whatsapp/auth/check-session?session=' + encodeURIComponent(name));
    const data = await res.json();

    if (data.status === 'connected') {
      showConnectedChoice(name);
      $btn.disabled = false;
      return;
    }

    if (data.status === 'new') {
      setStatus('criando instância…', '', true);
      const createRes = await fetch('/whatsapp/auth/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: name }),
      });
      if (!createRes.ok) throw new Error('falha ao criar instância');
    }

    setStatus('aguardando QR Code…', '', true);
    await fetchQR(name);

  } catch (e) {
    setStatus('erro: ' + e.message, 'err');
  }
  $btn.disabled = false;
}

function showConnectedChoice(name) {
  window.__currentSession = name;
  $qrArea.innerHTML =
    '<div class="qr-frame"><span class="connected-check">&#10003;</span></div>' +
    '<div style="font-size:12px;color:var(--text-mute);margin:6px 0 12px;text-align:center;max-width:300px">já existe um número conectado a esta instância.</div>' +
    '<button class="btn btn-primary" id="btnNew" style="margin-bottom:8px">Conectar novo número</button>' +
    '<button class="btn btn-ghost" id="btnKeep">Manter conexão</button>';
  setStatus('escolha uma opção para continuar', '');
  document.getElementById('btnNew').addEventListener('click', chooseNew);
  document.getElementById('btnKeep').addEventListener('click', chooseKeep);
}

function chooseKeep() {
  setStatus('conexão atual mantida', 'ok');
  $qrArea.innerHTML = '';
}

async function chooseNew() {
  const name = window.__currentSession;
  $btn.disabled = true;
  $qrArea.innerHTML = '';
  setStatus('desconectando número atual…', '', true);
  try {
    await fetchQR(name);
  } catch (e) {
    setStatus('erro: ' + e.message, 'err');
  }
  $btn.disabled = false;
}

async function fetchQR(name) {
  const maxAttempts = 10;
  $qrArea.innerHTML = '<div class="qr-frame"><div class="placeholder-qr"></div>' +
    '<span class="corner tl"></span><span class="corner tr"></span>' +
    '<span class="corner bl"></span><span class="corner br"></span></div>';

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('/whatsapp/auth/qr?session=' + encodeURIComponent(name));
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        $qrArea.innerHTML =
          '<div class="qr-frame"><img src="' + url + '" alt="QR Code" />' +
          '<span class="corner tl"></span><span class="corner tr"></span>' +
          '<span class="corner bl"></span><span class="corner br"></span></div>';
        setStatus('escaneie o QR Code — aguardando confirmação…', '', true);
        pollConnection(name);
        return;
      }
    } catch (_) { /* ignore */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  setStatus('QR Code não disponível, tente novamente', 'err');
}

let pollTimer = null;

async function pollConnection(name) {
  if (pollTimer) clearTimeout(pollTimer);

  const maxPolls = 60;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res  = await fetch('/whatsapp/auth/check-session?session=' + encodeURIComponent(name));
      const data = await res.json();

      if (data.status === 'connected') {
        $qrArea.innerHTML = '<div class="qr-frame"><span class="connected-check">&#10003;</span></div>';
        setStatus('instância ' + name + ' conectada', 'ok');
        $btn.disabled = false;
        return;
      }

      if (data.status === 'new') {
        setStatus('sessão perdida, reconecte manualmente', 'err');
        $btn.disabled = false;
        return;
      }
    } catch (_) { /* ignore — retry */ }
  }

  setStatus('tempo esgotado, tente novamente', 'err');
  $btn.disabled = false;
}

$btn.addEventListener('click', checkSession);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('disabled')) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pathService').textContent = ':~/' + tab.dataset.path + '$';
  });
});
</script>
</body>
</html>
`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  }

  async checkSession(req: Request, res: Response) {
    try {
      const sessionName = (req.query.session as string)?.trim();
      if (!sessionName) {
        return res
          .status(400)
          .json({ error: "Parâmetro 'session' obrigatório" });
      }

      const session = await whatsappService.getSessionStatus(sessionName);

      if (!session) {
        return res.json({ status: "new", session: sessionName });
      }

      const state =
        session.status?.toLowerCase?.() || session.state?.toLowerCase?.() || "";

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
        const state =
          existing.status?.toLowerCase?.() ||
          existing.state?.toLowerCase?.() ||
          "";
        if (state === "working" || state === "loggedIn") {
          return res.json({
            success: true,
            session: sessionName,
            alreadyConnected: true,
          });
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
        return res
          .status(400)
          .json({ error: "Parâmetro 'session' obrigatório" });
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
