import prisma from "../database/prisma";
import whatsappService from "./whatsappService";

// Types baseados no schema do Prisma
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
  /**
   * Cria ou atualiza um cliente via Prisma (migrado de Supabase)
   */
  async upsertN8NCustomer(customerData: {
    number: string;
    name?: string;
    service_status?: string;
    already_a_customer?: boolean;
    follow_up?: boolean;
  }): Promise<N8NCustomer | null> {
    try {
      const data: any = {
        last_message_sent: new Date(),
      };

      if (customerData.name !== undefined) data.name = customerData.name;
      if (customerData.service_status !== undefined) data.service_status = customerData.service_status;
      if (customerData.already_a_customer !== undefined) data.already_a_customer = customerData.already_a_customer;
      if (customerData.follow_up !== undefined) data.follow_up = customerData.follow_up;

      const customer = await prisma.customer.upsert({
        where: { number: customerData.number },
        update: data,
        create: {
          number: customerData.number,
          name: customerData.name || null,
          service_status: customerData.service_status || null,
          already_a_customer: customerData.already_a_customer || false,
          follow_up: customerData.follow_up || false,
          last_message_sent: new Date(),
        },
      });

      return customer as N8NCustomer;
    } catch (error: any) {
      console.error("Erro ao criar/atualizar cliente no Prisma:", error.message);
      throw error;
    }
  }

  /**
   * Busca cliente por telefone via Prisma
   */
  async getN8NCustomerByPhone(phone: string): Promise<N8NCustomer | null> {
    try {
      const customer = await prisma.customer.findUnique({
        where: { number: phone },
      });
      return customer as N8NCustomer | null;
    } catch (error: any) {
      console.error("Erro ao buscar cliente no Prisma:", error.message);
      return null;
    }
  }

  /**
   * Lista todos os clientes filtrando por existência de sessão AI (para limpar a lista)
   */
  async listN8NCustomers(filters?: {
    follow_up?: boolean;
    service_status?: string;
    already_a_customer?: boolean;
    limit?: number;
    offset?: number;
    onlyAISessions?: boolean; // Novo filtro
  }): Promise<{ customers: N8NCustomer[]; total: number }> {
    try {
      const {
        follow_up,
        service_status,
        already_a_customer,
        limit = 50,
        offset = 0,
        onlyAISessions = true, // Default true para resolver o problema do usuário
      } = filters || {};

      const where: any = {};
      if (follow_up !== undefined) where.follow_up = follow_up;
      if (service_status) where.service_status = service_status;
      if (already_a_customer !== undefined) where.already_a_customer = already_a_customer;

      if (onlyAISessions) {
        where.aiAgentSession = { isNot: null };
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { last_message_sent: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.customer.count({ where }),
      ]);

      return {
        customers: customers as N8NCustomer[],
        total,
      };
    } catch (error: any) {
      console.error("Erro ao listar clientes no Prisma:", error.message);
      return { customers: [], total: 0 };
    }
  }

  /**
   * Atualiza o follow-up de um cliente
   */
  async updateFollowUp(phone: string, followUp: boolean): Promise<boolean> {
    try {
      await prisma.customer.update({
        where: { number: phone },
        data: { follow_up: followUp },
      });
      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar follow-up no Prisma:", error.message);
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
    try {
      await prisma.customer.update({
        where: { number: phone },
        data: { already_a_customer: alreadyCustomer },
      });
      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar status de cliente no Prisma:", error.message);
      return false;
    }
  }

  /**
   * Envia mensagem ao cliente via WhatsApp e atualiza registro
   */
  async sendMessageToCustomer(
    phone: string,
    message: string
  ): Promise<{ success: boolean; customer?: N8NCustomer }> {
    try {
      const sent = await whatsappService.sendMessage(message, phone);

      if (sent) {
        const customer = await prisma.customer.upsert({
          where: { number: phone },
          update: { last_message_sent: new Date() },
          create: {
            number: phone,
            follow_up: false,
            last_message_sent: new Date(),
          },
        });
        return { success: true, customer: customer as N8NCustomer };
      }

      return { success: false };
    } catch (error: any) {
      console.error("Erro ao enviar mensagem ao cliente:", error.message);
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
        last_order_status: appUser?.orders[0]?.status as string | undefined,
      };
    } catch (error: any) {
      console.error("Erro ao buscar informações completas do cliente:", error.message);
      return null;
    }
  }

  async syncAppUserToN8N(userId: string): Promise<boolean> {
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
        already_a_customer: true,
        follow_up: true,
      });

      return true;
    } catch (error: any) {
      console.error("Erro ao sincronizar usuário app -> Prisma:", error.message);
      return false;
    }
  }

  async getFollowUpCustomers(): Promise<CombinedCustomerInfo[]> {
    try {
      const { customers } = await this.listN8NCustomers({ follow_up: true });
      const combinedInfo = await Promise.all(
        customers.map((customer) => this.getCompleteCustomerInfo(customer.number))
      );
      return combinedInfo.filter((info) => info !== null) as CombinedCustomerInfo[];
    } catch (error: any) {
      console.error("Erro ao buscar clientes para follow-up:", error.message);
      return [];
    }
  }

  async updateServiceStatus(phone: string, status: string): Promise<boolean> {
    try {
      await prisma.customer.update({
        where: { number: phone },
        data: { service_status: status },
      });
      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar status de serviço no Prisma:", error.message);
      return false;
    }
  }

  async updateCustomerName(phone: string, name: string): Promise<boolean> {
    try {
      await prisma.customer.update({
        where: { number: phone },
        data: { name: name },
      });
      return true;
    } catch (error: any) {
      console.error("Erro ao atualizar nome do cliente no Prisma:", error.message);
      return false;
    }
  }
}

export default new CustomerManagementService();
