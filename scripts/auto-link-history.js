require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function autoLinkHistoricalSales() {
    console.log("🚀 Iniciando Arqueologia de Vendas Históricas...");
    try {
        const conn = await getSfConnection();

        // 1. Buscar serviços inativos sem vendas
        const services = await conn.query(
            "SELECT Id, Name FROM Servico__c WHERE Status__c = 'Inativo' AND Id NOT IN (SELECT Servico__c FROM VendaServico__c)"
        );

        console.log(`Analisando ${services.totalSize} serviços inativos...`);

        for (const svc of services.records) {
            // Regex para encontrar números de 3 dígitos (padrão de vendas como 256, 270, etc)
            const matches = svc.Name.match(/\b\d{3}\b/g);
            
            if (!matches) continue;

            console.log(`\nServiço: ${svc.Name}`);
            
            for (const saleNum of matches) {
                // Buscar a venda pelo número
                const saleSearch = await conn.query(
                    `SELECT Id, Name, ValorTotal__c FROM VendaContaAzul__c WHERE Name LIKE 'Venda ${saleNum}%' LIMIT 1`
                );

                if (saleSearch.totalSize > 0) {
                    const sale = saleSearch.records[0];
                    console.log(`   ✅ Encontrada ${sale.Name} (R$ ${sale.ValorTotal__c}) para o serviço.`);

                    // Criar vínculo de junção
                    try {
                        await conn.sobject("VendaServico__c").create({
                            Servico__c: svc.Id,
                            Venda__c: sale.Id,
                            ValorAlocado__c: sale.ValorTotal__c
                        });
                        console.log(`   🔗 Vínculo criado com sucesso.`);
                    } catch (err) {
                        console.error(`   ❌ Erro ao criar vínculo: ${err.message}`);
                    }
                } else {
                    console.log(`   ⚠️ Venda #${saleNum} não encontrada no Salesforce.`);
                }
            }
        }

        console.log(`\n🏁 Processo de vinculação automática concluído.`);

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

autoLinkHistoricalSales();
