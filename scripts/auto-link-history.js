require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function migrateToJunction() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO MIGRAÇÃO PARA MODELO DE JUNÇÃO...`);
    
    try {
        const conn = await getSfConnection();
        
        // 1. Buscar todas as parcelas que têm vínculo direto com o serviço (modelo antigo)
        console.log("Buscando parcelas vinculadas a serviços...");
        const res = await conn.query(`
            SELECT VendaContaAzul__c, Servico__c, VendaContaAzul__r.ValorTotal__c
            FROM ParcelaFinanceira__c 
            WHERE Servico__c != null 
            AND VendaContaAzul__c != null
        `);
        
        console.log(`Encontradas ${res.totalSize} parcelas para processar.`);

        // 2. Identificar pares únicos de (Venda, Serviço)
        const pairMap = new Map();
        res.records.forEach(r => {
            const key = `${r.VendaContaAzul__c}-${r.Servico__c}`;
            if (!pairMap.has(key)) {
                pairMap.set(key, {
                    Venda__c: r.VendaContaAzul__c,
                    Servico__c: r.Servico__c,
                    ValorAlocado__c: r.VendaContaAzul__r ? r.VendaContaAzul__r.ValorTotal__c : 0
                });
            }
        });

        console.log(`Total de vínculos únicos identificados: ${pairMap.size}`);

        // 3. Criar os registros de junção que ainda não existem
        let created = 0;
        let skipped = 0;

        for (const link of pairMap.values()) {
            const check = await conn.query(`
                SELECT Id FROM VendaServico__c 
                WHERE Venda__c = '${link.Venda__c}' 
                AND Servico__c = '${link.Servico__c}'
            `);

            if (check.totalSize === 0) {
                await conn.sobject('VendaServico__c').create(link);
                created++;
            } else {
                skipped++;
            }
        }

        console.log(`\n🏁 MIGRAÇÃO CONCLUÍDA!`);
        console.log(`- Vínculos criados: ${created}`);
        console.log(`- Vínculos já existentes (pulados): ${skipped}`);

    } catch (e) {
        console.error("❌ ERRO NA MIGRAÇÃO:", e.message);
    }
}

migrateToJunction();
