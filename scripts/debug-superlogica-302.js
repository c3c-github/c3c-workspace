require('dotenv').config();
const contaAzulService = require('../src/services/contaAzulService');

async function debug() {
    const query = 'SUPERLOGICA';
    console.log(`--- DEBUG CONTA AZUL: Buscando Cliente "${query}" ---`);

    try {
        const customers = await contaAzulService.searchCustomers(query);
        
        for (const customer of customers) {
            console.log(`\n--- Buscando Vendas para: ${customer.name} (ID: ${customer.id}) ---`);
            const sales = await contaAzulService.getSalesByCustomer(customer.id);
            const v302 = sales.find(s => s.number == 302);
            if (v302) {
                console.log("✅ VENDA 302 ENCONTRADA:");
                console.log(JSON.stringify(v302, null, 2));
                
                const insts = await contaAzulService.getSaleInstallments(v302.id);
                console.log(`\nStatus das Parcelas na API (${insts.length}):`);
                insts.forEach((inst, i) => {
                    console.log(`   - Parcela ${i+1}: ${inst.status} | Vencimento: ${inst.date} | EventID: ${inst.financialEventId}`);
                });
            }
        }

    } catch (error) {
        console.error("ERRO NO PROCESSO DE DEBUG:", error);
    }
}

debug();