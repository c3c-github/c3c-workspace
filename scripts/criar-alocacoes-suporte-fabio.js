require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGHfIAO'; // Fabio
    
    // 1. Busca Serviços de Suporte
    // Nota: Status__c é um campo texto livre ou picklist, assumindo 'Ativo' ou similar. 
    // Se der erro, ajusto.
    const qServ = `
        SELECT Id, Name 
        FROM Servico__c 
        WHERE Tipo__c = 'Suporte' 
    `;
    // Removi Status__c = 'Ativo' pois pode ser diferente, melhor pegar todos do tipo Suporte
    // ou filtrar depois se necessário. Mas geralmente Suporte é contínuo.
    
    const resServ = await conn.query(qServ);
    
    if (resServ.totalSize === 0) {
        console.log("Nenhum serviço de Suporte encontrado.");
        return;
    }
    
    console.log(`Encontrados ${resServ.totalSize} serviços de Suporte.`);
    
    const allocations = resServ.records.map(s => ({
        Pessoa__c: targetId,
        Servico__c: s.Id,
        DataInicio__c: '2026-02-01',
        DataFimOriginal__c: '2026-12-31',
        Percentual__c: 0
    }));
    
    try {
        const ret = await conn.sobject('Alocacao__c').create(allocations);
        const success = ret.filter(r => r.success).length;
        console.log(`✅ ${success}/${ret.length} Alocações criadas para Fábio.`);
        
        const errors = ret.filter(r => !r.success);
        if(errors.length > 0) {
            console.error("❌ Erros:", JSON.stringify(errors, null, 2));
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
