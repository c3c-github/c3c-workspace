require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("🚀 Iniciando atualização de contratos nos períodos de 2026...");

    try {
        // 1. Busca Períodos de 2026 pelo NOME
        const qPeriodos = `
            SELECT Id, Name, Pessoa__c, DataInicio__c, DataFim__c, ContratoPessoa__c 
            FROM Periodo__c 
            WHERE Name LIKE '%2026%'
        `;
        const resPeriodos = await conn.query(qPeriodos);
        console.log(`📊 Encontrados ${resPeriodos.totalSize} períodos em 2026.`);

        if (resPeriodos.totalSize === 0) return;

        // 2. Busca Todos os Contratos Ativos para evitar queries dentro do loop
        const qContratos = `
            SELECT Id, Pessoa__c, DataInicio__c, DataFim__c 
            FROM ContratoPessoa__c 
            WHERE Status__c = 'Ativo'
        `;
        const resContratos = await conn.query(qContratos);
        const contratos = resContratos.records;

        const updates = [];

        resPeriodos.records.forEach(p => {
            // Encontra contratos que se sobrepõem ao período
            // Prioriza o contrato que cobre o FIM do período (mais atualizado)
            const contratoCerto = contratos
                .filter(c => c.Pessoa__c === p.Pessoa__c && c.DataInicio__c <= p.DataFim__c && (c.DataFim__c === null || c.DataFim__c >= p.DataInicio__c))
                .sort((a, b) => new Date(b.DataInicio__c) - new Date(a.DataInicio__c))[0]; // Pega o mais recente

            if (contratoCerto) {
                // Só adiciona ao update se o contrato for diferente do atual
                if (p.ContratoPessoa__c !== contratoCerto.Id) {
                    updates.push({
                        Id: p.Id,
                        ContratoPessoa__c: contratoCerto.Id
                    });
                    console.log(`✅ Período [${p.Name}] -> Contrato: ${contratoCerto.Id}`);
                }
            } else {
                console.warn(`⚠️  Nenhum contrato ativo encontrado para: ${p.Name}`);
            }
        });

        if (updates.length === 0) {
            console.log("ℹ️  Todos os períodos já possuem o contrato correto.");
            return;
        }

        // 3. Executa o Update
        console.log(`\n⚙️  Atualizando ${updates.length} registros...`);
        const batchSize = 200;
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            const ret = await conn.sobject('Periodo__c').update(batch);
            const success = ret.filter(r => r.success).length;
            console.log(`🚀 Lote: ${success}/${batch.length} atualizados.`);
        }

        console.log("\n✅ Processo concluído!");

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();
