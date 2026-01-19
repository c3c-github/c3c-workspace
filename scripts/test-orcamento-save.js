const { getSfConnection } = require('../src/config/salesforce');

async function testSaveOrcamento() {
    const serviceId = 'a15N50000055ZdNIAU'; // ID fornecido pelo usuário
    console.log(`Testando salvamento para Serviço: ${serviceId}`);

    try {
        const conn = await getSfConnection();

        // 1. Busca uma Alocação Prevista existente para esse serviço
        const allocRes = await conn.query(`SELECT Id, Produto__c FROM AlocacaoPrevista__c WHERE Servico__c = '${serviceId}' LIMIT 1`);
        
        if (allocRes.totalSize === 0) {
            console.log("Nenhuma Alocação Prevista encontrada. Criando uma de teste...");
            // Criar lógica de fallback ou abortar
            return;
        }

        const allocId = allocRes.records[0].Id;
        console.log(`Usando Alocação: ${allocId} (${allocRes.records[0].Produto__c})`);

        // 2. Simula dados mensais (Payload do frontend)
        const monthlyData = [
            { date: '2026-01-01', rev: 1000.50, cost: 500.25 },
            { date: '2026-02-01', rev: 1200.00, cost: 600.00 }
        ];

        console.log("Tentando salvar orçamentos:", monthlyData);

        // 3. Executa a lógica idêntica ao controller
        
        // A. Limpa existentes
        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${allocId}'`);
        console.log(`Encontrados ${exOrcs.totalSize} orçamentos antigos para deletar.`);
        
        if (exOrcs.totalSize > 0) {
            const delRes = await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
            console.log("Deleção concluída:", delRes.map(r => r.success));
        }

        // B. Cria novos
        const orcRecords = monthlyData.map(m => ({ 
            AlocacaoPrevista__c: allocId, 
            Servico__c: serviceId, 
            Competencia__c: m.date, 
            ReceitaPrevista__c: m.rev, 
            CustoPrevisto__c: m.cost 
        }));

        const createRes = await conn.sobject('OrcamentoCompetencia__c').create(orcRecords);
        console.log("Criação concluída:", createRes);
        
        // Verifica erros
        createRes.forEach((r, i) => {
            if (!r.success) {
                console.error(`Erro no item ${i}:`, r.errors);
            }
        });

    } catch (e) {
        console.error("ERRO GERAL:", e);
    }
}

testSaveOrcamento();
