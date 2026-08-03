import axios from "axios";
import { STORE_INFO } from "../config/store";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import sharp from "sharp";

export interface OrderPrintSummaryInput {
  orderId: string;
  createdAt: Date;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    document?: string | null;
  };
  delivery: {
    method?: string | null;
    address?: string | null;
    complement?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    recipientPhone?: string | null;
    date?: Date | null;
  };
  payment: { orderMethod?: string | null; confirmedMethod?: string | null };
  amounts: { items: number; shipping: number; discount: number; total: number };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    additionals: Array<{ name: string; quantity: number; price: number }>;
    customizations: Array<{ type: string; text?: string; label?: string; previewUrl?: string }>;
  }>;
}

const font = "Arial";
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const value = (input?: string | null) => input?.trim() || "Não informado";
const run = (text: string, bold = false) => new TextRun({ text, font, size: 24, bold });
const cell = (text: string, bold = false) =>
  new TableCell({ children: [new Paragraph({ children: [run(text, bold)] })] });

async function grayscalePreview(url: string): Promise<Buffer> {
  let input: Buffer;
  if (url.startsWith("data:")) {
    const commaIdx = url.indexOf(",");
    if (commaIdx < 0) throw new Error("Invalid data URL");
    input = Buffer.from(url.slice(commaIdx + 1), "base64");
  } else {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 15_000,
      maxContentLength: 10 * 1024 * 1024,
    });
    input = Buffer.from(response.data);
  }
  return sharp(input)
    .rotate()
    .resize({ width: 280, height: 180, fit: "inside", withoutEnlargement: true })
    .grayscale()
    .jpeg({ quality: 80 })
    .toBuffer();
}

export async function generateOrderPrintSummaryBuffer(input: OrderPrintSummaryInput): Promise<Buffer> {
  const isPickup =
    input.delivery.method?.toLowerCase() === "pickup" ||
    input.delivery.method?.toLowerCase() === "retirada";
  const delivery = isPickup
    ? {
        ...input.delivery,
        address: STORE_INFO.address,
        city: "Campina Grande",
        state: "PB",
        zipCode: "58400-515",
        complement: input.delivery.complement || "Retirada na loja",
      }
    : input.delivery;

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "RESUMO DO PEDIDO", font, size: 24, bold: true })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`Pedido #${input.orderId.slice(0, 8)} | ${input.createdAt.toLocaleString("pt-BR")}`)] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Cliente", true)] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell("Nome", true), cell(value(input.customer.name))] }),
      new TableRow({ children: [cell("E-mail", true), cell(value(input.customer.email))] }),
      new TableRow({ children: [cell("Telefone", true), cell(value(input.customer.phone))] }),
      new TableRow({ children: [cell("Documento", true), cell(value(input.customer.document))] }),
    ] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Entrega", true)] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell("Método", true), cell(isPickup ? "Retirada na loja" : value(delivery.method))] }),
      new TableRow({ children: [cell("Endereço", true), cell(value(delivery.address))] }),
      new TableRow({ children: [cell("Complemento", true), cell(value(delivery.complement))] }),
      new TableRow({ children: [cell("Cidade / UF", true), cell(`${value(delivery.city)} / ${value(delivery.state)}`)] }),
      new TableRow({ children: [cell("CEP", true), cell(value(delivery.zipCode))] }),
      new TableRow({ children: [cell("Telefone destinatário", true), cell(value(delivery.recipientPhone))] }),
      new TableRow({ children: [cell("Data", true), cell(delivery.date?.toLocaleDateString("pt-BR") || "Não informado")] }),
    ] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Pagamento e valores", true)] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell("Método", true), cell(value(input.payment.confirmedMethod || input.payment.orderMethod))] }),
      new TableRow({ children: [cell("Itens", true), cell(formatCurrency(input.amounts.items))] }),
      new TableRow({ children: [cell("Frete", true), cell(formatCurrency(input.amounts.shipping))] }),
      new TableRow({ children: [cell("Desconto", true), cell(formatCurrency(input.amounts.discount))] }),
      new TableRow({ children: [cell("TOTAL", true), cell(formatCurrency(input.amounts.total), true)] }),
    ] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Itens e artes", true)] }),
  ];

  for (const [itemIndex, item] of input.items.entries()) {
    children.push(new Paragraph({ children: [run(`${itemIndex + 1}. ${item.name} | Qtd: ${item.quantity} | ${formatCurrency(item.unitPrice)}`, true)] }));
    for (const additional of item.additionals) {
      children.push(new Paragraph({ indent: { left: 360 }, children: [run(`Adicional: ${additional.name} | Qtd: ${additional.quantity} | ${formatCurrency(additional.price)}`)] }));
    }

    for (const customization of item.customizations) {
      const details = [customization.type, customization.label, customization.text].filter(Boolean).join(": ");
      children.push(new Paragraph({ indent: { left: 360 }, children: [run(details || "Customização sem detalhes")] }));
      if (!customization.previewUrl) continue;
      try {
        const image = await grayscalePreview(customization.previewUrl);
        children.push(new Paragraph({ indent: { left: 720 }, children: [new ImageRun({ data: image, type: "jpg", transformation: { width: 210, height: 135 } })] }));
      } catch {
        children.push(new Paragraph({ indent: { left: 720 }, children: [run("Preview indisponível para esta arte.", true)] }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children,
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
