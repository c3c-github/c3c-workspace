require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    try {
        const conn = await getSfConnection();
        console.log("🚀 Iniciando atualização de lançamentos para 'Faturado'...");

        // Filtro de data: 11/01/2026 até 10/02/2026
        const query = `
            SELECT Id, Status__c 
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= 2026-01-11 
            AND DiaPeriodo__r.Data__c <= 2026-02-10
            AND Status__c != 'Faturado'
        `;

        const result = await conn.query(query);
        console.log(`📊 Encontrados ${result.totalSize} lançamentos para atualizar.`);

        if (result.totalSize === 0) {
            console.log("✅ Nada para atualizar.");
            return;
        }

        const updates = result.records.map(r => ({
            Id: r.Id,
            Status__c: 'Faturado'
        }));

        console.log("⏳ Iniciando Bulk Load (este processo pode levar alguns minutos)...");
        
        conn.bulk.load("LancamentoHora__c", "update", updates, function(err, rets) {
            if (err) { 
                console.error("❌ Erro no Bulk Load:", err); 
                return; 
            }
            
            let successCount = 0;
            let errorCount = 0;
            for (let i=0; i < rets.length; i++) {
                if (rets[i].success) successCount++;
                else errorCount++;
            }

            console.log(`✨ Processo Bulk finalizado!`);
            console.log(`✅ Sucessos: ${successCount}`);
            console.log(`❌ Falhas: ${errorCount}`);
        });

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();