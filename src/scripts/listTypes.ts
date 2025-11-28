
import prisma from "../database/prisma";

async function listTypes() {
  try {
    const types = await prisma.productType.findMany();
    console.log("Product Types:", JSON.stringify(types, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

listTypes();
