require('dotenv').config();
const contaAzulService = require('../src/services/contaAzulService');

async function discoverVendas() {
    const clients = [
        "Carapreta", "FKPartners", "Sabará", "Juca na Balada", "Nefrostar", "Unisa"
    ];

    console.log("🔍 PESQUISANDO CLIENTES E VENDAS NO CONTA AZUL...\n");

    for (const name of clients) {
        console.log(`--- Buscando: ${name} ---`);
        try {
            // 1. Buscar cliente pelo nome
            const customers = await contaAzulService.searchCustomers(name);
            if (customers.length === 0) {
                console.log(`   ⚠️ Cliente não encontrado.`);
                continue;
            }

            for (const customer of customers) {
                console.log(`   ✅ Cliente: ${customer.name} (ID: ${customer.id})`);
                
                // 2. Buscar vendas desse cliente
                const sales = await contaAzulService.getSalesByCustomer(customer.id);
                if (sales.length === 0) {
                    console.log(`      ❌ Nenhuma venda encontrada.`);
                } else {
                    sales.forEach(s => {
                        console.log(`      💰 Venda #${s.number || s.numero} - Total: R$ ${s.total || s.valor_total} - Data: ${s.date || s.data_emissao} - Status: ${s.status || s.situacao?.nome}`);
                    });
                }
            }
        } catch (e) {
            console.error(`   ❌ Erro ao processar ${name}:`, e.message);
        }
        console.log("");
    }
}

discoverVendas();
