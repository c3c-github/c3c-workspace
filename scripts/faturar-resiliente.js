require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    try {
        const conn = await getSfConnection();
        console.log("🚀 Iniciando atualização ACELERADA de lançamentos para 'Faturado'...");

        let totalAtualizados = 0;
        let continua = true;

        while(continua) {
            // Busca os próximos 1000 registros para planejar os lotes
            const query = `
                SELECT Id 
                FROM LancamentoHora__c 
                WHERE DiaPeriodo__r.Data__c >= 2026-01-11 
                AND DiaPeriodo__r.Data__c <= 2026-02-10
                AND Status__c != 'Faturado'
                AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasBanco__c != 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)
                LIMIT 1000
            `;

            const result = await conn.query(query);
            
            if (result.records.length === 0) {
                continua = false;
                console.log("✅ Todos os registros foram atualizados!");
                break;
            }

            console.log(`⏳ Processando bloco de ${result.records.length} registros em lotes de 200...`);

            const allRecords = result.records.map(r => ({ Id: r.Id, Status__c: 'Faturado' }));
            
            // Quebra os 1000 em 5 lotes de 200 e roda em paralelo
            const batches = [];
            for (let i = 0; i < allRecords.length; i += 200) {
                batches.push(allRecords.slice(i, i + 200));
            }

            await Promise.all(batches.map(batch => 
                conn.sobject('LancamentoHora__c').update(batch).catch(e => console.error("❌ Erro no lote:", e.message))
            ));

            totalAtualizados += allRecords.length;
            console.log(`✅ Progresso: ${totalAtualizados} atualizados até agora.`);
            
            // Pequena pausa para não estressar os limites da API
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✨ Processo finalizado com sucesso!`);

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();