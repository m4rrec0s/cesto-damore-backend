"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const customerManagementService_1 = __importDefault(require("../services/customerManagementService"));
class CustomerManagementController {
    /**
     * GET /api/customers/:phone - Busca informações completas de um cliente
     */
    async getCustomerInfo(req, res) {
        try {
            const { phone } = req.params;
            if (!phone) {
                return res.status(400).json({
                    error: "Telefone é obrigatório",
                });
            }
            const customerInfo = await customerManagementService_1.default.getCompleteCustomerInfo(phone);
            if (!customerInfo) {
                return res.status(404).json({
                    error: "Cliente não encontrado",
                });
            }
            return res.json(customerInfo);
        }
        catch (error) {
            console.error("Erro ao buscar informações do cliente:", error.message);
            return res.status(500).json({
                error: "Erro ao buscar informações do cliente",
                message: error.message,
            });
        }
    }
    /**
     * GET /api/customers - Lista todos os clientes n8n
     */
    async listCustomers(req, res) {
        try {
            const { follow_up, service_status, already_a_customer, limit, offset } = req.query;
            const result = await customerManagementService_1.default.listN8NCustomers({
                follow_up: follow_up === "true"
                    ? true
                    : follow_up === "false"
                        ? false
                        : undefined,
                service_status: service_status,
                already_a_customer: already_a_customer === "true"
                    ? true
                    : already_a_customer === "false"
                        ? false
                        : undefined,
                limit: limit ? parseInt(limit) : undefined,
                offset: offset ? parseInt(offset) : undefined,
            });
            return res.json(result);
        }
        catch (error) {
            console.error("Erro ao listar clientes:", error.message);
            return res.status(500).json({
                error: "Erro ao listar clientes",
                message: error.message,
            });
        }
    }
    /**
     * POST /api/customers - Cria ou atualiza um cliente n8n
     */
    async upsertCustomer(req, res) {
        try {
            const { number, name, service_status, already_a_customer, follow_up } = req.body;
            if (!number) {
                return res.status(400).json({
                    error: "Número de telefone é obrigatório",
                });
            }
            const customer = await customerManagementService_1.default.upsertN8NCustomer({
                number,
                name,
                service_status,
                already_a_customer,
                follow_up,
            });
            if (!customer) {
                return res.status(500).json({
                    error: "Erro ao criar/atualizar cliente",
                });
            }
            return res.status(201).json(customer);
        }
        catch (error) {
            console.error("Erro ao criar/atualizar cliente:", error.message);
            return res.status(500).json({
                error: "Erro ao criar/atualizar cliente",
                message: error.message,
            });
        }
    }
    /**
     * PATCH /api/customers/:phone/follow-up - Atualiza follow-up do cliente
     */
    async updateFollowUp(req, res) {
        try {
            const { phone } = req.params;
            const { follow_up } = req.body;
            if (!phone) {
                return res.status(400).json({
                    error: "Telefone é obrigatório",
                });
            }
            if (typeof follow_up !== "boolean") {
                return res.status(400).json({
                    error: "follow_up deve ser true ou false",
                });
            }
            const success = await customerManagementService_1.default.updateFollowUp(phone, follow_up);
            if (!success) {
                return res.status(500).json({
                    error: "Erro ao atualizar follow-up",
                });
            }
            return res.json({
                message: "Follow-up atualizado com sucesso",
                phone,
                follow_up,
            });
        }
        catch (error) {
            console.error("Erro ao atualizar follow-up:", error.message);
            return res.status(500).json({
                error: "Erro ao atualizar follow-up",
                message: error.message,
            });
        }
    }
    /**
     * POST /api/customers/:phone/send-message - Envia mensagem ao cliente
     */
    async sendMessage(req, res) {
        try {
            const { phone } = req.params;
            const { message } = req.body;
            console.log("📤 [Controller] Tentando enviar mensagem:", {
                phone,
                messageLength: message?.length || 0,
                hasMessage: !!message,
            });
            if (!phone || !message) {
                console.error("❌ [Controller] Validação falhou:", {
                    phone: !!phone,
                    message: !!message,
                });
                return res.status(400).json({
                    error: "Telefone e mensagem são obrigatórios",
                });
            }
            const result = await customerManagementService_1.default.sendMessageToCustomer(phone, message);
            console.log("📨 [Controller] Resultado do serviço:", result);
            if (!result.success) {
                console.error("❌ [Controller] Serviço retornou success=false");
                return res.status(500).json({
                    error: "Erro ao enviar mensagem",
                    success: false,
                });
            }
            console.log("✅ [Controller] Mensagem enviada com sucesso");
            return res.json({
                message: "Mensagem enviada com sucesso",
                success: true,
                customer: result.customer,
            });
        }
        catch (error) {
            console.error("❌ [Controller] Exceção ao enviar mensagem:", {
                message: error.message,
                stack: error.stack,
            });
            return res.status(500).json({
                error: "Erro ao enviar mensagem",
                message: error.message,
                success: false,
            });
        }
    }
    /**
     * GET /api/customers/follow-up - Lista clientes para follow-up
     */
    async getFollowUpCustomers(req, res) {
        try {
            const customers = await customerManagementService_1.default.getFollowUpCustomers();
            return res.json({
                total: customers.length,
                customers,
            });
        }
        catch (error) {
            console.error("Erro ao buscar clientes para follow-up:", error.message);
            return res.status(500).json({
                error: "Erro ao buscar clientes para follow-up",
                message: error.message,
            });
        }
    }
    /**
     * PATCH /api/customers/:phone/service-status - Atualiza status de serviço
     */
    async updateServiceStatus(req, res) {
        try {
            const { phone } = req.params;
            const { service_status } = req.body;
            if (!phone || !service_status) {
                return res.status(400).json({
                    error: "Telefone e status de serviço são obrigatórios",
                });
            }
            const success = await customerManagementService_1.default.updateServiceStatus(phone, service_status);
            if (!success) {
                return res.status(500).json({
                    error: "Erro ao atualizar status de serviço",
                });
            }
            return res.json({
                message: "Status de serviço atualizado com sucesso",
                phone,
                service_status,
            });
        }
        catch (error) {
            console.error("Erro ao atualizar status de serviço:", error.message);
            return res.status(500).json({
                error: "Erro ao atualizar status de serviço",
                message: error.message,
            });
        }
    }
    /**
     * PATCH /api/customers/:phone/customer-status - Atualiza se já é cliente
     */
    async updateCustomerStatus(req, res) {
        try {
            const { phone } = req.params;
            const { already_a_customer } = req.body;
            if (!phone || typeof already_a_customer !== "boolean") {
                return res.status(400).json({
                    error: "Telefone e already_a_customer (boolean) são obrigatórios",
                });
            }
            const success = await customerManagementService_1.default.updateCustomerStatus(phone, already_a_customer);
            if (!success) {
                return res.status(500).json({
                    error: "Erro ao atualizar status de cliente",
                });
            }
            return res.json({
                message: "Status de cliente atualizado com sucesso",
                phone,
                already_a_customer,
            });
        }
        catch (error) {
            console.error("Erro ao atualizar status de cliente:", error.message);
            return res.status(500).json({
                error: "Erro ao atualizar status de cliente",
                message: error.message,
            });
        }
    }
    /**
     * PATCH /api/customers/:phone/name - Atualiza nome do cliente
     */
    async updateName(req, res) {
        try {
            const { phone } = req.params;
            const { name } = req.body;
            if (!phone || !name) {
                return res.status(400).json({
                    error: "Telefone e nome são obrigatórios",
                });
            }
            const success = await customerManagementService_1.default.updateCustomerName(phone, name);
            if (!success) {
                return res.status(500).json({
                    error: "Erro ao atualizar nome",
                });
            }
            return res.json({
                message: "Nome atualizado com sucesso",
                phone,
                name,
            });
        }
        catch (error) {
            console.error("Erro ao atualizar nome:", error.message);
            return res.status(500).json({
                error: "Erro ao atualizar nome",
                message: error.message,
            });
        }
    }
    /**
     * POST /api/customers/sync/:userId - Sincroniza usuário do app para n8n
     */
    async syncAppUser(req, res) {
        try {
            const { userId } = req.params;
            if (!userId) {
                return res.status(400).json({
                    error: "ID do usuário é obrigatório",
                });
            }
            const success = await customerManagementService_1.default.syncAppUserToN8N(userId);
            if (!success) {
                return res.status(500).json({
                    error: "Erro ao sincronizar usuário",
                });
            }
            return res.json({
                message: "Usuário sincronizado com sucesso",
                userId,
            });
        }
        catch (error) {
            console.error("Erro ao sincronizar usuário:", error.message);
            return res.status(500).json({
                error: "Erro ao sincronizar usuário",
                message: error.message,
            });
        }
    }
}
exports.default = new CustomerManagementController();
