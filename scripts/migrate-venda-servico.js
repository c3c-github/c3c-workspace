require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function migrateData() {
    console.log("🚀 Iniciando migração de vínculos Venda -> Serviço...");
    try {
        const conn = await getSfConnection();

        // 1. Buscar vendas que possuem o campo Servico__c preenchido
        const sales = await conn.query(
            "SELECT Id, Servico__c, ValorTotal__c FROM VendaContaAzul__c WHERE Servico__c != null"
        );

        console.log(`Encontradas ${sales.totalSize} vendas com vínculo antigo.`);

        if (sales.totalSize === 0) return;

        // 2. Preparar registros para o objeto de junção VendaServico__c
        const junctionRecords = sales.records.map(s => ({
            Venda__c: s.Id,
            Servico__c: s.Servico__c,
            ValorAlocado__c: s.ValorTotal__c // Alocamos 100% do valor da venda por padrão na migração
        }));

        // 3. Inserir no novo objeto
        console.log("Inserindo registros no objeto de junção...");
        const results = await conn.sobject("VendaServico__c").create(junctionRecords);

        const successCount = results.filter(r => r.success).length;
        console.log(`✅ Migração concluída: ${successCount} vínculos criados.`);

    } catch (e) {
        console.error("❌ Erro na migração:", e.message);
    }
}

migrateData();
