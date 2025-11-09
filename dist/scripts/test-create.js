"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
async function main() {
    if (!process.env.DATABASE_URL) {
        console.error("DATABASE_URL não está definido. Defina a variável de ambiente antes de executar os testes.");
        process.exit(1);
    }
    console.log("Iniciando script de teste: criar productType, product, items, componente e adicional...");
    // 1) Garantir um ProductType (find or create)
    let productType = await prisma_1.default.productType.findFirst({
        where: { name: "TEST_TYPE" },
    });
    if (!productType) {
        productType = await prisma_1.default.productType.create({
            data: {
                name: "TEST_TYPE",
            },
        });
    }
    console.log("ProductType:", productType.id);
    // 2) Criar um produto de teste
    const product = await prisma_1.default.product.create({
        data: {
            name: "Produto Teste",
            description: "Produto criado no script de teste",
            price: 100.0,
            type_id: productType.id,
            is_active: true,
        },
    });
    console.log("Product criado:", product.id);
    // 3) Criar dois items (um componente e um adicional)
    const componentItem = await prisma_1.default.item.create({
        data: {
            name: "Item Componente Teste",
            description: "Componente para produto de teste",
            stock_quantity: 50,
            base_price: 10.0,
        },
    });
    const additionalItem = await prisma_1.default.item.create({
        data: {
            name: "Item Adicional Teste",
            description: "Adicional para produto de teste",
            stock_quantity: 30,
            base_price: 5.0,
            discount: 0,
        },
    });
    console.log("Component item id:", componentItem.id);
    console.log("Additional item id:", additionalItem.id);
    // 4) Vincular componente ao produto
    const pc = await prisma_1.default.productComponent.create({
        data: {
            product_id: product.id,
            item_id: componentItem.id,
            quantity: 2,
        },
    });
    console.log("ProductComponent criado:", pc.id || JSON.stringify(pc));
    // 5) Vincular adicional ao produto
    const pa = await prisma_1.default.productAdditional.create({
        data: {
            product_id: product.id,
            additional_id: additionalItem.id,
            custom_price: 6.5,
            is_active: true,
        },
    });
    console.log("ProductAdditional criado:", pa.product_id, pa.additional_id);
    // 6) Ler produto com includes para verificar relacionamentos
    const productWithRelations = await prisma_1.default.product.findUnique({
        where: { id: product.id },
        include: {
            components: { include: { item: true } },
            additionals: {
                include: {
                    additional: {
                        include: {
                            customizations: true,
                        },
                    },
                },
            },
        },
    });
    console.log("Produto com relacionamentos:", JSON.stringify(productWithRelations, null, 2));
    console.log("Teste concluído com sucesso.");
    await prisma_1.default.$disconnect();
}
main().catch(async (e) => {
    console.error("Erro no script de teste:", e);
    try {
        await prisma_1.default.$disconnect();
    }
    catch (_) { }
    process.exit(1);
});
