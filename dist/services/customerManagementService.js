"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_1 = __importStar(require("../config/supabase"));
const prisma_1 = __importDefault(require("../database/prisma"));
const whatsappService_1 = __importDefault(require("./whatsappService"));
class CustomerManagementService {
    // ========== N8N SUPABASE OPERATIONS ==========
    /**
     * Cria ou atualiza um cliente no banco n8n
     */
    async upsertN8NCustomer(customerData) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            console.warn("Supabase não configurado. Pulando operação.");
            return null;
        }
        try {
            // Buscar cliente existente
            const existing = await (0, supabase_1.default) `
        SELECT * FROM clientes WHERE number = ${customerData.number}
      `;
            if (existing && existing.length > 0) {
                // Atualizar cliente existente
                const updateData = {
                    last_message_sent: new Date(),
                };
                if (customerData.name !== undefined)
                    updateData.name = customerData.name;
                if (customerData.service_status !== undefined)
                    updateData.service_status = customerData.service_status;
                if (customerData.already_a_customer !== undefined)
                    updateData.already_a_customer = customerData.already_a_customer;
                if (customerData.follow_up !== undefined)
                    updateData.follow_up = customerData.follow_up;
                const result = await (0, supabase_1.default) `
          UPDATE clientes
          SET ${(0, supabase_1.default)(updateData)}
          WHERE number = ${customerData.number}
          RETURNING *
        `;
                return result[0];
            }
            else {
                // Inserir novo cliente
                const result = await (0, supabase_1.default) `
          INSERT INTO clientes (number, name, service_status, already_a_customer, follow_up, last_message_sent)
          VALUES (
            ${customerData.number},
            ${customerData.name || null},
            ${customerData.service_status || null},
            ${customerData.already_a_customer || false},
            ${customerData.follow_up || false},
            CURRENT_TIMESTAMP
          )
          RETURNING *
        `;
                return result[0];
            }
        }
        catch (error) {
            console.error("Erro ao criar/atualizar cliente n8n:", error.message);
            throw error;
        }
    }
    /**
     * Busca cliente n8n por telefone
     */
    async getN8NCustomerByPhone(phone) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return null;
        }
        try {
            const result = await (0, supabase_1.default) `
        SELECT * FROM clientes WHERE number = ${phone}
      `;
            return result[0] || null;
        }
        catch (error) {
            console.error("Erro ao buscar cliente n8n:", error.message);
            return null;
        }
    }
    /**
     * Lista todos os clientes n8n com filtros opcionais
     */
    async listN8NCustomers(filters) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return { customers: [], total: 0 };
        }
        try {
            const { follow_up, service_status, already_a_customer, limit = 50, offset = 0, } = filters || {};
            // Construir WHERE clause dinamicamente
            const conditions = [];
            const params = [];
            if (follow_up !== undefined) {
                conditions.push(`follow_up = $${params.length + 1}`);
                params.push(follow_up);
            }
            if (service_status) {
                conditions.push(`service_status = $${params.length + 1}`);
                params.push(service_status);
            }
            if (already_a_customer !== undefined) {
                conditions.push(`already_a_customer = $${params.length + 1}`);
                params.push(already_a_customer);
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            // Buscar clientes
            const query = `
        SELECT * FROM clientes
        ${whereClause}
        ORDER BY last_message_sent DESC NULLS LAST
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `;
            params.push(limit, offset);
            const customers = await supabase_1.default.unsafe(query, params);
            // Contar total
            const countQuery = `SELECT COUNT(*) as count FROM clientes ${whereClause}`;
            const countResult = await supabase_1.default.unsafe(countQuery, params.slice(0, -2));
            return {
                customers: customers,
                total: parseInt(countResult[0]?.count || "0"),
            };
        }
        catch (error) {
            console.error("Erro ao listar clientes n8n:", error.message);
            return { customers: [], total: 0 };
        }
    }
    /**
     * Atualiza o follow-up de um cliente
     */
    async updateFollowUp(phone, followUp) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return false;
        }
        try {
            await (0, supabase_1.default) `
        UPDATE clientes
        SET follow_up = ${followUp}
        WHERE number = ${phone}
      `;
            return true;
        }
        catch (error) {
            console.error("Erro ao atualizar follow-up:", error.message);
            return false;
        }
    }
    /**
     * Atualiza o status de cliente existente
     */
    async updateCustomerStatus(phone, alreadyCustomer) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return false;
        }
        try {
            await (0, supabase_1.default) `
        UPDATE clientes
        SET already_a_customer = ${alreadyCustomer}
        WHERE number = ${phone}
      `;
            return true;
        }
        catch (error) {
            console.error("Erro ao atualizar status de cliente:", error.message);
            return false;
        }
    }
    // ========== MESSAGE OPERATIONS ==========
    /**
     * Envia mensagem ao cliente via WhatsApp e atualiza registro
     */
    async sendMessageToCustomer(phone, message) {
        try {
            let customer = await this.getN8NCustomerByPhone(phone);
            if (!customer) {
                customer = await this.upsertN8NCustomer({
                    number: phone,
                    follow_up: false,
                });
            }
            else {
            }
            if (!customer) {
                return { success: false };
            }
            const sent = await whatsappService_1.default.sendMessage(message, phone);
            if (sent) {
                if (!supabase_1.default) {
                    return { success: sent, customer };
                }
                await (0, supabase_1.default) `
          UPDATE clientes
          SET last_message_sent = CURRENT_TIMESTAMP
          WHERE number = ${phone}
        `;
            }
            return { success: sent, customer };
        }
        catch (error) {
            return { success: false };
        }
    }
    async getCompleteCustomerInfo(phone) {
        try {
            const n8nCustomer = await this.getN8NCustomerByPhone(phone);
            const appUser = await prisma_1.default.user.findFirst({
                where: { phone },
                include: {
                    orders: {
                        select: {
                            id: true,
                            status: true,
                            total: true,
                            created_at: true,
                        },
                        orderBy: { created_at: "desc" },
                    },
                },
            });
            const appUserWithOrders = appUser
                ? {
                    ...appUser,
                    orders: appUser.orders.map((order) => ({
                        id: order.id,
                        status: order.status,
                        total_price: order.total,
                        created_at: order.created_at,
                    })),
                }
                : undefined;
            return {
                n8n_customer: n8nCustomer || undefined,
                app_user: appUserWithOrders,
                has_app_account: !!appUser,
                total_orders: appUser?.orders.length || 0,
                last_order_status: appUser?.orders[0]?.status,
            };
        }
        catch (error) {
            console.error("Erro ao buscar informações completas do cliente:", error.message);
            return null;
        }
    }
    async syncAppUserToN8N(userId) {
        if (!(0, supabase_1.isSupabaseConfigured)()) {
            return false;
        }
        try {
            const user = await prisma_1.default.user.findUnique({
                where: { id: userId },
            });
            if (!user || !user.phone) {
                return false;
            }
            await this.upsertN8NCustomer({
                number: user.phone,
                name: user.name,
                already_a_customer: true, // Marca como cliente existente
                follow_up: true, // Ativar follow-up para clientes com pedidos
            });
            return true;
        }
        catch (error) {
            console.error("Erro ao sincronizar usuário app -> n8n:", error.message);
            return false;
        }
    }
    async getFollowUpCustomers() {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return [];
        }
        try {
            const { customers } = await this.listN8NCustomers({ follow_up: true });
            const combinedInfo = await Promise.all(customers.map((customer) => this.getCompleteCustomerInfo(customer.number)));
            return combinedInfo.filter((info) => info !== null);
        }
        catch (error) {
            console.error("Erro ao buscar clientes para follow-up:", error.message);
            return [];
        }
    }
    /**
     * Atualiza estágio de serviço do cliente
     */
    async updateServiceStatus(phone, status) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return false;
        }
        try {
            await (0, supabase_1.default) `
        UPDATE clientes
        SET service_status = ${status}
        WHERE number = ${phone}
      `;
            return true;
        }
        catch (error) {
            console.error("Erro ao atualizar status de serviço:", error.message);
            return false;
        }
    }
    /**
     * Atualiza nome do cliente
     */
    async updateCustomerName(phone, name) {
        if (!(0, supabase_1.isSupabaseConfigured)() || !supabase_1.default) {
            return false;
        }
        try {
            await (0, supabase_1.default) `
        UPDATE clientes
        SET name = ${name}
        WHERE number = ${phone}
      `;
            return true;
        }
        catch (error) {
            console.error("Erro ao atualizar nome do cliente:", error.message);
            return false;
        }
    }
}
exports.default = new CustomerManagementService();
