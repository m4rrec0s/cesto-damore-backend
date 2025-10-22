"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const imageCompositionService_1 = __importDefault(require("./imageCompositionService"));
const uuid_1 = require("uuid");
const prisma = new client_1.PrismaClient();
class PersonalizationService {
    /**
     * Commit da personalização - gera imagem final e salva no Drive
     */
    async commitPersonalization(userId, data) {
        // Verificar se o pedido pertence ao usuário
        const order = await prisma.order.findFirst({
            where: {
                id: data.orderId,
                user_id: userId,
            },
        });
        if (!order) {
            throw new Error("Pedido não encontrado ou não pertence ao usuário");
        }
        // Verificar se pedido permite personalização (status deve ser PENDING)
        if (order.status !== "PENDING") {
            throw new Error("Pedido não está em estado válido para personalização");
        }
        // Buscar layout base
        const layoutBase = await prisma.layoutBase.findUnique({
            where: { id: data.layoutBaseId },
        });
        if (!layoutBase) {
            throw new Error("Layout base não encontrado");
        }
        // Buscar item
        const item = await prisma.item.findUnique({
            where: { id: data.itemId },
        });
        if (!item) {
            throw new Error("Item não encontrado");
        }
        // Validar que o item permite customização
        if (!item.allows_customization) {
            throw new Error("Este item não permite personalização");
        }
        const slots = layoutBase.slots;
        // Preparar imagens para composição
        const imageSlots = [];
        const tempImagePaths = [];
        for (const img of data.images) {
            // Criar arquivo temporário a partir do buffer
            const tempFileName = `temp_${(0, uuid_1.v4)()}.${img.mimeType.split("/")[1] || "png"}`;
            const tempDir = path_1.default.join(process.cwd(), "storage", "temp_composition");
            await fs_1.promises.mkdir(tempDir, { recursive: true });
            const tempFilePath = path_1.default.join(tempDir, tempFileName);
            await fs_1.promises.writeFile(tempFilePath, img.imageBuffer);
            tempImagePaths.push(tempFilePath);
            imageSlots.push({
                slotId: img.slotId,
                imagePath: tempFilePath,
            });
        }
        // Compor imagem final
        const baseImagePath = path_1.default.join(process.cwd(), "public", layoutBase.image_url.replace(/^\//, ""));
        const compositionResult = await imageCompositionService_1.default.composeImage(baseImagePath, layoutBase.width, layoutBase.height, slots, imageSlots);
        // Salvar PNG final em storage
        const finalFileName = `${data.orderId}_${data.itemId}_${Date.now()}.png`;
        const finalDir = path_1.default.join(process.cwd(), "storage", "orders", data.orderId, data.itemId);
        // Criar diretórios se não existirem
        await fs_1.promises.mkdir(finalDir, { recursive: true });
        const finalFilePath = path_1.default.join(finalDir, finalFileName);
        await fs_1.promises.writeFile(finalFilePath, compositionResult.buffer);
        // TODO: Upload para Google Drive (integrar com serviço existente)
        // const driveUrl = await DriveService.upload(data.orderId, finalFilePath, `${data.itemId}/${finalFileName}`);
        const driveUrl = null; // Temporário até integração com Drive
        // Salvar personalização no banco (transação)
        const personalization = await prisma.personalization.create({
            data: {
                order_id: data.orderId,
                item_id: data.itemId,
                layout_base_id: data.layoutBaseId,
                config_json: data.configJson,
                images: data.images,
                final_image_url: driveUrl ||
                    `/storage/orders/${data.orderId}/${data.itemId}/${finalFileName}`,
            },
        });
        // Limpar arquivos temporários de composição
        for (const tempPath of tempImagePaths) {
            try {
                await fs_1.promises.unlink(tempPath).catch(() => { });
            }
            catch (error) {
                console.warn(`Erro ao limpar arquivo temporário ${tempPath}:`, error);
            }
        }
        return {
            personalizationId: personalization.id,
            finalImageUrl: personalization.final_image_url,
        };
    }
    /**
     * Buscar personalização por ID
     */
    async getById(id) {
        const personalization = await prisma.personalization.findUnique({
            where: { id },
            include: {
                order: true,
                item: true,
                layout_base: true,
            },
        });
        if (!personalization) {
            throw new Error("Personalização não encontrada");
        }
        return personalization;
    }
    /**
     * Listar personalizações de um pedido
     */
    async listByOrder(orderId, userId) {
        // Se userId fornecido, validar que o pedido pertence ao usuário
        if (userId) {
            const order = await prisma.order.findFirst({
                where: {
                    id: orderId,
                    user_id: userId,
                },
            });
            if (!order) {
                throw new Error("Pedido não encontrado ou não pertence ao usuário");
            }
        }
        const personalizations = await prisma.personalization.findMany({
            where: { order_id: orderId },
            include: {
                item: true,
                layout_base: true,
            },
        });
        return personalizations;
    }
}
exports.default = new PersonalizationService();
