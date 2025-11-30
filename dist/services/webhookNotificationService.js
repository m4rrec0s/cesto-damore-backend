"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookNotificationService = void 0;
/**
 * Serviço para gerenciar notificações via Server-Sent Events (SSE)
 * Permite que o frontend receba atualizações em tempo real sobre pagamentos
 */
class WebhookNotificationService {
    constructor() {
        this.clients = new Map();
    }
    /**
     * Registra um cliente SSE para receber notificações de um pedido específico
     */
    registerClient(orderId, res) {
        console.log(`📡 Cliente SSE registrado para pedido: ${orderId}`);
        // Configurar headers SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        // Flush headers when possible to ensure client starts receiving data immediately
        try {
            res.flushHeaders?.();
        }
        catch {
            /* ignore */
        }
        // Enviar mensagem inicial de conexão
        res.write(`data: ${JSON.stringify({ type: "connected", orderId })}\n\n`);
        // Iniciar heartbeat para manter conexão viva (20s)
        const pingInterval = setInterval(() => {
            try {
                // comments are valid SSE to keep NAT/proxy alive
                res.write(`: ping\n\n`);
            }
            catch (err) {
                console.warn("🔔 Erro ao enviar ping SSE:", err);
            }
        }, 20000);
        // Adicionar cliente à lista
        const clients = this.clients.get(orderId) || [];
        clients.push({ orderId, response: res, pingInterval });
        this.clients.set(orderId, clients);
        // Remover cliente quando a conexão for fechada
        res.on("close", () => {
            console.log(`❌ Cliente SSE desconectado para pedido: ${orderId}`);
            this.removeClient(orderId, res);
        });
    }
    /**
     * Remove um cliente específico da lista de notificações
     */
    removeClient(orderId, res) {
        const clients = this.clients.get(orderId) || [];
        const filtered = clients.filter((client) => {
            if (client.response === res) {
                if (client.pingInterval) {
                    clearInterval(client.pingInterval);
                    client.pingInterval = null;
                }
                return false; // remove this client
            }
            return true;
        });
        if (filtered.length === 0) {
            this.clients.delete(orderId);
        }
        else {
            this.clients.set(orderId, filtered);
        }
    }
    /**
     * Notifica todos os clientes conectados sobre uma atualização de pagamento
     */
    notifyPaymentUpdate(orderId, data) {
        const clients = this.clients.get(orderId);
        if (!clients || clients.length === 0) {
            console.log(`ℹ️ Nenhum cliente SSE conectado para pedido: ${orderId}`);
            return;
        }
        console.log(`📤 Enviando notificação SSE para ${clients.length} cliente(s) - Pedido: ${orderId}`);
        const message = {
            type: "payment_update",
            orderId,
            timestamp: new Date().toISOString(),
            ...data,
        };
        // Enviar para todos os clientes conectados
        clients.forEach((client, index) => {
            try {
                client.response.write(`data: ${JSON.stringify(message)}\n\n`);
                console.log(`✅ Notificação enviada para cliente ${index + 1}`);
            }
            catch (error) {
                console.error(`❌ Erro ao enviar notificação para cliente ${index + 1}:`, error);
                this.removeClient(orderId, client.response);
            }
        });
    }
    /**
     * Notifica sobre erro no processamento do pagamento
     */
    notifyPaymentError(orderId, error) {
        const clients = this.clients.get(orderId);
        if (!clients || clients.length === 0) {
            return;
        }
        const message = {
            type: "payment_error",
            orderId,
            timestamp: new Date().toISOString(),
            error,
        };
        clients.forEach((client) => {
            try {
                client.response.write(`data: ${JSON.stringify(message)}\n\n`);
            }
            catch (error) {
                console.error("Erro ao enviar notificação de erro:", error);
                this.removeClient(orderId, client.response);
            }
        });
    }
    /**
     * Retorna estatísticas sobre clientes conectados
     */
    getStats() {
        return {
            totalOrders: this.clients.size,
            totalClients: Array.from(this.clients.values()).reduce((sum, clients) => sum + clients.length, 0),
            orders: Array.from(this.clients.entries()).map(([orderId, clients]) => ({
                orderId,
                clientCount: clients.length,
            })),
        };
    }
}
exports.webhookNotificationService = new WebhookNotificationService();
