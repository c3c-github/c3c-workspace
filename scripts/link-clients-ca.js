require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function linkClientsAndSales() {
    console.log("🚀 Iniciando vínculo de Clientes ERP e Vendas...");
    try {
        const conn = await getSfConnection();

        const mapping = [
            {
                name: 'Carapreta | Suporte 2026 | ???',
                id_ca: 'e44202b8-3f2c-4ece-b79d-e0c696cf8020',
                sales: ['323']
            },
            {
                name: 'FKPartners | Projeto',
                id_ca: '3fc10b25-e7d4-43be-9999-4733fb963f25',
                sales: ['226', '223', '217', '215']
            },
            {
                name: 'Grupo Sabará | Suporte',
                id_ca: 'ddcb52aa-a99c-4d60-9801-70b8ecf20a7d',
                sales: ['211', '141', '77']
            },
            {
                name: 'Nefrostar | Suporte',
                id_ca: 'b005de1d-25c8-4fde-abb8-ef04e16c2020',
                sales: ['250', '219', '183', '156', '122']
            },
            {
                name: 'Unisa | Alocação',
                id_ca: '473ddb48-5714-44c3-adc8-def8d2cfdfc3',
                sales: ['242', '205', '196', '176', '175', '174', '159', '140', '132']
            }
        ];

        for (const item of mapping) {
            console.log(`\nProcessando: ${item.name}`);
            
            // 1. Buscar o serviço no SF
            const svcRes = await conn.query(`SELECT Id FROM Servico__c WHERE Name = '${item.name}' LIMIT 1`);
            if (svcRes.totalSize === 0) {
                console.log(`   ⚠️ Serviço não encontrado.`);
                continue;
            }
            const svcId = svcRes.records[0].Id;

            // 2. Atualizar IDContaAzul__c no Serviço
            await conn.sobject("Servico__c").update({
                Id: svcId,
                IDContaAzul__c: item.id_ca
            });
            console.log(`   ✅ Cliente ERP vinculado.`);

            // 3. Vincular Vendas
            for (const saleNum of item.sales) {
                const saleSearch = await conn.query(`SELECT Id, ValorTotal__c FROM VendaContaAzul__c WHERE Name LIKE 'Venda ${saleNum}%' LIMIT 1`);
                if (saleSearch.totalSize > 0) {
                    const sale = saleSearch.records[0];
                    try {
                        // Upsert no objeto de junção para evitar duplicatas se rodar de novo
                        // Como não temos External ID na junção, buscamos antes
                        const existingLink = await conn.query(`SELECT Id FROM VendaServico__c WHERE Servico__c = '${svcId}' AND Venda__c = '${sale.Id}'`);
                        if (existingLink.totalSize === 0) {
                            await conn.sobject("VendaServico__c").create({
                                Servico__c: svcId,
                                Venda__c: sale.Id,
                                ValorAlocado__c: sale.ValorTotal__c
                            });
                            console.log(`   🔗 Venda #${saleNum} vinculada.`);
                        } else {
                            console.log(`   ℹ️ Venda #${saleNum} já estava vinculada.`);
                        }
                    } catch (err) {
                        console.error(`   ❌ Erro ao vincular venda #${saleNum}: ${err.message}`);
                    }
                } else {
                    console.log(`   ⚠️ Venda #${saleNum} não encontrada no SF.`);
                }
            }
        }

        console.log("\n🏁 Vínculos concluídos com sucesso.");

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

linkClientsAndSales();
