
import aiProductService from "../services/aiProductService";
import prisma from "../database/prisma";

async function verify() {
  try {
    console.log("START_VERIFICATION");
    const lightProducts = await aiProductService.getLightweightProducts();
    console.log(`Total products: ${lightProducts.products.length}`);

    console.log("\n--- Current Order ---");
    lightProducts.products.forEach((p, index) => {
      console.log(`${index + 1}. [${p.price}] ${p.name} (Tags: ${p.tags.join(", ")})`);
    });

    console.log("END_VERIFICATION");

  } catch (error) {
    console.error("Verification failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
