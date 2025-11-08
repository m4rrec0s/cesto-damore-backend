import supabaseClient, { isSupabaseConfigured } from "../config/supabase";
import prisma from "../database/prisma";
import whatsappService from "./whatsappService";

// Types baseados no schema do Supabase (tabela clientes)
interface N8NCustomer {
  number: string; // telefone (PK)
  name?: string | null;
  last_message_sent?: Date | null;
  service_status?: string | null;
  already_a_customer?: boolean;
  follow_up?: boolean;
}

interface AppUserWithOrders {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  role: string;
  created_at: Date;
  orders: Array<{
    id: string;
    status: string;
    total_price: number;
    created_at: Date;
  }>;
}

interface CombinedCustomerInfo {
  n8n_customer?: N8NCustomer;
  app_user?: AppUserWithOrders;
  has_app_account: boolean;
  total_orders: number;
  last_order_status?: string;
}

class CustomerManagementService {
  // ========== N8N SUPABASE OPERATIONS ==========

  /**
   * Cria ou atualiza um cliente no banco n8n
   */
  async upsertN8NCustomer(customerData: {
    number: string;
    name?: string;
    service_status?: string;
    already_a_customer?: boolean;
    follow_up?: boolean;
  }): Promise<N8NCustomer | null> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      console.warn("Supabase não configurado. Pulando operação.");
      return null;
    }

    try {
      // Buscar cliente existente
      const existing = await supabaseClient`
        SELECT * FROM clientes WHERE number = ${customerData.number}
      `;

      if (existing && existing.length > 0) {
        // Atualizar cliente existente
        const updateData: any = {
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

        const result = await supabaseClient`
          UPDATE clientes
          SET ${supabaseClient(updateData)}
          WHERE number = ${customerData.number}
          RETURNING *
        `;
        return result[0] as N8NCustomer;
      } else {
        // Inserir novo cliente
        const result = await supabaseClient`
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
        return result[0] as N8NCustomer;
      }
    } catch (error: any) {
      console.error("Erro ao criar/atualizar cliente n8n:", error.message);
      throw error;
    }
  }

  /**
   * Busca cliente n8n por telefone
   */
  async getN8NCustomerByPhone(phone: string): Promise<N8NCustomer | null> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return null;
    }

    try {
      const result = await supabaseClient`
        SELECT * FROM clientes WHERE number = ${phone}
      `;

      return (result[0] as N8NCustomer) || null;
    } catch (error: any) {
      console.error("Erro ao buscar cliente n8n:", error.message);
      return null;
    }
  }

  /**
   * Lista todos os clientes n8n com filtros opcionais
   */
  async listN8NCustomers(filters?: {
    follow_up?: boolean;
    service_status?: string;
    already_a_customer?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ customers: N8NCustomer[]; total: number }> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return { customers: [], total: 0 };
    }

    try {
      const {
        follow_up,
        service_status,
        already_a_customer,
        limit = 50,
        offset = 0,
      } = filters || {};

      // Construir WHERE clause dinamicamente
      const conditions: string[] = [];
      const params: any[] = [];

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

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Buscar clientes
      const query = `
        SELECT * FROM clientes
        ${whereClause}
        ORDER BY last_message_sent DESC NULLS LAST
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `;
      params.push(limit, offset);

      const customers = await supabaseClient.unsafe(query, params);

      // Contar total
      const countQuery = `SELECT COUNT(*) as count FROM clientes ${whereClause}`;
      const countResult = await supabaseClient.unsafe(
        countQuery,
        params.slice(0, -2)
      );

      return {
        customers: customers as unknown as N8NCustomer[],
        total: parseInt(countResult[0]?.count || "0"),
      };
    } catch (error: any) {
      console.error("Erro ao listar clientes n8n:", error.message);
      return { customers: [], total: 0 };
    }
  }

  /**
   * Atualiza o follow-up de um cliente
   */
  async updateFollowUp(phone: string, followUp: boolean): Promise<boolean> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return false;
    }

    try {
      await supabaseClient`
        UPDATE clientes
        SET follow_up = ${followUp}
        WHERE number = ${phone}
      `;

      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar follow-up:", error.message);
      return false;
    }
  }

  /**
   * Atualiza o status de cliente existente
   */
  async updateCustomerStatus(
    phone: string,
    alreadyCustomer: boolean
  ): Promise<boolean> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return false;
    }

    try {
      await supabaseClient`
        UPDATE clientes
        SET already_a_customer = ${alreadyCustomer}
        WHERE number = ${phone}
      `;

      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar status de cliente:", error.message);
      return false;
    }
  }

  // ========== MESSAGE OPERATIONS ==========

  /**
   * Envia mensagem ao cliente via WhatsApp e atualiza registro
   */
  async sendMessageToCustomer(
    phone: string,
    message: string
  ): Promise<{ success: boolean; customer?: N8NCustomer }> {
    try {
      let customer = await this.getN8NCustomerByPhone(phone);

      if (!customer) {
        customer = await this.upsertN8NCustomer({
          number: phone,
          follow_up: false,
        });
      } else {
      }

      if (!customer) {
        return { success: false };
      }

      const sent = await whatsappService.sendMessage(message, phone);

      if (sent) {
        if (!supabaseClient) {
          return { success: sent, customer };
        }

        await supabaseClient`
          UPDATE clientes
          SET last_message_sent = CURRENT_TIMESTAMP
          WHERE number = ${phone}
        `;
      }

      return { success: sent, customer };
    } catch (error: any) {
      return { success: false };
    }
  }

  async getCompleteCustomerInfo(
    phone: string
  ): Promise<CombinedCustomerInfo | null> {
    try {
      const n8nCustomer = await this.getN8NCustomerByPhone(phone);

      const appUser = await prisma.user.findFirst({
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
    } catch (error: any) {
      console.error(
        "Erro ao buscar informações completas do cliente:",
        error.message
      );
      return null;
    }
  }

  async syncAppUserToN8N(userId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) {
      return false;
    }

    try {
      const user = await prisma.user.findUnique({
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
    } catch (error: any) {
      console.error("Erro ao sincronizar usuário app -> n8n:", error.message);
      return false;
    }
  }

  async getFollowUpCustomers(): Promise<CombinedCustomerInfo[]> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return [];
    }

    try {
      const { customers } = await this.listN8NCustomers({ follow_up: true });

      const combinedInfo = await Promise.all(
        customers.map((customer) =>
          this.getCompleteCustomerInfo(customer.number)
        )
      );

      return combinedInfo.filter(
        (info) => info !== null
      ) as CombinedCustomerInfo[];
    } catch (error: any) {
      console.error("Erro ao buscar clientes para follow-up:", error.message);
      return [];
    }
  }

  /**
   * Atualiza estágio de serviço do cliente
   */
  async updateServiceStatus(phone: string, status: string): Promise<boolean> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return false;
    }

    try {
      await supabaseClient`
        UPDATE clientes
        SET service_status = ${status}
        WHERE number = ${phone}
      `;

      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar status de serviço:", error.message);
      return false;
    }
  }

  /**
   * Atualiza nome do cliente
   */
  async updateCustomerName(phone: string, name: string): Promise<boolean> {
    if (!isSupabaseConfigured() || !supabaseClient) {
      return false;
    }

    try {
      await supabaseClient`
        UPDATE clientes
        SET name = ${name}
        WHERE number = ${phone}
      `;

      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar nome do cliente:", error.message);
      return false;
    }
  }
}

export default new CustomerManagementService();
