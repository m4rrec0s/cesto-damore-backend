import axios, { AxiosInstance } from "axios";
import reportService from "./reportService";

type OrderStatus = "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELED";

interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  groupId: string;
}

interface SendMessagePayload {
  number: string;
  text: string;
}

class WhatsAppService {
  private client: AxiosInstance;
  private config: WhatsAppConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN = 3600000;

  constructor() {
    if (
      !process.env.EVOLUTION_API_URL ||
      !process.env.EVOLUTION_API_KEY ||
      !process.env.EVOLUTION_INSTANCE ||
      !process.env.WHATSAPP_GROUP_ID
    ) {
      console.warn(
        "⚠️ Variáveis de ambiente do WhatsApp não estão totalmente configuradas.",
      );
    }

    this.config = {
      apiUrl: process.env.EVOLUTION_API_URL as string,
      apiKey: process.env.EVOLUTION_API_KEY as string,
      instanceName: process.env.EVOLUTION_INSTANCE as string,
      groupId: process.env.WHATSAPP_GROUP_ID as string,
    };

    this.client = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        "Content-Type": "application/json",
        apikey: this.config.apiKey,
      },
      timeout: 10000,
    });
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.apiUrl && this.config.groupId);
  }

  async sendMessage(text: string, phoneNumber?: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn(
        "WhatsApp não configurado. Configure as variáveis de ambiente.",
      );
      return false;
    }

    try {
      const payload: SendMessagePayload = {
        number: phoneNumber || this.config.groupId,
        text,
      };

      const response = await this.client.post(
        `/message/sendText/${this.config.instanceName}`,
        payload,
      );

      return true;
    } catch (error: any) {
      console.error("Erro ao enviar mensagem WhatsApp:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return false;
    }
  }

  private canSendAlert(itemId: string): boolean {
    const lastAlert = this.lastAlertTime.get(itemId);
    if (!lastAlert) return true;

    const elapsed = Date.now() - lastAlert;
    return elapsed >= this.ALERT_COOLDOWN;
  }

  private markAlertSent(itemId: string): void {
    this.lastAlertTime.set(itemId, Date.now());
  }

  async sendCriticalStockAlert(
    itemId: string,
    itemName: string,
    itemType: "product" | "additional" | "color",
    colorInfo?: { name: string; hex: string; additionalName: string },
  ): Promise<boolean> {
    if (!this.canSendAlert(`critical-${itemId}`)) {
      return false;
    }

    let message = `🚨 *ESTOQUE CRÍTICO - SEM ESTOQUE* 🚨\n\n`;

    if (itemType === "color" && colorInfo) {
      message += `📦 Adicional: ${colorInfo.additionalName}\n`;
      message += `🎨 Cor: ${colorInfo.name} (${colorInfo.hex})\n`;
      message += `⚠️ Status: *SEM ESTOQUE*\n\n`;
    } else if (itemType === "additional") {
      message += `📦 Adicional: ${itemName}\n`;
      message += `⚠️ Status: *SEM ESTOQUE*\n\n`;
    } else {
      message += `📦 Produto: ${itemName}\n`;
      message += `⚠️ Status: *SEM ESTOQUE*\n\n`;
    }

    message += `⏰ ${this.formatToBrasiliaTime(new Date())}\n\n`;
    message += `⚡ *Ação necessária:* Reabastecer imediatamente!`;

    const sent = await this.sendMessage(message);
    if (sent) {
      this.markAlertSent(`critical-${itemId}`);
    }
    return sent;
  }

  async sendLowStockAlert(
    itemId: string,
    itemName: string,
    currentStock: number,
    threshold: number,
    itemType: "product" | "additional" | "color",
    colorInfo?: { name: string; hex: string; additionalName: string },
  ): Promise<boolean> {
    if (!this.canSendAlert(`low-${itemId}`)) {
      console.warn(
        `Alerta de estoque baixo já enviado recentemente para ${itemId}`,
      );
      return false;
    }

    let message = `⚠️ *ALERTA DE ESTOQUE BAIXO* ⚠️\n\n`;

    if (itemType === "color" && colorInfo) {
      message += `📦 Adicional: ${colorInfo.additionalName}\n`;
      message += `🎨 Cor: ${colorInfo.name} (${colorInfo.hex})\n`;
    } else if (itemType === "additional") {
      message += `📦 Adicional: ${itemName}\n`;
    } else {
      message += `📦 Produto: ${itemName}\n`;
    }

    message += `📊 Estoque atual: *${currentStock} unidade(s)*\n`;
    message += `🎯 Limite: ${threshold} unidades\n\n`;
    message += `⏰ ${this.formatToBrasiliaTime(new Date())}\n\n`;

    if (currentStock <= 2) {
      message += `🔴 *Status: CRÍTICO* - Reabastecer urgente!`;
    } else if (currentStock <= 10) {
      message += `🟡 *Status: BAIXO* - Considere reabastecer em breve`;
    } else {
      message += `🟠 *Status: ATENÇÃO* - Monitorar estoque`;
    }

    const sent = await this.sendMessage(message);
    if (sent) {
      this.markAlertSent(`low-${itemId}`);
    }
    return sent;
  }

  async checkAndNotifyLowStock(threshold: number = 5): Promise<{
    checked: boolean;
    alerts_sent: number;
    errors: number;
  }> {
    if (!this.isConfigured()) {
      console.warn("WhatsApp não configurado. Pulando verificação de estoque.");
      return { checked: false, alerts_sent: 0, errors: 0 };
    }

    try {
      const result = await reportService.hasItemsBelowThreshold(threshold);

      if (!result.has_critical || result.items.length === 0) {
        console.warn("Nenhum item com estoque baixo encontrado.");
        return { checked: true, alerts_sent: 0, errors: 0 };
      }

      let alertsSent = 0;
      let errors = 0;

      for (const item of result.items) {
        try {
          let sent = false;

          if (item.current_stock === 0) {

            sent = await this.sendCriticalStockAlert(
              item.id,
              item.name,
              item.type,
              item.color_name
                ? {
                    name: item.color_name,
                    hex: item.color_hex_code || "",
                    additionalName: item.additional_name || "",
                  }
                : undefined,
            );
          } else {

            sent = await this.sendLowStockAlert(
              item.id,
              item.name,
              item.current_stock,
              item.threshold,
              item.type,
              item.color_name
                ? {
                    name: item.color_name,
                    hex: item.color_hex_code || "",
                    additionalName: item.additional_name || "",
                  }
                : undefined,
            );
          }

          if (sent) alertsSent++;
        } catch (error: any) {
          console.error(
            `Erro ao enviar alerta para ${item.name}:`,
            error.message,
          );
          errors++;
        }
      }

      return { checked: true, alerts_sent: alertsSent, errors };
    } catch (error: any) {
      console.error(
        "Erro ao verificar e notificar estoque baixo:",
        error.message,
      );
      return { checked: false, alerts_sent: 0, errors: 1 };
    }
  }

  async sendStockSummary(): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn("WhatsApp não configurado.");
      return false;
    }

    try {
      const report = await reportService.getStockReport(5);

      let message = `📊 *RELATÓRIO DE ESTOQUE* 📊\n\n`;
      message += `📈 *Resumo Geral:*\n`;
      message += `• Produtos: ${report.total_products} (${report.products_out_of_stock} sem estoque)\n`;
      message += `• Adicionais: ${report.total_additionals} (${report.additionals_out_of_stock} sem estoque)\n`;

      message += `⏰ ${this.formatToBrasiliaTime(new Date())}\n\n`;
      message += `⚡ *Ação necessária:* Reabastecer imediatamente!`;

      if (report.low_stock_items.length > 0) {
        message += `⚠️ *Itens com Estoque Baixo:* ${report.low_stock_items.length}\n\n`;

        const critical = report.low_stock_items.filter(
          (i) => i.current_stock === 0,
        );
        const low = report.low_stock_items.filter(
          (i) => i.current_stock > 0 && i.current_stock <= 2,
        );
        const warning = report.low_stock_items.filter(
          (i) => i.current_stock > 2,
        );

        if (critical.length > 0) {
          message += `🔴 *Crítico (sem estoque):* ${critical.length} itens\n`;
        }
        if (low.length > 0) {
          message += `🟠 *Baixo (≤2 un):* ${low.length} itens\n`;
        }
        if (warning.length > 0) {
          message += `🟡 *Atenção (≤5 un):* ${warning.length} itens\n`;
        }
      } else {
        message += `✅ *Todos os itens estão com estoque adequado!*\n`;
      }

      message += `\n⏰ ${this.formatToBrasiliaTime(new Date())}`;

      return await this.sendMessage(message);
    } catch (error: any) {
      console.error("Erro ao enviar resumo de estoque:", error.message);
      return false;
    }
  }

  async sendOrderConfirmationNotification(
    orderData: {
      orderId: string;
      orderNumber?: string;
      totalAmount: number;
      paymentMethod?: string;
      items: Array<{
        name: string;
        quantity: number;
        price: number;
      }>;
      customer: {
        name: string;
        email: string;
        phone?: string;
      };
      delivery?: {
        address: string;
        city: string;
        state: string;
        zipCode: string;
        date?: Date;
      };
      googleDriveUrl?: string;
      recipientPhone?: string;
      deliveryMethod?: string;
    },
    options: { notifyTeam?: boolean; notifyCustomer?: boolean } = {
      notifyTeam: true,
      notifyCustomer: false,
    },
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn("WhatsApp não configurado. Pulando notificação de pedido.");
      return false;
    }

    try {
      const { teamMessage, customerMessage } =
        this.buildOrderConfirmationMessages(orderData);

      const { notifyTeam = true, notifyCustomer = false } = options;

      let teamSent = false;
      let customerSent = false;

      if (notifyTeam && this.isConfigured()) {
        const sent = await this.sendMessage(teamMessage);
        if (sent) {
          console.info(
            `Notificação de pedido ${orderData.orderId} enviada com sucesso`,
          );
          teamSent = true;
        }
      }

      if (notifyCustomer) {

        const targetPhone =
          orderData.recipientPhone ?? orderData.customer.phone;
        if (targetPhone) {
          const cleanPhone = (targetPhone as string).replace(/\D/g, "");
          const phoneWithCountry = cleanPhone.startsWith("55")
            ? cleanPhone
            : `55${cleanPhone}`;
          if (phoneWithCountry.length >= 12) {
            customerSent = await this.sendDirectMessage(
              phoneWithCountry,
              customerMessage,
            );
          } else {
            console.warn(
              `Telefone inválido para notificação ao cliente: ${targetPhone}`,
            );
          }
        }
      }

      return teamSent || customerSent;
    } catch (error: any) {
      console.error("Erro ao enviar notificação de pedido:", error.message);
      return false;
    }
  }

  private buildOrderConfirmationMessages(orderData: {
    orderId: string;
    orderNumber?: string;
    totalAmount: number;
    paymentMethod?: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    customer: { name: string; email: string; phone?: string };
    delivery?: {
      address: string;
      city?: string;
      state?: string;
      zipCode?: string;
      date?: Date;
    };
    googleDriveUrl?: string;
    recipientPhone?: string;
    send_anonymously?: boolean;
    complement?: string;
    deliveryMethod?: string;
  }) {
    const orderLabel =
      orderData.orderNumber || orderData.orderId.substring(0, 8).toUpperCase();
    const totalFormatted = orderData.totalAmount.toFixed(2).replace(".", ",");

    let teamMessage = `✅ *NOVO PEDIDO CONFIRMADO* ✅\n\n`;
    teamMessage += `📦 *Pedido #${orderLabel}*\n`;
    teamMessage += `💰 Valor: R$ ${totalFormatted}\n`;
    if (orderData.paymentMethod) {
      teamMessage += `💳 Pagamento: ${this.formatPaymentMethod(
        orderData.paymentMethod,
      )}\n\n`;
    } else {
      teamMessage += `\n`;
    }

    teamMessage += `📝 *Itens:*\n`;
    orderData.items.forEach((item) => {
      const itemTotal = item.quantity * item.price;
      teamMessage += `• ${item.quantity}x ${item.name} (R$ ${itemTotal
        .toFixed(2)
        .replace(".", ",")})\n`;
    });

    teamMessage += `\n👤 *Comprador:* ${orderData.customer.name}\n`;
    if (orderData.customer.phone) {
      teamMessage += `📱 *Tel. Comprador:* ${orderData.customer.phone}\n`;
    }
    teamMessage += `✉️ *Email:* ${orderData.customer.email}\n`;

    const isAnonymous = orderData.send_anonymously === true;
    const complement = orderData.complement;

    if (orderData.recipientPhone) {
      teamMessage += `\n🎁 *Destinatário:*\n`;
      teamMessage += `📱 ${orderData.recipientPhone}`;
      if (isAnonymous) {
        teamMessage += ` _(Envio Anônimo)_`;
      }
      teamMessage += `\n`;
    } else if (isAnonymous) {
      teamMessage += `\n🎁 *Destinatário:* _(Envio Anônimo - Sem número do destinatário)_\n`;
    } else {
      teamMessage += `\n🎁 *Destinatário:* _(A definir)_\n`;
    }

    if (orderData.delivery) {
      teamMessage += `\n📍 *Endereço de Entrega:*\n`;
      teamMessage += `${orderData.delivery.address}\n`;
      teamMessage += `${orderData.delivery.city} - ${orderData.delivery.state} | CEP: ${orderData.delivery.zipCode}\n`;
      if (complement) {
        teamMessage += `_Complemento: ${complement}_\n`;
      }
      if (orderData.delivery.date) {
        teamMessage += `\n⏰ *Data/Hora de Entrega:*\n`;
        teamMessage += `${this.formatToBrasiliaTime(
          orderData.delivery.date as any,
        )}\n`;
      }
    }

    if (orderData.deliveryMethod === "pickup") {
      teamMessage += `\n📍 *Retirada na Loja*\n`;
      teamMessage += `Endereço: https://maps.app.goo.gl/YwimXyog4pTBeEjP8?g_st=aw\n`;
    }

    if (orderData.googleDriveUrl) {
      teamMessage += `\n🎨 *Customizações:*\n`;
      teamMessage += `📸 ${orderData.googleDriveUrl}\n`;
    }

    teamMessage += `\n⏰ ${this.formatToBrasiliaTime(new Date())}\n\n`;
    teamMessage += `🚀 *Preparar pedido para entrega!*`;

    const createdAtBrasilia = this.formatToBrasiliaTime(new Date());
    let deliveryDateBrasilia = "A definir";
    let deliveryTimeBrasilia = "";
    if (orderData.delivery && orderData.delivery.date) {
      const deliveryDateTime = new Date(orderData.delivery.date);
      deliveryDateBrasilia = this.formatDateOnlyToBrasilia(deliveryDateTime);
      deliveryTimeBrasilia = deliveryDateTime.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    let customerMessage = `🎉 *PEDIDO CONFIRMADO!* 🎉\n\n`;
    customerMessage += `Olá, *${orderData.customer.name}*! ✨\n`;
    customerMessage += `Seu pagamento foi confirmado com sucesso!\n\n`;

    customerMessage += `═══════════════════════════════\n`;
    customerMessage += `📦 *PEDIDO #${orderLabel}*\n`;
    customerMessage += `═══════════════════════════════\n\n`;

    customerMessage += `📅 *Data do Pedido:* ${createdAtBrasilia}\n`;
    if (deliveryTimeBrasilia) {
      customerMessage += `🚚 *Entrega Prevista:* ${deliveryDateBrasilia} às ${deliveryTimeBrasilia}\n\n`;
    } else {
      customerMessage += `🚚 *Entrega Prevista:* ${deliveryDateBrasilia}\n\n`;
    }

    if (orderData.deliveryMethod === "pickup") {
      customerMessage += `📍 *Retirada na Loja*\n`;
      customerMessage += `🗺️ Localização: https://maps.app.goo.gl/YwimXyog4pTBeEjP8?g_st=aw\n\n`;
    }

    if (orderData.recipientPhone || orderData.send_anonymously) {
      customerMessage += `🎁 *Para:* `;
      if (orderData.send_anonymously) {
        customerMessage += `_Entrega Anônima_`;
      }
      if (orderData.recipientPhone) {
        customerMessage += `${orderData.recipientPhone}`;
      }
      customerMessage += `\n\n`;
    }

    customerMessage += `📦 *Seu Pedido:*\n`;
    orderData.items.forEach((item) => {
      const itemTotal = (item.quantity * item.price)
        .toFixed(2)
        .replace(".", ",");
      customerMessage += `• ${item.quantity}x ${item.name} - R$ ${itemTotal}\n`;
    });

    customerMessage += `\n💰 *TOTAL: R$ ${totalFormatted}*\n`;
    customerMessage += `💳 *Pagamento:* ${this.formatPaymentMethod(
      orderData.paymentMethod || "Não especificado",
    )}\n\n`;

    if (orderData.googleDriveUrl) {
      customerMessage += `🎨 *Suas Personalizações:*\n`;
      customerMessage += `📁 ${orderData.googleDriveUrl}\n\n`;
    } else {
      customerMessage += `⏳ *Personalizações sendo processadas...*\n`;
      customerMessage += `_Enviaremos o link das suas fotos em breve!_\n\n`;
    }

    customerMessage += `✨ *Sua cesta está sendo preparada com muito carinho!*\n\n`;
    customerMessage += `Agradecemos pela preferência! ❤️\n`;
    customerMessage += `_Equipe Cesto d'Amore_`;

    return { teamMessage, customerMessage };
  }

  

  private normalizePhoneForWhatsApp(phone: string): string {

    let digits = phone.replace(/\D/g, "");

    if (
      digits.startsWith("55") &&
      (digits.length === 12 || digits.length === 13)
    ) {
      return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }

    return `55${digits}`;
  }

  

  

  public async sendDirectMessage(
    phoneNumber: string,
    message: string,
  ): Promise<boolean> {
    try {

      const normalizedPhone = this.normalizePhoneForWhatsApp(phoneNumber);

      const url = `${this.config.apiUrl}/message/sendText/${this.config.instanceName}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.apiKey,
        },
        body: JSON.stringify({
          number: normalizedPhone,
          text: message,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Erro ao enviar mensagem direta:", errorText);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error("Erro ao enviar mensagem direta:", error.message);
      return false;
    }
  }

  

  private formatPaymentMethod(method: string): string {
    const methods: Record<string, string> = {
      pix: "PIX",
      credit_card: "Cartão de Crédito",
      debit_card: "Cartão de Débito",
      card: "Cartão",
    };
    return methods[method.toLowerCase()] || method;
  }

  private formatOrderStatus(status: OrderStatus) {
    const map: Record<
      OrderStatus,
      {
        label: string;
        emoji: string;
        description: string;
        customerHint: string;
      }
    > = {
      PENDING: {
        label: "Pagamento Pendente",
        emoji: "⏳",
        description: "Pedido aguardando confirmação de pagamento.",
        customerHint:
          "Estamos aguardando a confirmação do pagamento para iniciar a preparação.",
      },
      PAID: {
        label: "Pagamento Confirmado",
        emoji: "✅",
        description: "Pagamento aprovado, preparar pedido.",
        customerHint:
          "Recebemos seu pagamento! Em breve começaremos a montar sua cesta.",
      },
      SHIPPED: {
        label: "Pedido em Rota de Entrega",
        emoji: "🚚",
        description: "Pedido saiu para entrega.",
        customerHint:
          "Seu pedido está a caminho! Avisaremos assim que a entrega for concluída.",
      },
      DELIVERED: {
        label: "Pedido Entregue",
        emoji: "🎁",
        description: "Pedido entregue ao cliente.",
        customerHint:
          "Pedido entregue com sucesso! Esperamos que tenha gostado da experiência.",
      },
      CANCELED: {
        label: "Pedido Cancelado",
        emoji: "❌",
        description: "Pedido cancelado.",
        customerHint:
          "O pedido foi cancelado. Caso tenha dúvidas, estamos à disposição para ajudar.",
      },
    };

    return map[status] || map.PENDING;
  }

  async sendOrderStatusUpdateNotification(
    orderData: {
      orderId: string;
      orderNumber?: string;
      totalAmount: number;
      paymentMethod: string;
      items: Array<{ name: string; quantity: number; price: number }>;
      customer: {
        name: string;
        email: string;
        phone?: string;
      };
      delivery?: {
        address: string;
        city?: string;
        state?: string;
        date?: Date | string | null;
      };
      googleDriveUrl?: string;
    },
    newStatus: OrderStatus,
    options: { notifyCustomer?: boolean; notifyTeam?: boolean } = {},
  ): Promise<void> {
    const { notifyCustomer = true, notifyTeam = true } = options;

    if (!notifyCustomer && !notifyTeam) {
      return;
    }

    const statusInfo = this.formatOrderStatus(newStatus);
    const orderLabel =
      orderData.orderNumber || orderData.orderId.substring(0, 8).toUpperCase();
    const totalFormatted = orderData.totalAmount.toFixed(2).replace(".", ",");

    if (notifyTeam && this.isConfigured()) {
      let message = `${statusInfo.emoji} *Atualização de Pedido* ${statusInfo.emoji}\n\n`;
      message += `📦 *Pedido:* #${orderLabel}\n`;
      message += `📊 *Status:* ${statusInfo.label}\n`;
      message += `💰 *Valor:* R$ ${totalFormatted}\n`;
      message += `💳 *Pagamento:* ${this.formatPaymentMethod(
        orderData.paymentMethod,
      )}\n\n`;
      message += `👤 *Cliente:* ${orderData.customer.name} (${orderData.customer.email})\n`;
      if (orderData.customer.phone) {
        message += `📞 ${orderData.customer.phone}\n`;
      }

      if (orderData.delivery) {
        message += `\n📍 *Entrega:* ${orderData.delivery.address}`;
        if (orderData.delivery.city || orderData.delivery.state) {
          const locationParts = [
            orderData.delivery.city,
            orderData.delivery.state,
          ]
            .filter(Boolean)
            .join(" - ");
          if (locationParts) {
            message += ` (${locationParts})`;
          }
        }
        if (orderData.delivery.date) {
          message += `\n🗓️ ${this.formatDateOnlyToBrasilia(
            orderData.delivery.date,
          )}`;
        }
        message += "\n";
      }

      message += `\n📝 *Itens:*\n`;
      orderData.items.forEach((item) => {
        const lineTotal = (item.price * item.quantity)
          .toFixed(2)
          .replace(".", ",");
        message += `• ${item.quantity}x ${item.name} (R$ ${lineTotal})\n`;
      });

      if (orderData.googleDriveUrl) {
        message += `\n🎨 *Customizações:* ${orderData.googleDriveUrl}\n`;
      }

      message += `\n${statusInfo.description}\n`;
      message += `\n⏰ ${this.formatToBrasiliaTime(new Date())}`;

      await this.sendMessage(message);
    }

    if (notifyCustomer && orderData.customer.phone) {
      const cleanPhone = orderData.customer.phone.replace(/\D/g, "");
      const customerPhone = cleanPhone.startsWith("55")
        ? cleanPhone
        : `55${cleanPhone}`;

      if (customerPhone.length >= 12) {
        let message = `${statusInfo.emoji} *Atualização do seu pedido* ${statusInfo.emoji}\n\n`;
        message += `Olá, ${orderData.customer.name}!\n`;
        message += `O status do seu pedido #${orderLabel} agora é *${statusInfo.label}*.\n\n`;
        message += `${statusInfo.customerHint}\n`;

        if (orderData.googleDriveUrl) {

        }

        if (orderData.delivery) {
          message += `\n📍 Entrega: ${orderData.delivery.address}`;
          if (orderData.delivery.city || orderData.delivery.state) {
            const locationParts = [
              orderData.delivery.city,
              orderData.delivery.state,
            ]
              .filter(Boolean)
              .join(" - ");
            if (locationParts) {
              message += ` (${locationParts})`;
            }
          }
          if (orderData.delivery.date) {
            message += `\n🗓️ Data prevista: ${this.formatDateOnlyToBrasilia(
              orderData.delivery.date,
            )}`;
          }
        }

        message += `\n\nQualquer dúvida, estamos por aqui! ❤️\n`;
        message += `_Equipe Cesto d'Amore_`;

        await this.sendDirectMessage(customerPhone, message);
      } else {
        console.warn(
          `Telefone do cliente inválido para notificação: ${orderData.customer.phone}`,
        );
      }
    }
  }

  

  async sendOrderConfirmation(data: {
    phone: string;
    orderNumber: string;
    customerName: string;
    recipientPhone?: string;
    deliveryDate?: string | Date;
    createdAt: string | Date;
    googleDriveUrl?: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
  }): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn(
        "WhatsApp não configurado. Pulando notificação ao comprador.",
      );
      return false;
    }

    try {
      const cleanPhone = data.phone.replace(/\D/g, "");
      const phoneWithCountry = cleanPhone.startsWith("55")
        ? cleanPhone
        : `55${cleanPhone}`;

      if (phoneWithCountry.length < 12) {
        console.warn(`Telefone inválido: ${data.phone}`);
        return false;
      }

      const createdAtBrasilia = this.formatToBrasiliaTime(data.createdAt);
      const deliveryDateBrasilia = data.deliveryDate
        ? this.formatToBrasiliaTime(data.deliveryDate)
        : "A definir";

      let message = `🎉 *Pedido Confirmado!* 🎉\n\n`;
      message += `Olá, ${data.customerName}!\n`;
      message += `Seu pagamento foi confirmado com sucesso!\n\n`;

      message += `📦 *Pedido:* #${data.orderNumber}\n`;
      message += `👤 *Comprador:* ${data.customerName}\n`;
      if (data.recipientPhone) {
        message += `📱 *Destinatário:* ${data.recipientPhone}\n`;
      }

      message += `\n📅 *Criado em:* ${createdAtBrasilia}\n`;
      message += `🚚 *Entrega prevista:* ${deliveryDateBrasilia}\n`;

      message += `\n💰 *Total:* R$ ${data.total
        .toFixed(2)
        .replace(".", ",")}\n`;

      message += `\n📝 *Itens do pedido:*\n`;
      data.items.forEach((item) => {
        message += `• ${item.quantity}x ${item.name}\n`;
      });

      if (data.googleDriveUrl) {
        message += `\n🎨 *Suas Personalizações:*\n`;
        message += `📁 ${data.googleDriveUrl}\n`;
      } else {
        message += `\n⏳ *Personalizações sendo processadas...*\n`;
        message += `_Enviaremos o link das suas fotos em breve!_\n`;
      }

      message += `\n✨ *Sua cesta está sendo preparada com muito carinho!*\n\n`;
      message += `Agradecemos pela preferência! ❤️\n`;
      message += `_Equipe Cesto d'Amore_`;

      const sent = await this.sendDirectMessage(phoneWithCountry, message);

      if (sent) {
        console.info(
          `✅ Confirmação enviada ao comprador ${phoneWithCountry} - Pedido #${data.orderNumber}`,
        );
      }

      return sent;
    } catch (error: any) {
      console.error("Erro ao enviar confirmação ao comprador:", error.message);
      return false;
    }
  }

  private formatToBrasiliaTime(isoDate: string | Date): string {
    const date = typeof isoDate === "string" ? new Date(isoDate) : isoDate;
    return date.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  private formatDateOnlyToBrasilia(
    isoDate: string | Date | undefined | null,
  ): string {
    if (!isoDate) return "";
    const date = typeof isoDate === "string" ? new Date(isoDate) : isoDate;
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
}

export default new WhatsAppService();
