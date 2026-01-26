require('dotenv').config();
const contaAzulService = require('../src/services/contaAzulService');

async function run() {
    console.log("Iniciando teste de busca de parcelas (Service)...");
    const saleId = '91f02b71-921e-4e2c-8e95-787667151d25'; 
    
    try {
        console.log(`Buscando parcelas para a venda: ${saleId}`);
        const installments = await contaAzulService.getSaleInstallments(saleId);
        
        console.log("\n--- RESULTADO ---");
        console.log(JSON.stringify(installments, null, 2));
    } catch (error) {
        console.error("ERRO NO TESTE:", error);
    }
}

run();
